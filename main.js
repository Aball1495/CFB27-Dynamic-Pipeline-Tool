const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { defaultSettings, applyPreset, computeTeamPipelines, buildAcademyAssignment, PRESETS } = require('./engine/pipelineEngine');
const {
  openSave,
  readTeamPipelineMapping,
  readPlayers,
  readCoaches,
  readPipelineRow,
  writeUpdatedSave,
  readDynastyCode,
  readCurrentSeason,
  readUserTeam,
} = require('./io/saveFile');
const { recordSnapshot } = require('./io/pipelineHistory');

const regionCentroids = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/regionCentroids.json'), 'utf8'));
const teamColors = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/teamColors.json'), 'utf8'));
const stateToPipeline = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/stateToPipeline.json'), 'utf8'));

// Logo images are never bundled into the app (see build.files in package.json,
// and .gitignore) -- trademarked assets shouldn't ship inside the exe or the repo.
// Running from source: project-root/logos. Packaged: a "logos" folder the user
// creates themselves, sitting right next to the exe (outside app.asar entirely).
const LOGOS_DIR = app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'logos')
  : path.join(__dirname, 'logos');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'pipeline-tool-settings.json');

function loadUserSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), 'utf8');
    return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    return defaultSettings();
  }
}

function saveUserSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2));
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC handlers ----

ipcMain.handle('select-save-file', async () => {
  const userSettings = loadUserSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select your dynasty save file',
    properties: ['openFile'],
    defaultPath: userSettings.lastSaveFolder || undefined,
  });
  if (result.canceled) return null;

  const savePath = result.filePaths[0];
  userSettings.lastSaveFolder = path.dirname(savePath);
  saveUserSettings(userSettings);
  return savePath;
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select output folder for the new save copy',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-settings', () => loadUserSettings());
ipcMain.handle('save-settings', (event, settings) => {
  saveUserSettings(settings);
  return true;
});
ipcMain.handle('apply-preset', (event, { settings, presetName }) => applyPreset(settings, presetName));
ipcMain.handle('get-presets', () => PRESETS);
ipcMain.handle('get-team-colors', () => teamColors);
ipcMain.handle('get-state-to-pipeline', () => stateToPipeline);
ipcMain.handle('get-logos-dir', () => LOGOS_DIR);

const { loadHistory } = require('./io/pipelineHistory');
ipcMain.handle('get-history', () => loadHistory(app));
ipcMain.handle('get-dynasty-code-for-save', async (event, { savePath }) => {
  const franchise = await openSave(savePath);
  return readDynastyCode(franchise);
});
ipcMain.handle('get-save-info', async (event, { savePath }) => {
  const franchise = await openSave(savePath);
  const dynastyCode = await readDynastyCode(franchise);
  const season = await readCurrentSeason(franchise);
  const userTeam = await readUserTeam(franchise);
  return { dynastyCode, season, userTeam };
});

/**
 * Opens the save directly, reads every team's roster/coaches/prior
 * pipeline data, and runs the engine for each. Does NOT write anything --
 * the UI shows a before/after preview and requires explicit confirmation
 * before commit-changes is ever called.
 */
ipcMain.handle('run-engine', async (event, { savePath, settings }) => {
  const franchise = await openSave(savePath);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);
  const playersByTeamIndex = await readPlayers(franchise);
  const coachesByTeamIndex = await readCoaches(franchise);

  // Academy Mode -- see academy_mode_spec.md. Only active when the
  // setting is on; an empty Set means the per-team check below is always
  // false, so this costs nothing when the feature is off.
  const academyTeamSet = new Set(settings.academyMode ? (settings.academyTeams || []) : []);

  const results = {};
  for (const [teamIndexStr, teamInfo] of Object.entries(teamsByIndex)) {
    const teamIndex = Number(teamIndexStr);
    const players = playersByTeamIndex[teamIndex] || [];
    const coaches = coachesByTeamIndex[teamIndex] || {};
    const prior = teamInfo.rows4306
      .map((row) => readPipelineRow(pipelineInfluenceTable, row))
      .filter(Boolean)
      .filter((entry) => !(entry[0] === 'Unrecognized' && entry[2] === 0)); // strip known placeholder-slot noise

    // ---- Academy Mode ----
    // Checked BEFORE the `!prior.length` bail-out below, on purpose -- a
    // team newly entering Academy Mode with very few (or, in principle,
    // zero) real slots should still get set up, not silently skipped.
    if (academyTeamSet.has(teamInfo.displayName)) {
      const alreadySetUp = teamInfo.rows4306.length >= settings.academyTargetCount;

      if (settings.academyExempt && alreadySetUp) {
        // The whole point of "exempt": once set up, this team is
        // completely excluded from every future run -- not recalculated,
        // not rewritten. `after` mirrors `prior` so the preview correctly
        // shows "no changes" instead of inventing a diff for a team
        // we're deliberately not touching.
        results[teamInfo.displayName] = {
          teamIndex,
          rows4306: teamInfo.rows4306,
          prior,
          after: prior,
          coaches,
          academyStatus: 'exempt',
        };
        continue;
      }

      // Needs (re)setup: either academyExempt is false (runs the real
      // engine every season, just at the bigger target -- academyUniform
      // is ignored in that case, per the spec), or it's true but this
      // team hasn't reached academyTargetCount real slots yet (the
      // one-time setup pass -- uniform tier, or a single varied
      // real-engine snapshot).
      const after = (settings.academyExempt && settings.academyUniform)
        ? buildAcademyAssignment(settings.academyUniformTier, settings.academyTargetCount)
        : computeTeamPipelines(teamInfo.displayName, players, coaches, prior, regionCentroids, settings, settings.academyTargetCount);

      results[teamInfo.displayName] = {
        teamIndex,
        rows4306: teamInfo.rows4306,
        prior,
        after,
        coaches,
        academyStatus: settings.academyExempt ? 'setup' : 'active',
      };
      continue;
    }

    if (!prior.length) continue;

    // Ceiling for regular (non-academy) teams: never more than
    // settings.maxPipelines, but can legitimately come back with fewer
    // (computeTeamPipelines' zero-score filter). Whether Applying this
    // means expanding (real signal supports more real slots than the
    // team currently has) or shrinking (team currently has more real
    // slots than the ceiling allows) happens automatically in
    // writeUpdatedSave -- this call doesn't need to know or care which.
    const after = computeTeamPipelines(teamInfo.displayName, players, coaches, prior, regionCentroids, settings, settings.maxPipelines);
    results[teamInfo.displayName] = {
      teamIndex,
      rows4306: teamInfo.rows4306,
      prior,
      after,
      coaches, // { HeadCoach: {name, pipeline, seasons}, OffensiveCoordinator: {...}, DefensiveCoordinator: {...} }
    };
  }
  return results;
});

/**
 * Commits previously-previewed changes. Always writes to a brand new save
 * file copy -- see writeUpdatedSave(). Your original save is never opened
 * in write mode at any point in this flow.
 */
ipcMain.handle('commit-changes', async (event, { savePath, engineResults, teamNamesToApply, outputDir }) => {
  // writeUpdatedSave expects { [teamIndex]: { after: [[tier,region,value],...] } }
  // -- NOT a flat row-indexed map. It needs the full `after` array per team
  // (not pre-flattened to specific row numbers) because expansion/shrinking
  // determines the actual row numbers to write to, and that can only happen
  // once it's already open on its own working copy of the file.
  const teamUpdates = {};
  for (const teamName of teamNamesToApply) {
    const result = engineResults[teamName];
    if (!result) continue;
    teamUpdates[result.teamIndex] = { after: result.after };
  }
  const writeResult = await writeUpdatedSave(savePath, teamUpdates, outputDir);

  // Read-only pass, separate from the write above, just to key this
  // season's history snapshot. Never touches write mode on the original.
  let dynastyCode = null;
  let season = null;
  let historyWarning = null;
  try {
    const readFranchise = await openSave(savePath);
    dynastyCode = await readDynastyCode(readFranchise);
    season = await readCurrentSeason(readFranchise);
  } catch (err) {
    console.error('Could not read dynasty code/season for history tracking:', err);
    historyWarning = 'This season was NOT recorded to History -- could not read the dynasty/season info from this save. The save file itself was written successfully; only History tracking failed.';
  }

  let dynastyHistorySeasonWarning = null;
  if (dynastyCode && season && writeResult && writeResult.success !== false) {
    const existingHistory = loadHistory(app);
    let maxKnownSeason = null;
    if (existingHistory[dynastyCode]) {
      for (const teamHistory of Object.values(existingHistory[dynastyCode])) {
        for (const s of Object.keys(teamHistory)) {
          const sNum = Number(s);
          if (maxKnownSeason === null || sNum > maxKnownSeason) maxKnownSeason = sNum;
        }
      }
    }
    if (maxKnownSeason !== null && Number(season) < maxKnownSeason) {
      dynastyHistorySeasonWarning =
        `Heads up: this save reports season ${season}, but this dynasty's History already has entries through ${maxKnownSeason} -- likely from a different copy of this save (a test file, a backup, etc). Applying just now updated the ${season} entry; it did not add a newer season, since this save genuinely isn't there yet.`;
    }

    try {
      for (const teamName of teamNamesToApply) {
        const result = engineResults[teamName];
        if (!result) continue;
        recordSnapshot(app, dynastyCode, season, teamName, result.after);
      }
    } catch (err) {
      console.error('Failed to record history snapshot:', err);
      historyWarning = 'This season was NOT recorded to History -- writing to the local history file failed. The save file itself was written successfully; only History tracking failed.';
    }
  }

  return { ...writeResult, dynastyHistorySeasonWarning, historyWarning };
});
