/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. Checks for
 * SchoolPipelineInfluence rows currently claimed by MORE THAN ONE team at
 * once -- the specific inconsistency that would explain a write like:
 *   "Row 392 (team index 19) didn't match after writing (expected
 *   [...team 19's data...], found [...another team's real data...])"
 *
 * Every other check today looked for rows with NO owner (holes, orphans).
 * This is the first check for a row with TWO owners -- something that
 * should never happen if only the tool's own shrink/expand ever touched a
 * save, but could plausibly result from several rounds of manual,
 * independently-verified-but-never-cross-tested relinking (today's
 * standalone test scripts) applied in sequence to an evolving save lineage.
 *
 * Usage: edit SAVE_PATH below, then:
 *   node check_duplicate_ownership.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const { openSave, TABLE_UNIQUE_IDS, readTeamPipelineMapping } = require('./io/saveFile');

// Row 0 is PLACEHOLDER_ROW -- intentionally shared by every team's shrunk
// excess slots (see saveFile.js). Many teams legitimately claiming it at
// once is the fix working correctly, not a collision. Excluded below so
// it never gets reported as one.
const PLACEHOLDER_ROW = 0;

// ---- CONFIG -- edit this ----
const SAVE_PATH = 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-FMTEST10';
// ------------------------------

async function main() {
  const franchise = await openSave(SAVE_PATH);
  const { teamsByIndex } = await readTeamPipelineMapping(franchise);

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();

  const owners = new Map(); // rowNumber -> [teamIndex, teamIndex, ...]
  for (const [teamIndex, info] of Object.entries(teamsByIndex)) {
    for (const row of info.rows4306) {
      if (!owners.has(row)) owners.set(row, []);
      owners.get(row).push(Number(teamIndex));
    }
  }

  const duplicates = [];
  for (const [row, teamIndices] of owners) {
    if (row === PLACEHOLDER_ROW) continue; // intentionally shared, not a collision
    if (teamIndices.length > 1) duplicates.push({ row, teamIndices });
  }

  console.log(`Total distinct rows referenced: ${owners.size}`);
  console.log(`Rows with MORE THAN ONE owner: ${duplicates.length}\n`);

  if (duplicates.length === 0) {
    console.log('No duplicate ownership found. The collision, if real, isn\'t visible as');
    console.log('two teams sharing a row in the CURRENT read -- worth checking whether the');
    console.log('save being Applied was a slightly different/older copy than this one, or');
    console.log('re-running the same Apply again to see if the error is reproducible at all.');
    return;
  }

  duplicates.forEach(({ row, teamIndices }) => {
    const names = teamIndices.map((ti) => {
      const rec = teamTable.records.find((r) => r.TeamIndex === ti);
      return rec ? `${rec.DisplayName} (index ${ti})` : `index ${ti}`;
    });
    console.log(`  Row ${row} claimed by: ${names.join(' AND ')}`);
  });

  console.log('\nAny row listed above is claimed by more than one team at once -- whichever');
  console.log('team writes to it LAST during Apply\'s Pass 3 wins, and the other team\'s');
  console.log('verification check will fail exactly the way the reported error described.');
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
