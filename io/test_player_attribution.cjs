#!/usr/bin/env node
/**
 * Directly tests the REAL, current readPlayers() from saveFile.js
 * against a live save -- mirrors test_coach_attribution.cjs, same idea:
 * exercise the actual function Pipeline calls at runtime, not a
 * reimplementation.
 *
 * IMPORTANT: place this file in the SAME FOLDER as the real saveFile.js
 * before running -- it requires it by relative path.
 *
 * Usage:
 *   node test_player_attribution.cjs "<save path>" "<team name 1>" ["<team name 2>" ...]
 *
 * Read-only. Never writes to the save file.
 */

'use strict';

async function main() {
  const [savePath, ...teamNames] = process.argv.slice(2);
  if (!savePath || teamNames.length === 0) {
    console.error('Usage: node test_player_attribution.cjs "<save path>" "<team name 1>" ["<team name 2>" ...]');
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

  const { openSave, readTeamPipelineMapping, readPlayers } = saveFileModule;
  if (!openSave || !readTeamPipelineMapping || !readPlayers) {
    console.error('saveFile.js did not export openSave/readTeamPipelineMapping/readPlayers -- check module.exports in that file.');
    process.exitCode = 1;
    return;
  }

  console.log(`Opening save (read-only) via the real openSave(): ${savePath}`);
  const franchise = await openSave(savePath);

  console.log('Calling the real readTeamPipelineMapping()...');
  const { teamsByIndex } = await readTeamPipelineMapping(franchise);

  console.log('Calling the real readPlayers()...\n');
  const playersByTeamIndex = await readPlayers(franchise);

  let totalAcrossAll = 0;
  for (const [, players] of Object.entries(playersByTeamIndex)) totalAcrossAll += players.length;
  console.log(`readPlayers() attributed ${totalAcrossAll} rated player(s) across ${Object.keys(playersByTeamIndex).length} team(s) total.\n`);

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
      const players = playersByTeamIndex[teamIndex] || [];

      console.log(`"${info.displayName}" (TeamIndex ${teamIndex}) -- ${players.length} player(s) resolved by the REAL readPlayers():`);
      // Small sample, not the whole roster -- just enough to eyeball
      // that pipeline/state/star data looks like real values, not
      // undefined/garbage.
      for (const p of players.slice(0, 5)) {
        console.log(`  pipeline=${p.pipeline || '(none)'}   state=${p.state || '(none)'}   star=${p.star || '(none)'}`);
      }
      if (players.length > 5) console.log(`  ...and ${players.length - 5} more`);
      console.log('');
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('ERROR:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
