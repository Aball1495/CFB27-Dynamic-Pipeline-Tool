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
 * @param {{targetCount: number, academyStatus: string|null}|null} meta -
 *   OPTIONAL settings context for this season (the max-pipelines target
 *   that was in effect, and this team's Academy Mode status, if any).
 *   Deliberately NOT stored inside history[dynastyCode][teamName][season]
 *   itself -- extractSeasonData() in app.js treats every key in that
 *   object as a region name, and openHistoryModal() treats every key
 *   under history[dynastyCode] as a team name. Adding a sibling key
 *   anywhere in that tree would get misread as a bogus region or team.
 *   Instead this lives in a fully separate top-level tree
 *   (history.__settingsMeta) that neither of those ever looks at.
 */
function recordSnapshot(app, dynastyCode, season, teamName, afterEntries, meta = null) {
  const history = loadHistory(app);
  if (!history[dynastyCode]) history[dynastyCode] = {};
  if (!history[dynastyCode][teamName]) history[dynastyCode][teamName] = {};

  const byRegion = {};
  for (const [tier, region, value] of afterEntries) byRegion[region] = { tier, value };

  history[dynastyCode][teamName][String(season)] = byRegion;

  if (meta) {
    if (!history.__settingsMeta) history.__settingsMeta = {};
    if (!history.__settingsMeta[dynastyCode]) history.__settingsMeta[dynastyCode] = {};
    if (!history.__settingsMeta[dynastyCode][teamName]) history.__settingsMeta[dynastyCode][teamName] = {};
    history.__settingsMeta[dynastyCode][teamName][String(season)] = meta;
  }

  saveHistory(app, history);
}

/**
 * Removes ONE season's entry for EVERY team under a given dynasty --
 * "clear 2027" removes 2027 from every team that has it, leaving every
 * other season for every team untouched. A team that only had that one
 * season recorded ends up with an empty {} for itself (not removed
 * entirely) -- harmless, and keeps this function simple/predictable
 * rather than also having to decide whether to prune now-empty teams.
 *
 * No-op (returns false) if the dynasty isn't found, or if no team under
 * it actually had that season -- lets the caller distinguish "nothing to
 * do" from "something was actually removed."
 *
 * @param {Electron.App} app
 * @param {string} dynastyCode
 * @param {string|number} season
 * @returns {boolean} true if at least one team's entry for this season was removed
 */
function deleteSeason(app, dynastyCode, season) {
  const history = loadHistory(app);
  const dynasty = history[dynastyCode];
  if (!dynasty) return false;

  const seasonKey = String(season);
  let removedAny = false;
  for (const teamName of Object.keys(dynasty)) {
    if (seasonKey in dynasty[teamName]) {
      delete dynasty[teamName][seasonKey];
      removedAny = true;
    }
  }

  if (removedAny) saveHistory(app, history);
  return removedAny;
}

/**
 * Removes an ENTIRE dynasty's history -- every team, every season. This
 * is the "all or nothing" option; use deleteSeason above for anything
 * more targeted.
 *
 * @param {Electron.App} app
 * @param {string} dynastyCode
 * @returns {boolean} true if this dynasty existed and was removed
 */
function deleteDynastyHistory(app, dynastyCode) {
  const history = loadHistory(app);
  if (!(dynastyCode in history)) return false;
  delete history[dynastyCode];
  saveHistory(app, history);
  return true;
}

module.exports = { loadHistory, saveHistory, recordSnapshot, deleteSeason, deleteDynastyHistory };
