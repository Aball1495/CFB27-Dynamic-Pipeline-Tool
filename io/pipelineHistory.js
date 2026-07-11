/**
 * Persistent history of applied pipeline snapshots, one entry per
 * dynasty/team/season. Lives in userData (same place as
 * pipeline-tool-settings.json), NOT inside the dynasty save file itself,
 * and NOT next to the app -- so it survives app updates/reinstalls and
 * isn't tied to any one save file's folder location.
 *
 * Structure:
 * {
 *   "<dynastyCode>": {
 *     "Bowling Green": {
 *       "2026": { "Ohio": "HouseholdName", "Michigan": "Popular" },
 *       "2027": { ... }
 *     },
 *     "Toledo": { ... }
 *   },
 *   "<other-dynasty-code>": { ... }
 * }
 *
 * A brief experiment wrapped season entries as { tiers, coaches } to also
 * track coaching staff per season -- that idea got scrapped (too much
 * clutter in the History view for too little value), so this reverted
 * back to the plain flat format. Any entries that got written in the
 * wrapped format during that window are harmless leftovers; nothing
 * reads or writes that shape anymore.
 *
 * Re-applying the same team in the same season overwrites that season's
 * entry rather than duplicating it -- history is always "the last Apply
 * for this team, this season," matching how the tool is actually used
 * (you might re-run and re-apply a few times while testing settings
 * before landing on final numbers for that preseason).
 */
const fs = require('fs');
const path = require('path');

function historyPath(app) {
  return path.join(app.getPath('userData'), 'pipeline-history.json');
}

function loadHistory(app) {
  const p = historyPath(app);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error('Failed to parse pipeline-history.json, starting fresh:', err);
    return {};
  }
}

function saveHistory(app, history) {
  fs.writeFileSync(historyPath(app), JSON.stringify(history, null, 2), 'utf8');
}

/**
 * Records one team's post-Apply tier assignments for a given dynasty and
 * season. Call this once per applied team, right after a successful
 * commit-changes write.
 *
 * @param {Electron.App} app
 * @param {string} dynastyCode
 * @param {string|number} season
 * @param {string} teamName
 * @param {Array<[tier, region, value]>} afterEntries - same shape as
 *   engineResults[teamName].after
 */
function recordSnapshot(app, dynastyCode, season, teamName, afterEntries) {
  const history = loadHistory(app);
  if (!history[dynastyCode]) history[dynastyCode] = {};
  if (!history[dynastyCode][teamName]) history[dynastyCode][teamName] = {};

  const tiersByRegion = {};
  for (const [tier, region] of afterEntries) tiersByRegion[region] = tier;

  history[dynastyCode][teamName][String(season)] = tiersByRegion;
  saveHistory(app, history);
}

module.exports = { loadHistory, saveHistory, recordSnapshot };
