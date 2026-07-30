/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. Compares Army/Navy/Air
 * Force's exact SchoolPipelineInfluence content (region + tier + value)
 * between two save checkpoints. academyExempt: true is supposed to set
 * these three teams up ONCE and never touch them again on any future
 * Apply -- if that's actually working, every one of their slots should
 * be byte-for-byte identical between any two checkpoints, regardless of
 * how many seasons apart they are. Any difference found here is a real
 * gap between that setting's intent and its actual behavior.
 *
 * Usage: edit SAVE_A / SAVE_B below (any two checkpoints, ideally spanning
 * several seasons), then:
 *   node check_academy_stability.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const { openSave, TABLE_UNIQUE_IDS, readTeamPipelineMapping } = require('./io/saveFile');

// ---- CONFIG -- edit these ----
const SAVE_A = { label: 'FMTEST1', path: 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-FMTEST1' };
const SAVE_B = { label: 'FMTEST10', path: 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-FMTEST10' };
const ACADEMY_TEAMS = ['Army', 'Navy', 'Air Force'];
// ------------------------------

async function readAcademyAssignments(savePath) {
  const franchise = await openSave(savePath);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);
  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();

  const result = {};
  for (const teamName of ACADEMY_TEAMS) {
    const teamRecord = teamTable.records.find((r) => r.DisplayName === teamName);
    if (!teamRecord) { result[teamName] = null; continue; }
    const info = teamsByIndex[teamRecord.TeamIndex];
    if (!info) { result[teamName] = null; continue; }

    const slots = info.rows4306.map((row) => {
      const rec = pipelineInfluenceTable.records[row];
      return rec ? `${rec.Pipeline}:${rec.InfluenceLevel}:${rec.InfluenceValue}` : `(missing row ${row})`;
    });
    result[teamName] = slots;
  }
  return result;
}

async function main() {
  console.log(`Reading ${SAVE_A.label}...`);
  const a = await readAcademyAssignments(SAVE_A.path);
  console.log(`Reading ${SAVE_B.label}...\n`);
  const b = await readAcademyAssignments(SAVE_B.path);

  let anyDifference = false;

  for (const teamName of ACADEMY_TEAMS) {
    console.log(`=== ${teamName} ===`);
    const slotsA = a[teamName];
    const slotsB = b[teamName];

    if (!slotsA || !slotsB) {
      console.log(`  Couldn't read this team in one of the two saves.`);
      continue;
    }

    if (slotsA.length !== slotsB.length) {
      console.log(`  SLOT COUNT DIFFERS: ${SAVE_A.label} has ${slotsA.length}, ${SAVE_B.label} has ${slotsB.length}`);
      anyDifference = true;
      continue;
    }

    const setA = new Set(slotsA);
    const setB = new Set(slotsB);
    const onlyInA = slotsA.filter((s) => !setB.has(s));
    const onlyInB = slotsB.filter((s) => !setA.has(s));

    if (onlyInA.length === 0 && onlyInB.length === 0) {
      console.log(`  IDENTICAL -- all ${slotsA.length} slots match exactly between both checkpoints.`);
    } else {
      anyDifference = true;
      console.log(`  DIFFERS -- ${onlyInA.length} slot(s) changed:`);
      console.log(`    Only in ${SAVE_A.label}: ${onlyInA.join(', ') || '(none)'}`);
      console.log(`    Only in ${SAVE_B.label}: ${onlyInB.join(', ') || '(none)'}`);
    }
    console.log('');
  }

  console.log(anyDifference
    ? 'DIFFERENCES FOUND -- academyExempt is not fully holding these teams static across seasons.'
    : 'No differences found -- academyExempt appears to be working as designed for this pair of checkpoints.');
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
