#!/usr/bin/env node
/**
 * Directly tests the REAL, current readCoaches() and
 * readTeamPipelineMapping() from saveFile.js against a live save -- not
 * a reimplementation, the actual functions Pipeline itself calls at
 * runtime. Confirms whether the readCoaches() fix is actually resolving
 * staff correctly, rather than checking a raw field that neither version
 * ever writes to.
 *
 * IMPORTANT: place this file in the SAME FOLDER as the real saveFile.js
 * before running -- it requires it by relative path.
 *
 * Usage:
 *   node test_coach_attribution.cjs "<save path>" "<team name 1>" ["<team name 2>" ...]
 *
 * Example:
 *   node test_coach_attribution.cjs "<save>" "North Carolina" "Louisville"
 *
 * Read-only. Never writes to the save file.
 */

'use strict';

async function main() {
  const [savePath, ...teamNames] = process.argv.slice(2);
  if (!savePath || teamNames.length === 0) {
    console.error('Usage: node test_coach_attribution.cjs "<save path>" "<team name 1>" ["<team name 2>" ...]');
    process.exitCode = 1;
    return;
  }

  let saveFileModule;
  try {
    saveFileModule = require('./saveFile.js');
  } catch (err) {
    console.error('Could not require ./saveFile.js -- this script needs to sit in the SAME FOLDER as the real saveFile.js.');
    console.error(err.message);
    process.exitCode = 1;
    return;
  }

  const { openSave, readTeamPipelineMapping, readCoaches } = saveFileModule;
  if (!openSave || !readTeamPipelineMapping || !readCoaches) {
    console.error('saveFile.js did not export openSave/readTeamPipelineMapping/readCoaches -- check module.exports in that file.');
    process.exitCode = 1;
    return;
  }

  console.log(`Opening save (read-only) via the real openSave(): ${savePath}`);
  const franchise = await openSave(savePath);

  console.log('Calling the real readTeamPipelineMapping()...');
  const { teamsByIndex } = await readTeamPipelineMapping(franchise);

  console.log('Calling the real readCoaches()...\n');
  const coachesByTeamIndex = await readCoaches(franchise);

  const positions = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'];

  for (const nameQuery of teamNames) {
    const matches = Object.entries(teamsByIndex).filter(
      ([, info]) => info.displayName && info.displayName.toLowerCase().includes(nameQuery.toLowerCase())
    );
    if (matches.length === 0) {
      console.log(`"${nameQuery}": no team matched in teamsByIndex.\n`);
      continue;
    }
    if (matches.length > 1) {
      console.log(`"${nameQuery}" matched ${matches.length} teams -- showing all of them so nothing gets silently picked:`);
    }
    for (const [teamIndexStr, info] of matches) {
      const teamIndex = Number(teamIndexStr);
      const staff = coachesByTeamIndex[teamIndex] || {};

      console.log(`"${info.displayName}" (TeamIndex ${teamIndex}) -- resolved by the REAL readCoaches():`);
      for (const pos of positions) {
        const entry = staff[pos];
        if (!entry) {
          console.log(`  ${pos}: (none resolved for this team)`);
        } else {
          console.log(`  ${pos}: ${entry.name || '(no name)'}   pipeline=${entry.pipeline || '(none)'}   seasons=${entry.seasons}`);
        }
      }
      console.log('');
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('ERROR:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
