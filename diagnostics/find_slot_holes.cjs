/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. Looks for a
 * structural pattern none of the existing scripts can see: a NULL
 * slot sitting BEFORE a real (validly-referenced) slot on the same
 * team's SchoolPipelineInfluenceList.
 *
 * Every existing check (check_save_integrity_S4/S5, the utilization
 * checker, readTeamPipelineMapping itself) assumes each team's real
 * slots are contiguous from index 0 and simply stops at the first
 * invalid one. That's correct for how expandTeamPipelineSlots and
 * shrinkTeamPipelineSlots write things -- but if ANY hole ever ended
 * up sitting in the middle of a team's slot list (from this tool, an
 * earlier build of it, or something else entirely), nothing built so
 * far would ever see it, because everything stops reading at the
 * first gap and never looks past it.
 *
 * This scans every slot field a team actually has (not just the
 * contiguous prefix) and flags any case where a null slot is followed,
 * at a higher index, by a real one. That's a hole the game's own
 * iteration could walk straight into, regardless of which season or
 * which save first created it -- doesn't require a BEFORE file.
 *
 * Usage: edit SAVE_PATH below, then:
 *   node find_slot_holes.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const { openSave, TABLE_UNIQUE_IDS } = require('./io/saveFile');

// ---- CONFIG -- edit this ----
const SAVE_PATH = 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-FMTEST10';
// ------------------------------

function isNullRef(ref) {
  return !ref || (ref.tableId === 0 && ref.rowNumber === 0);
}

async function main() {
  const franchise = await openSave(SAVE_PATH);

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const listTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();
  const pipelineInfluenceTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluence);
  await pipelineInfluenceTable.readRecords();
  const pipelineTableId = pipelineInfluenceTable.header.tableId;
  const listTableId = listTable.header.tableId;

  console.log('Scanning every team\'s FULL slot list (not just the contiguous prefix) for holes...\n');

  const teamsWithHoles = [];

  for (const teamRecord of teamTable.records) {
    if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue;

    const listField = teamRecord.getFieldByKey('SchoolPipelineInfluenceList');
    const listRef = listField.referenceData;
    if (!listRef || listRef.tableId !== listTableId) continue;
    const listRecord = listTable.records[listRef.rowNumber];
    if (!listRecord) continue;

    // Read the FULL slot pattern for this team, not stopping at the
    // first gap -- true/false per index, up to wherever the field
    // structure itself actually ends.
    const pattern = [];
    for (let i = 0; i < 50; i++) {
      const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
      if (!field) break; // structure genuinely ends here
      const ref = field.referenceData;
      const isReal = ref && ref.tableId === pipelineTableId && !isNullRef(ref);
      pattern.push({ index: i, isReal, row: isReal ? ref.rowNumber : null });
    }

    // A hole = any null slot with a real slot somewhere AFTER it.
    let sawNull = false;
    let firstNullIndex = null;
    const holesForTeam = [];
    for (const slot of pattern) {
      if (!slot.isReal) {
        if (!sawNull) firstNullIndex = slot.index;
        sawNull = true;
      } else if (sawNull) {
        holesForTeam.push({ afterNullAt: firstNullIndex, realSlotIndex: slot.index, row: slot.row });
      }
    }

    if (holesForTeam.length > 0) {
      teamsWithHoles.push({ teamName: teamRecord.DisplayName, pattern, holesForTeam });
    }
  }

  if (teamsWithHoles.length === 0) {
    console.log('No holes found -- every team\'s real slots are cleanly contiguous from index 0.');
    console.log('If the crash is still pipeline-related, it\'s not this specific pattern.');
    return;
  }

  console.log(`FOUND ${teamsWithHoles.length} team(s) with a non-contiguous hole:\n`);
  for (const t of teamsWithHoles) {
    const shape = t.pattern.map((s) => (s.isReal ? 'R' : '.')).join('');
    console.log(`${t.teamName}: ${shape}`);
    t.holesForTeam.forEach((h) => {
      console.log(`  -> null slot at index ${h.afterNullAt}, but real slot at index ${h.realSlotIndex} (row ${h.row}) comes AFTER it`);
    });
    console.log('');
  }

  console.log('Any team listed above has a real, in-use pipeline slot sitting past a null one.');
  console.log('readTeamPipelineMapping (and everything built on it) only sees slots up to the FIRST null,');
  console.log('so these real slots past the hole are currently invisible to every other script in this project.');
  console.log('If the game\'s own code walks the full list rather than stopping at the first gap, this is');
  console.log('exactly the kind of structure that would produce a null read partway through the walk.');
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
