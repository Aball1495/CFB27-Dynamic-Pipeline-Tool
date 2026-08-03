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
  getConferenceMembers,
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

// Backups now default to a "Pipeline Backup" folder next to the save file
// itself (auto-created on first Apply) -- this dialog is no longer part of
// the normal Apply flow, but kept available in case a future settings
// option lets someone override the backup location.
ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a custom backup folder',
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

// Powers the National Map tab -- real conference membership, straight
// from the save's own Conference table (not a hardcoded map). Read-only,
// separate from run-engine, since this doesn't depend on any settings.
ipcMain.handle('get-conference-members', async (_event, { savePath }) => {
  const franchise = await openSave(savePath);
  return getConferenceMembers(franchise);
});

const { loadHistory, deleteSeason, deleteDynastyHistory } = require('./io/pipelineHistory');
ipcMain.handle('get-history', () => loadHistory(app));
ipcMain.handle('delete-history-season', (event, { dynastyCode, season }) => deleteSeason(app, dynastyCode, season));
ipcMain.handle('delete-history-dynasty', (event, { dynastyCode }) => deleteDynastyHistory(app, dynastyCode));
ipcMain.handle('get-dynasty-code-for-save', async (event, { savePath }) => {
  const franchise = await openSave(savePath);
  return readDynastyCode(franchise);
});
ipcMain.handle('get-save-info', async (event, { savePath }) => {
  const franchise = await openSave(savePath);
  const dynastyCode = await readDynastyCode(franchise);
  const season = await readCurrentSeason(franchise);
  const userTeam = await readUserTeam(franchise);

  // Pipeline table capacity -- surfaced in the UI as a simple "used/total"
  // indicator. Cheap to compute (reuses the same mapping run-engine
  // already needs) and worth keeping visible given the table has a hard
  // fixed ceiling (confirmed 1500 rows) that row collisions and any future
  // shrink/expand activity both draw against.
  let pipelineCapacity = null;
  try {
    const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);
    const referencedRows = new Set();
    for (const info of Object.values(teamsByIndex)) {
      for (const row of info.rows4306) referencedRows.add(row);
    }
    pipelineCapacity = { used: referencedRows.size, total: pipelineInfluenceTable.records.length };
  } catch (err) {
    console.error('Could not compute pipeline capacity:', err);
    // Non-fatal -- the rest of the save info is still useful without it.
  }

  return { dynastyCode, season, userTeam, pipelineCapacity };
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

  // CONFIRMED BUG (2026-07-29): academy setup used to just call
  // buildAcademyAssignment() every Apply until a team reached
  // academyTargetCount real slots, with no memory of a PRIOR incomplete
  // attempt's random selection. If a team needed more than one Apply to
  // actually reach 42 real rows (write capacity limited that Apply, for
  // any reason), each attempt picked a BRAND NEW random 42-region subset
  // -- and any rows already written from an earlier attempt's different
  // random selection were never cleaned up, just left behind. Confirmed
  // live: Air Force ended up with "Wisconsin" stored 4 separate times at
  // different values, "Arkansas" 3 times, etc. -- leftover debris from
  // several different incomplete setup attempts, all still sitting in
  // the save.
  //
  // Fix: setup must be ATOMIC. A team either goes from its current real
  // count straight to academyTargetCount in ONE Apply, or isn't touched
  // at all this Apply -- no partial, in-between state is ever written.
  // That means checking, up front, whether there's actually enough spare
  // capacity (unowned/reclaimable rows) to cover every academy team that
  // still needs setup THIS Apply, before committing any of them to a
  // setup pass. This doesn't retroactively clean up debris from BEFORE
  // this fix existed -- that's a separate, one-time cleanup this project
  // still needs to write. It only prevents new debris going forward.
  let spareCapacity = 0;
  {
    const referencedRows = new Set();
    for (const info of Object.values(teamsByIndex)) {
      for (const row of info.rows4306) referencedRows.add(row);
    }
    for (let i = 0; i < pipelineInfluenceTable.records.length; i++) {
      if (!referencedRows.has(i)) spareCapacity++;
    }
  }
  let spareCapacityRemaining = spareCapacity;

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
      //
      // ATOMIC CHECK: this team needs (academyTargetCount - current real
      // count) additional rows to complete setup in this one Apply. If
      // spareCapacityRemaining can't cover that, skip setup entirely for
      // this team THIS Apply -- leave it completely unchanged (mirror
      // exempt's "after: prior" behavior) rather than writing a partial
      // selection that would need cleanup later. spareCapacityRemaining
      // is decremented as each academy team's need is provisionally
      // reserved, so teams processed earlier in this same loop don't
      // oversubscribe capacity that a later team also needs.
      const rowsNeededForSetup = Math.max(0, settings.academyTargetCount - teamInfo.rows4306.length);
      if (rowsNeededForSetup > spareCapacityRemaining) {
        results[teamInfo.displayName] = {
          teamIndex,
          rows4306: teamInfo.rows4306,
          prior,
          after: prior,
          coaches,
          academyStatus: 'setup-deferred',
          academySetupDeferredReason: `Needs ${rowsNeededForSetup} more free row(s) to complete Academy setup atomically; only ${spareCapacityRemaining} available this Apply. Skipped -- will retry once capacity allows, rather than writing a partial setup.`,
        };
        continue;
      }
      spareCapacityRemaining -= rowsNeededForSetup;

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
 * Commits previously-previewed changes. Overwrites the original save file
 * -- but only after backing it up to "Pipeline Backup" (next to the save,
 * auto-created on first use) and only after the edit succeeds and
 * verifies on a separate working copy first. See writeUpdatedSave() for
 * the full commit order. `backupDir` is optional -- omit it (or pass
 * null/undefined) to use the default "Pipeline Backup" folder location.
 */
ipcMain.handle('commit-changes', async (event, { savePath, engineResults, teamNamesToApply, backupDir, settings }) => {
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
  // Pass 5 (automatic over-cap capacity reclamation, see saveFile.js)
  // needs to know the real cap and which teams are academy-exempt --
  // driven by the actual settings, never hardcoded, so a custom academy
  // list is respected correctly.
  const capacityReclaim = {
    maxPipelines: settings ? settings.maxPipelines : null,
    academyTeamNames: (settings && settings.academyMode) ? (settings.academyTeams || []) : [],
  };
  const writeResult = await writeUpdatedSave(savePath, teamUpdates, backupDir, capacityReclaim);

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
  if (dynastyCode && season && writeResult && writeResult.outputPath) {
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
      const recordedTeams = new Set();

      for (const teamName of teamNamesToApply) {
        const result = engineResults[teamName];
        if (!result) continue;
        // Settings context for this season, kept separate from the
        // region data itself (see the JSDoc on recordSnapshot for why).
        // Falls back gracefully if `settings` wasn't passed for some
        // reason -- history recording for the actual pipeline data
        // shouldn't fail just because this optional context is missing.
        const meta = settings
          ? {
              targetCount: result.academyStatus ? settings.academyTargetCount : settings.maxPipelines,
              academyStatus: result.academyStatus || null,
            }
          : null;
        recordSnapshot(app, dynastyCode, season, teamName, result.after, meta);
        recordedTeams.add(teamName);
      }

      // Exempt academy teams deliberately never appear in
      // teamNamesToApply (nothing to write -- see the "Select all" skip
      // in app.js), but the season still genuinely happened for them.
      // Without this, their History timeline just stops at whatever
      // season they became exempt, while every other team keeps getting
      // a fresh entry each Apply -- confusing when comparing across
      // teams. Record the same (unchanged) snapshot for them too, on
      // every Apply, even though nothing was written to the save file.
      for (const [teamName, result] of Object.entries(engineResults)) {
        if (recordedTeams.has(teamName)) continue;
        if (result.academyStatus !== 'exempt') continue;
        const meta = settings ? { targetCount: settings.academyTargetCount, academyStatus: 'exempt' } : null;
        recordSnapshot(app, dynastyCode, season, teamName, result.after, meta);
      }
    } catch (err) {
      console.error('Failed to record history snapshot:', err);
      historyWarning = 'This season was NOT recorded to History -- writing to the local history file failed. The save file itself was written successfully; only History tracking failed.';
    }
  }

  return { ...writeResult, dynastyHistorySeasonWarning, historyWarning };
});
