const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { defaultSettings, applyPreset, computeTeamPipelines, PRESETS } = require('./engine/pipelineEngine');
const {
  openSave,
  readTeamPipelineMapping,
  readPlayers,
  readCoaches,
  readPipelineRow,
  writeUpdatedSave,
} = require('./io/saveFile');

const regionCentroids = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/regionCentroids.json'), 'utf8'));
const teamColors = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/teamColors.json'), 'utf8'));
const stateToPipeline = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/stateToPipeline.json'), 'utf8'));

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

  const results = {};
  for (const [teamIndexStr, teamInfo] of Object.entries(teamsByIndex)) {
    const teamIndex = Number(teamIndexStr);
    const players = playersByTeamIndex[teamIndex] || [];
    const coaches = coachesByTeamIndex[teamIndex] || {};
    const prior = teamInfo.rows4306
      .map((row) => readPipelineRow(pipelineInfluenceTable, row))
      .filter(Boolean)
      .filter((entry) => !(entry[0] === 'Unrecognized' && entry[2] === 0)); // strip known placeholder-slot noise

    if (!prior.length) continue;

    const after = computeTeamPipelines(teamInfo.displayName, players, coaches, prior, regionCentroids, settings);
    results[teamInfo.displayName] = {
      teamIndex,
      rows4306: teamInfo.rows4306,
      prior,
      after,
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
  const updatesByRow4306 = {};
  for (const teamName of teamNamesToApply) {
    const result = engineResults[teamName];
    if (!result) continue;
    result.rows4306.forEach((rowIndex, i) => {
      const [tier, pipeline, value] = result.after[i] || [];
      if (tier === undefined) return;
      updatesByRow4306[rowIndex] = { InfluenceLevel: tier, Pipeline: pipeline, InfluenceValue: value };
    });
  }
  return writeUpdatedSave(savePath, updatesByRow4306, outputDir);
});
