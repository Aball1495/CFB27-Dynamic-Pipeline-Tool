/**
 * DIAGNOSTIC SCRIPT -- read-only, touches nothing. Dumps a specific
 * team's raw pipeline row content (InfluenceLevel, Pipeline,
 * InfluenceValue) directly from a save file, exactly as it's actually
 * stored -- no engine recompute, no assumptions, just what's really in
 * the file right now.
 *
 * Use this to check whether a tier-display bug in-game reflects what's
 * actually written (a real bug in the write path) or whether the file
 * is correct and something else is going on (rendering/cache issue).
 *
 * Usage: edit CONFIG below, then:
 *   node dump_team.cjs
 * Run from inside your pipeline-tool folder (needs node_modules).
 */

const { openSave, readTeamPipelineMapping, readPipelineRow } = require('./io/saveFile');

// ---- CONFIG -- edit these ----
const SAVE_PATH = 'C:\\Users\\Alex\\OneDrive - University of Pittsburgh\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-SDSTTest';
const TEAM_NAMES = ['Alabama', 'San Diego St.'];
// ------------------------------

async function main() {
  const franchise = await openSave(SAVE_PATH);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);

  for (const name of TEAM_NAMES) {
    const info = Object.values(teamsByIndex).find((t) => t.displayName === name);
    if (!info) {
      console.log(`\n${name}: not found in this save.`);
      continue;
    }

    console.log(`\n=== ${name} -- ${info.rows4306.length} real slots ===`);
    info.rows4306.forEach((row, i) => {
      const entry = readPipelineRow(pipelineInfluenceTable, row);
      if (!entry) {
        console.log(`  [slot ${i}, row ${row}]: NO RECORD FOUND`);
        return;
      }
      const [tier, region, value] = entry;
      console.log(`  [slot ${i}, row ${row}] ${region}: ${tier} (${value})`);
    });

    // Flag anything structurally odd -- duplicate region names, or a row
    // number reused across multiple slots for this same team (which
    // would explain multiple slots displaying identically in-game).
    const regionCounts = {};
    const rowCounts = {};
    info.rows4306.forEach((row) => { rowCounts[row] = (rowCounts[row] || 0) + 1; });
    info.rows4306.forEach((row) => {
      const entry = readPipelineRow(pipelineInfluenceTable, row);
      if (entry) regionCounts[entry[1]] = (regionCounts[entry[1]] || 0) + 1;
    });
    const dupeRegions = Object.entries(regionCounts).filter(([, n]) => n > 1);
    const dupeRows = Object.entries(rowCounts).filter(([, n]) => n > 1);
    if (dupeRegions.length) console.log(`  ANOMALY: duplicate region name(s) across slots: ${dupeRegions.map(([r, n]) => `${r} x${n}`).join(', ')}`);
    if (dupeRows.length) console.log(`  ANOMALY: same underlying row reused across multiple slots: ${dupeRows.map(([r, n]) => `row ${r} x${n}`).join(', ')}`);
    if (!dupeRegions.length && !dupeRows.length) console.log('  No duplicate regions or reused rows -- structurally clean.');

    // Tier distribution -- for a uniform-tier Academy Mode setup, this
    // should show ONE tier with a count matching the real slot count.
    // Any second tier appearing here is the raw file itself disagreeing
    // with "uniform," not just an in-game display quirk.
    const tierCounts = {};
    info.rows4306.forEach((row) => {
      const entry = readPipelineRow(pipelineInfluenceTable, row);
      if (entry) tierCounts[entry[0]] = (tierCounts[entry[0]] || 0) + 1;
    });
    console.log(`  Tier distribution in the RAW FILE: ${JSON.stringify(tierCounts)}`);
  }
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
