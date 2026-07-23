/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. Scans an entire save
 * for structural corruption in the pipeline-influence system: rows
 * claimed by more than one team (a real collision -- should never
 * happen if only one tool is ever writing to this table, but becomes a
 * live risk the moment a SECOND tool also claims "unused" rows for its
 * own purposes without knowing about this one's allocations), rows that
 * don't actually exist in the pipeline table, and pipeline rows with
 * obviously malformed content.
 *
 * Built specifically to investigate a reported crash at the season-2
 * offseason transition on a save that's been touched by both this tool
 * and a separate third-party recruiting tool.
 *
 * Usage: edit SAVE_PATH below, then:
 *   node check_save_integrity.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const { openSave, readTeamPipelineMapping, readPipelineRow } = require('./io/saveFile');

// ---- CONFIG -- edit this ----
const SAVE_PATH = 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-TEST-AUTOSAVE';
// ------------------------------

async function main() {
  const franchise = await openSave(SAVE_PATH);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);

  const teamNames = Object.values(teamsByIndex).map((t) => t.displayName);
  console.log(`Teams found: ${teamNames.length}`);
  console.log(`Pipeline table total rows: ${pipelineInfluenceTable.records.length}\n`);

  // ---- Check 1: cross-team row collisions ----
  // Maps each referenced row -> every team that claims it. Anything with
  // more than one team here is a real corruption -- two different teams'
  // data would be overwriting each other every time either one gets
  // written to.
  const rowOwners = {};
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) {
      if (!rowOwners[row]) rowOwners[row] = [];
      rowOwners[row].push(info.displayName);
    }
  }
  const collisions = Object.entries(rowOwners).filter(([, owners]) => owners.length > 1);

  console.log('=== Check 1: Cross-team row collisions ===');
  if (collisions.length === 0) {
    console.log('None found -- every referenced row belongs to exactly one team.\n');
  } else {
    console.log(`FOUND ${collisions.length} colliding row(s):`);
    collisions.forEach(([row, owners]) => console.log(`  Row ${row} claimed by: ${owners.join(', ')}`));
    console.log('');
  }

  // ---- Check 2: out-of-bounds row references ----
  // A team pointing at a row number that doesn't actually exist in the
  // pipeline table -- would explain a crash if the game tries to read
  // through that reference and finds nothing there.
  console.log('=== Check 2: Out-of-bounds row references ===');
  const outOfBounds = [];
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) {
      if (row < 0 || row >= pipelineInfluenceTable.records.length || !pipelineInfluenceTable.records[row]) {
        outOfBounds.push({ team: info.displayName, row });
      }
    }
  }
  if (outOfBounds.length === 0) {
    console.log('None found -- every referenced row exists in the pipeline table.\n');
  } else {
    console.log(`FOUND ${outOfBounds.length} out-of-bounds reference(s):`);
    outOfBounds.forEach((o) => console.log(`  ${o.team} -> row ${o.row} (table has ${pipelineInfluenceTable.records.length} rows)`));
    console.log('');
  }

  // ---- Check 3: malformed pipeline content ----
  // Anything readPipelineRow can't cleanly parse into [tier, region, value].
  console.log('=== Check 3: Malformed pipeline row content ===');
  const malformed = [];
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) {
      let entry;
      try {
        entry = readPipelineRow(pipelineInfluenceTable, row);
      } catch (err) {
        malformed.push({ team: info.displayName, row, reason: err.message });
        continue;
      }
      if (!entry) {
        malformed.push({ team: info.displayName, row, reason: 'readPipelineRow returned nothing' });
        continue;
      }
      const [tier, region, value] = entry;
      if (tier === undefined || region === undefined || typeof value !== 'number' || Number.isNaN(value)) {
        malformed.push({ team: info.displayName, row, reason: `tier=${tier}, region=${region}, value=${value}` });
      }
    }
  }
  if (malformed.length === 0) {
    console.log('None found -- every row parses cleanly.\n');
  } else {
    console.log(`FOUND ${malformed.length} malformed row(s):`);
    malformed.forEach((m) => console.log(`  ${m.team} -> row ${m.row}: ${m.reason}`));
    console.log('');
  }

  // ---- Check 4: real slot count distribution ----
  // A quick sanity overview -- anything wildly outside 1-42 is worth a
  // second look even if it's not an outright structural error.
  console.log('=== Check 4: Real slot count distribution ===');
  const counts = {};
  for (const info of Object.values(teamsByIndex)) {
    counts[info.rows4306.length] = (counts[info.rows4306.length] || 0) + 1;
  }
  console.log('Slot count -> number of teams:', JSON.stringify(counts, null, 1));
  const suspicious = Object.values(teamsByIndex).filter((info) => info.rows4306.length === 0 || info.rows4306.length > 42);
  if (suspicious.length) {
    console.log(`\nSUSPICIOUS (0 slots or more than the confirmed structural max of 42):`);
    suspicious.forEach((info) => console.log(`  ${info.displayName}: ${info.rows4306.length} slots`));
  }

  console.log('\n=== Summary ===');
  console.log(`Collisions: ${collisions.length}, Out-of-bounds: ${outOfBounds.length}, Malformed: ${malformed.length}, Suspicious counts: ${suspicious.length}`);
  if (collisions.length || outOfBounds.length || malformed.length) {
    console.log('This save has real structural problems in its pipeline data -- worth investigating further before trusting it.');
  } else {
    console.log('No structural problems found in the pipeline-influence system specifically. If the crash is real, it may be coming from something this script doesn\'t check (a different table entirely, or something the other recruiting tool touches that has nothing to do with pipelines).');
  }
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
