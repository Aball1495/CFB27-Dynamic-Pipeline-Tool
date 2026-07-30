/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. General status check:
 * dynasty code, current season, user's team, and pipeline table health
 * (any null-referenced slots right now, how many teams are currently
 * over the maxPipelines=10 cap, total orphan/unowned rows).
 *
 * Usage: edit SAVE_PATH below, then:
 *   node check_status.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const {
  openSave,
  TABLE_UNIQUE_IDS,
  readTeamPipelineMapping,
  readDynastyCode,
  readCurrentSeason,
  readUserTeam,
} = require('./io/saveFile');

// ---- CONFIG -- pass the save path as a command-line argument ----
const SAVE_PATH = process.argv[2];
if (!SAVE_PATH) {
  console.log('Usage: node check_status.cjs "<savePath>"');
  process.exit(1);
}
// ------------------------------

function isNullRef(ref) {
  return !ref || (ref.tableId === 0 && ref.rowNumber === 0);
}

async function main() {
  const franchise = await openSave(SAVE_PATH);

  console.log(`=== Save: ${SAVE_PATH} ===\n`);

  try {
    const dynastyCode = await readDynastyCode(franchise);
    console.log(`Dynasty code: ${dynastyCode}`);
  } catch (err) {
    console.log(`Dynasty code: (couldn't read -- ${err.message})`);
  }

  try {
    const season = await readCurrentSeason(franchise);
    console.log(`Current season: ${JSON.stringify(season)}`);
  } catch (err) {
    console.log(`Current season: (couldn't read -- ${err.message})`);
  }

  try {
    const userTeam = await readUserTeam(franchise);
    console.log(`User team: ${JSON.stringify(userTeam)}`);
  } catch (err) {
    console.log(`User team: (couldn't read -- ${err.message})`);
  }

  console.log('\n=== Pipeline table health ===');
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const listTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();

  // Teams over the maxPipelines=10 cap right now, by real slot count.
  const overCap = [];
  for (const [teamIndex, info] of Object.entries(teamsByIndex)) {
    if (info.rows4306.length > 10) {
      const teamRecord = teamTable.records.find((r) => r.TeamIndex === Number(teamIndex));
      overCap.push({ teamName: teamRecord ? teamRecord.DisplayName : `index ${teamIndex}`, count: info.rows4306.length });
    }
  }
  console.log(`Teams currently over the 10-pipeline cap: ${overCap.length}`);
  overCap.forEach((t) => console.log(`  ${t.teamName}: ${t.count}`));

  // NOTE: an earlier version of this section scanned every slot up to
  // index 50 looking for nulls, the same way the very first relink_test.cjs
  // attempt did -- and hit the exact same false-positive problem: most
  // teams naturally have real slots well below their full structural
  // capacity, so scanning blindly counts thousands of normal, always-empty
  // slots as "null" without any way to tell them apart from a genuine
  // regression. That check has been removed. The orphan-row count below
  // is the reliable signal -- it only counts rows with no owner at all,
  // which check_orphan_tiers.cjs confirmed is 0 in any untouched save.

  // Orphan (unowned) rows.
  const referencedRows = new Set();
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) referencedRows.add(row);
  }
  let orphanCount = 0;
  for (let i = 0; i < pipelineInfluenceTable.records.length; i++) {
    if (!referencedRows.has(i)) orphanCount++;
  }
  console.log(`\nOrphan (unowned) pipeline rows: ${orphanCount} out of ${pipelineInfluenceTable.records.length} total rows`);
  console.log('(Note: check_orphan_tiers.cjs found this is normally 0 in vanilla/untouched saves --');
  console.log('any nonzero count here was introduced by a shrink at some point in this save\'s history.)');
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
