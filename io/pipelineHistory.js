/**
 * Persistent history of applied pipeline snapshots, one entry per
 * dynasty/team/season. Lives in userData (same place as
 * pipeline-tool-settings.json), NOT inside the dynasty save file itself,
 * and NOT next to the app -- so it survives app updates/reinstalls and
 * isn't tied to any one save file's folder location.
 *
 * Structure (current):
 * {
 *   "<dynastyCode>": {
 *     "Bowling Green": {
 *       "2026": { "Ohio": { "tier": "HouseholdName", "value": 220 }, ... },
 *       "2027": { ... }
 *     },
 *     "Toledo": { ... }
 *   },
 *   "<other-dynasty-code>": { ... }
 * }
 *
 * Older entries (recorded before value tracking was added back) are a
 * flat { region: tierString } object instead -- readers need to check
 * whether a region's entry is a string or an object to tell the two
 * formats apart. Those older seasons simply have no score to show;
 * nothing needs to be migrated. (A separate, now-scrapped experiment
 * also tried tracking coaching staff per season under a {tiers, coaches}
 * wrapper -- if any entries got written in that shape, they're harmless
 * leftovers; nothing reads or writes that shape anymore.)
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
 * Records one team's post-Apply tier assignments AND scores for a given
 * dynasty and season. Call this once per applied team, right after a
 * successful commit-changes write.
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

  const byRegion = {};
  for (const [tier, region, value] of afterEntries) byRegion[region] = { tier, value };

  history[dynastyCode][teamName][String(season)] = byRegion;
  saveHistory(app, history);
}

module.exports = { loadHistory, saveHistory, recordSnapshot };
