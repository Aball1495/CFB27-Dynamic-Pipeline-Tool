const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectSaveFile: () => ipcRenderer.invoke('select-save-file'),
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  applyPreset: (settings, presetName) => ipcRenderer.invoke('apply-preset', { settings, presetName }),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  getTeamColors: () => ipcRenderer.invoke('get-team-colors'),
  getStateToPipeline: () => ipcRenderer.invoke('get-state-to-pipeline'),
  getLogosDir: () => ipcRenderer.invoke('get-logos-dir'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteHistorySeason: (dynastyCode, season) => ipcRenderer.invoke('delete-history-season', { dynastyCode, season }),
  deleteHistoryDynasty: (dynastyCode) => ipcRenderer.invoke('delete-history-dynasty', { dynastyCode }),
  getDynastyCodeForSave: (savePath) => ipcRenderer.invoke('get-dynasty-code-for-save', { savePath }),
  getSaveInfo: (savePath) => ipcRenderer.invoke('get-save-info', { savePath }),
  runEngine: (savePath, settings) => ipcRenderer.invoke('run-engine', { savePath, settings }),
  commitChanges: (savePath, engineResults, teamNamesToApply, backupDir, settings) =>
    ipcRenderer.invoke('commit-changes', { savePath, engineResults, teamNamesToApply, backupDir, settings }),
});
