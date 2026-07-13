/**
 * Direct save-file read/write, using madden-franchise. Replaces the entire
 * xlsx export/import workflow -- no Franchise Editor exports needed at all.
 *
 * Tables are looked up by UNIQUE ID, never by name and never by numeric
 * table ID. Name-based lookup is unreliable in this schema (proved early
 * in this project -- Team in particular only found 9/143 records by name,
 * but all 143 by ID). Numeric table ID is NOT safe either, on advice from
 * the CFB27 modding community: that number is assigned per game build and
 * can shift on a patch, which would make getTableById() silently return
 * the WRONG table after an update -- not an error, just quietly wrong
 * data, which is a much worse failure mode than a crash since it could
 * write garbage into someone's save. Unique ID (found in a table's
 * header, distinct from its table ID) is the community-recommended
 * stable identifier and is what every lookup below actually uses.
 *
 * Confirmed against a real save (2026-07 build) -- both values shown for
 * reference, but only uniqueId is actually used for lookups below:
 *   Team                       -> tableId 6334,  uniqueId 3359508968
 *   SchoolPipelineInfluence[]  -> tableId 5919,  uniqueId 3284177001
 *   SchoolPipelineInfluence    -> tableId 4306,  uniqueId 4261714800
 *   Player                     -> tableId 4244,  uniqueId 1612938518
 *   Coach                      -> tableId 4173,  uniqueId 1860529246
 *   Franchise                  -> tableId 4553,  uniqueId 2226370608
 *   SeasonInfo                 -> tableId 4141,  uniqueId 3123991521
 * If a future game update ever changes the underlying schema enough that
 * these uniqueIds themselves stop resolving, getTableByUniqueId() throws
 * rather than silently returning something wrong -- a loud, obvious
 * failure instead of quiet data corruption.
 *
 * SAFETY: writeUpdatedSave() NEVER modifies your original save file. It
 * always works on a copy, and the original path you opened is never
 * touched, no matter what.
 */

const fs = require('fs');
const path = require('path');
const Franchise = require('madden-franchise');

const TABLE_UNIQUE_IDS = {
  team: 3359508968,
  schoolPipelineInfluenceList: 3284177001,
  schoolPipelineInfluence: 4261714800,
  player: 1612938518,
  coach: 1860529246,
  franchise: 2226370608,
  seasonInfo: 3123991521,
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
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.franchise);
  await table.readRecords(['LeagueID']);
  return String(table.records[0].LeagueID);
}

/**
 * The actual displayed calendar year for the dynasty's current season
 * (confirmed against a real save: SeasonInfo.CurrentSeasonYear, which
 * lines up exactly with BaseCalendarYear + CurrentYear).
 */
async function readCurrentSeason(franchise) {
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.seasonInfo);
  await table.readRecords(['CurrentSeasonYear']);
  return table.records[0].CurrentSeasonYear;
}

/**
 * Which team the actual person is playing as, confirmed against a real
 * save: the Coach table's HeadCoach record with IsUserControlled === true,
 * cross-referenced against the Team table for the display name.
 * Returns null if nothing matches (e.g. a spectator-only save, if that's
 * even possible in this game).
 */
async function readUserTeam(franchise) {
  const coachTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.coach);
  await coachTable.readRecords();
  const userCoach = coachTable.records.find((r) => r.Position === 'HeadCoach' && r.IsUserControlled === true);
  if (!userCoach) return null;

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const teamRecord = teamTable.records.find((r) => r.TeamIndex === userCoach.TeamIndex);
  if (!teamRecord) return null;

  return { teamIndex: userCoach.TeamIndex, displayName: teamRecord.DisplayName };
}

/**
 * Reads the Team table (filtering out the handful of non-real placeholder
 * rows -- blank DisplayName or TeamIndex 255, the same sentinel pattern
 * we've seen elsewhere in this schema), then for each real team follows
 * SchoolPipelineInfluenceList -> the list table -> the actual 10 rows in
 * SchoolPipelineInfluence, using the field's built-in .referenceData
 * (confirmed reliable -- no manual bit-math needed for this part).
 *
 * Reference pointers store their OWN copy of the target table's numeric
 * tableId (that's just how this binary format encodes "this field points
 * at row N of table X"). We validate against each table's actual,
 * freshly-resolved .header.tableId rather than a hardcoded constant --
 * since we just looked that table up by its stable uniqueId, its
 * .header.tableId is guaranteed correct for whatever this specific file's
 * game build actually assigned, even if that number differs from a
 * previous game version.
 *
 * Returns:
 *   {
 *     teamsByIndex: { [teamIndex]: { displayName, rows4306: [10 row numbers] } },
 *     pipelineInfluenceTable: <live table object, for reading/writing rows directly>,
 *   }
 */
async function readTeamPipelineMapping(franchise) {
  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();

  const listTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();

  const pipelineInfluenceTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluence);
  await pipelineInfluenceTable.readRecords();

  const listTableId = listTable.header.tableId;
  const pipelineTableId = pipelineInfluenceTable.header.tableId;

  const teamsByIndex = {};

  for (const teamRecord of teamTable.records) {
    if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue; // skip placeholder rows

    const listField = teamRecord.getFieldByKey('SchoolPipelineInfluenceList');
    const listRef = listField.referenceData; // { tableId, rowNumber }
    if (!listRef || listRef.tableId !== listTableId) continue;

    const listRecord = listTable.records[listRef.rowNumber];
    if (!listRecord) continue;

    const rows4306 = [];
    for (let i = 0; i < 10; i++) {
      const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
      if (!field) continue;
      const ref = field.referenceData;
      if (ref && ref.tableId === pipelineTableId) {
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
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.player);
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
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.coach);
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
  const pipelineInfluenceTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluence);
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

  // Post-write verification: re-open the fresh copy (a completely separate
  // read from what was just written, not trusting in-memory state) and
  // confirm every intended change actually landed. Cheap insurance for the
  // one operation in this whole app that touches a copy of someone's save.
  let verified = true;
  let verificationError = null;
  try {
    const verifyFranchise = await Franchise.create(outputPath);
    const verifyTable = verifyFranchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluence);
    await verifyTable.readRecords();
    for (const [rowStr, update] of Object.entries(updatesByRow4306)) {
      const row = Number(rowStr);
      const record = verifyTable.records[row];
      const matches = record
        && record.InfluenceLevel === update.InfluenceLevel
        && record.Pipeline === update.Pipeline
        && record.InfluenceValue === update.InfluenceValue;
      if (!matches) {
        verified = false;
        verificationError = `Row ${row} didn't match after writing (expected ${JSON.stringify(update)}, found ${record ? JSON.stringify({ InfluenceLevel: record.InfluenceLevel, Pipeline: record.Pipeline, InfluenceValue: record.InfluenceValue }) : 'no record at all'}).`;
        break;
      }
    }
  } catch (err) {
    verified = false;
    verificationError = `Could not verify the write: ${err.message}`;
  }

  return { outputPath, verified, verificationError };
}

module.exports = {
  TABLE_UNIQUE_IDS,
  openSave,
  readTeamPipelineMapping,
  readPlayers,
  readCoaches,
  readPipelineRow,
  writeUpdatedSave,
  readDynastyCode,
  readCurrentSeason,
  readUserTeam,
};
