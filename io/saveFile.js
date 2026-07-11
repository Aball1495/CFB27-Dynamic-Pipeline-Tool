/**
 * Direct save-file read/write, using madden-franchise. Replaces the entire
 * xlsx export/import workflow -- no Franchise Editor exports needed at all.
 *
 * Every table is accessed by its numeric ID (not name), since we proved
 * name-based lookup misses most records for some tables (Team in
 * particular only found 9/143 by name, but all 143 by ID). These IDs have
 * been stable and correct since the very start of this project:
 *   Team                     -> 6334
 *   SchoolPipelineInfluence[] (list) -> 5919
 *   SchoolPipelineInfluence   -> 4306
 *   Player                    -> 4244
 *   Coach                     -> 4173
 *
 * SAFETY: writeUpdatedSave() NEVER modifies your original save file. It
 * always works on a copy, and the original path you opened is never
 * touched, no matter what.
 */

const fs = require('fs');
const path = require('path');
const Franchise = require('madden-franchise');

const TABLE_IDS = {
  team: 6334,
  schoolPipelineInfluenceList: 5919,
  schoolPipelineInfluence: 4306,
  player: 4244,
  coach: 4173,
  franchise: 4553,   // Franchise.LeagueID -- stable per-dynasty numeric ID
  seasonInfo: 4141,  // SeasonInfo.CurrentSeasonYear -- the actual displayed year
};

async function openSave(savePath) {
  return Franchise.create(savePath);
}

/**
 * A stable numeric ID for this specific dynasty, confirmed against a real
 * save (Franchise.LeagueID). Used to key the local pipeline-history.json
 * file so multiple dynasties/saves never mix history together.
 */
async function readDynastyCode(franchise) {
  const table = franchise.getTableById(TABLE_IDS.franchise);
  await table.readRecords(['LeagueID']);
  return String(table.records[0].LeagueID);
}

/**
 * The actual displayed calendar year for the dynasty's current season
 * (confirmed against a real save: SeasonInfo.CurrentSeasonYear, which
 * lines up exactly with BaseCalendarYear + CurrentYear).
 */
async function readCurrentSeason(franchise) {
  const table = franchise.getTableById(TABLE_IDS.seasonInfo);
  await table.readRecords(['CurrentSeasonYear']);
  return table.records[0].CurrentSeasonYear;
}

/**
 * Reads the Team table (filtering out the handful of non-real placeholder
 * rows -- blank DisplayName or TeamIndex 255, the same sentinel pattern
 * we've seen elsewhere in this schema), then for each real team follows
 * SchoolPipelineInfluenceList -> the list table -> the actual 10 rows in
 * SchoolPipelineInfluence, using the field's built-in .referenceData
 * (confirmed reliable -- no manual bit-math needed for this part).
 *
 * Returns:
 *   {
 *     teamsByIndex: { [teamIndex]: { displayName, rows4306: [10 row numbers] } },
 *     pipelineInfluenceTable: <live table object, for reading/writing rows directly>,
 *   }
 */
async function readTeamPipelineMapping(franchise) {
  const teamTable = franchise.getTableById(TABLE_IDS.team);
  await teamTable.readRecords();

  const listTable = franchise.getTableById(TABLE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();

  const pipelineInfluenceTable = franchise.getTableById(TABLE_IDS.schoolPipelineInfluence);
  await pipelineInfluenceTable.readRecords();

  const teamsByIndex = {};

  for (const teamRecord of teamTable.records) {
    if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue; // skip placeholder rows

    const listField = teamRecord.getFieldByKey('SchoolPipelineInfluenceList');
    const listRef = listField.referenceData; // { tableId: 5919, rowNumber: N }
    if (!listRef || listRef.tableId !== TABLE_IDS.schoolPipelineInfluenceList) continue;

    const listRecord = listTable.records[listRef.rowNumber];
    if (!listRecord) continue;

    const rows4306 = [];
    for (let i = 0; i < 10; i++) {
      const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
      if (!field) continue;
      const ref = field.referenceData;
      if (ref && ref.tableId === TABLE_IDS.schoolPipelineInfluence) {
        rows4306.push(ref.rowNumber);
      }
    }

    teamsByIndex[teamRecord.TeamIndex] = {
      displayName: teamRecord.DisplayName,
      rows4306,
    };
  }

  return { teamsByIndex, pipelineInfluenceTable };
}

/** Player table -> { [teamIndex]: [{ pipeline, state, star }, ...] } */
async function readPlayers(franchise) {
  const table = franchise.getTableById(TABLE_IDS.player);
  await table.readRecords();
  const byTeam = {};
  for (const r of table.records) {
    const ti = r.TeamIndex;
    if (!byTeam[ti]) byTeam[ti] = [];
    byTeam[ti].push({ pipeline: r.HomePipeline, state: r.PLYR_HOME_STATE, star: r.ProspectStarRating });
  }
  return byTeam;
}

/** Coach table -> { [teamIndex]: { HeadCoach: {...}, OffensiveCoordinator: {...}, DefensiveCoordinator: {...} } } */
async function readCoaches(franchise) {
  const table = franchise.getTableById(TABLE_IDS.coach);
  await table.readRecords();
  const byTeam = {};
  const relevant = new Set(['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator']);
  for (const r of table.records) {
    if (!relevant.has(r.Position)) continue;
    const ti = r.TeamIndex;
    if (!byTeam[ti]) byTeam[ti] = {};
    byTeam[ti][r.Position] = {
      pipeline: r.PrimaryPipeline,
      seasons: r.SeasonsWithTeam || 0,
      name: `${r.FirstName || ''} ${r.LastName || ''}`.trim(),
    };
  }
  return byTeam;
}

/**
 * Given a live SchoolPipelineInfluence table and a specific row number,
 * returns [tierName, regionName, value] -- matching the shape the engine
 * already expects for "prior entries".
 */
function readPipelineRow(pipelineInfluenceTable, rowNumber) {
  const r = pipelineInfluenceTable.records[rowNumber];
  if (!r) return null;
  return [r.InfluenceLevel, r.Pipeline, r.InfluenceValue];
}

/**
 * Writes recomputed values back. ALWAYS works on a copy -- the original
 * save at savePath is opened read-only in spirit; we never call .save() on
 * a franchise instance tied to the original path. A fresh copy is made
 * first, a fresh Franchise instance opens that copy, the edits happen
 * there, and that copy is what gets saved.
 *
 * @param {string} savePath - original save file (never modified)
 * @param {Object} updatesByRow4306 - { [rowNumber]: { InfluenceLevel, Pipeline, InfluenceValue } }
 * @param {string} outputDir - where to place the new save copy
 * @returns {{ outputPath: string }}
 */
async function writeUpdatedSave(savePath, updatesByRow4306, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(savePath);
  const outputPath = path.join(outputDir, `${base}-PIPELINES-${timestamp}`);

  fs.copyFileSync(savePath, outputPath);

  const franchise = await Franchise.create(outputPath);
  const pipelineInfluenceTable = franchise.getTableById(TABLE_IDS.schoolPipelineInfluence);
  await pipelineInfluenceTable.readRecords();

  for (const [rowStr, update] of Object.entries(updatesByRow4306)) {
    const row = Number(rowStr);
    const record = pipelineInfluenceTable.records[row];
    if (!record) continue;
    record.InfluenceLevel = update.InfluenceLevel;
    record.Pipeline = update.Pipeline;
    record.InfluenceValue = update.InfluenceValue;
  }

  await franchise.save();

  return { outputPath };
}

module.exports = {
  TABLE_IDS,
  openSave,
  readTeamPipelineMapping,
  readPlayers,
  readCoaches,
  readPipelineRow,
  writeUpdatedSave,
  readDynastyCode,
  readCurrentSeason,
};
