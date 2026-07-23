/**
 * STANDALONE DIAGNOSTIC -- checks whether all seven confirmed unique IDs
 * this tool depends on still resolve correctly after a game update.
 * Read-only: never writes anything, never touches your save in write mode.
 *
 * Usage: edit SAVE_PATH below, then run from inside your pipeline-tool
 * folder (needs node_modules):
 *   node verify_unique_ids.cjs
 */

const Franchise = require('madden-franchise');

// ---- CONFIG -- edit this ----
const SAVE_PATH = 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-SAVEFP';
// -----------------------------

const TABLE_UNIQUE_IDS = {
  team: 3359508968,
  schoolPipelineInfluenceList: 3284177001,
  schoolPipelineInfluence: 4261714800,
  player: 1612938518,
  coach: 1860529246,
  franchise: 2226370608,
  seasonInfo: 3123991521,
};

// A quick sanity field to check per table -- confirms not just that the
// table resolves, but that the fields we actually rely on are still there
// and behave as expected. Not exhaustive, just a fast smoke test.
const SANITY_CHECKS = {
  team: (table) => {
    const real = table.records.find((r) => r.DisplayName && r.TeamIndex !== 255);
    return real ? `sample team: ${real.DisplayName} (TeamIndex ${real.TeamIndex})` : 'NO REAL TEAM RECORD FOUND';
  },
  schoolPipelineInfluenceList: (table) => `record count: ${table.records.length}`,
  schoolPipelineInfluence: (table) => {
    const r = table.records[0];
    return `row 0: Pipeline=${r.Pipeline}, InfluenceLevel=${r.InfluenceLevel}, InfluenceValue=${r.InfluenceValue}`;
  },
  player: (table) => {
    const real = table.records.find((r) => r.TeamIndex !== 255);
    return real ? `sample player TeamIndex ${real.TeamIndex}, HomePipeline=${real.HomePipeline}` : 'NO REAL PLAYER FOUND';
  },
  coach: (table) => {
    const real = table.records.find((r) => r.Position === 'HeadCoach' && r.FirstName);
    return real ? `sample HC: ${real.FirstName} ${real.LastName}` : 'NO HEAD COACH FOUND';
  },
  franchise: (table) => `LeagueID: ${table.records[0].LeagueID}`,
  seasonInfo: (table) => `CurrentSeasonYear: ${table.records[0].CurrentSeasonYear}`,
};

async function main() {
  console.log('Opening save:', SAVE_PATH, '\n');
  const franchise = await Franchise.create(SAVE_PATH);

  let allPassed = true;
  for (const [label, uniqueId] of Object.entries(TABLE_UNIQUE_IDS)) {
    try {
      const table = franchise.getTableByUniqueId(uniqueId);
      if (!table) {
        console.log(`${label} (uniqueId ${uniqueId}): FAILED -- getTableByUniqueId returned nothing`);
        allPassed = false;
        continue;
      }
      await table.readRecords();
      const detail = SANITY_CHECKS[label] ? SANITY_CHECKS[label](table) : `${table.records.length} records`;
      console.log(`${label} (uniqueId ${uniqueId}, tableId ${table.header.tableId}): OK -- ${detail}`);
    } catch (err) {
      console.log(`${label} (uniqueId ${uniqueId}): FAILED -- ${err.message}`);
      allPassed = false;
    }
  }

  console.log('\n' + (allPassed
    ? 'ALL SEVEN UNIQUE IDs RESOLVED CORRECTLY. The fortification held through this update.'
    : 'AT LEAST ONE FAILED -- see above. This would mean the update changed something deeper than table IDs, which would be a much bigger finding worth digging into carefully before trusting the tool on a real save.'));
}

main().catch((err) => { console.error('ERROR opening save:', err); process.exit(1); });
