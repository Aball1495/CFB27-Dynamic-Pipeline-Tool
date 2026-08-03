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
 * SchoolPipelineInfluenceList -> the list table -> that team's actual
 * pipeline rows in SchoolPipelineInfluence, using the field's built-in
 * .referenceData (confirmed reliable -- no manual bit-math needed for
 * this part).
 *
 * IMPORTANT: not every team has exactly 10 real pipeline slots. Confirmed
 * by auditing every team in a real save -- 17 teams have fewer (down to
 * just 1, for Sac State), 53 have more (11, or 12 for Arkansas State).
 * This reads however many each team actually has, rather than assuming
 * 10 for everyone.
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
 *     teamsByIndex: { [teamIndex]: { displayName, rows4306: [row numbers, one per real slot] } },
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

    // Not every team actually has 10 real pipeline slots -- confirmed by
    // auditing every team in a real save: 17 teams have fewer (as low as
    // 1, for Sac State), 53 have more (11 or even 12, for Arkansas
    // State). Real slots are always contiguous starting from index 0 in
    // every team checked, so stopping at the first non-real slot
    // correctly finds each team's true count rather than assuming 10.
    // The upper bound here is just a generous safety cap -- no real team
    // comes anywhere close to it.
    const rows4306 = [];
    // Confirmed structural ceiling is 42 slots per team (verified across
    // 5 different teams' records) -- 50 is a safe, generous bound that
    // won't truncate a team with more real slots than the old 30-cap
    // assumed. That old cap was chosen before this project ever
    // discovered teams could exceed 30 real pipelines, and directly
    // caused a confirmed real bug: any team with more than 30 real
    // slots (which academies now genuinely can, at up to 42) would have
    // its slots beyond 30 silently ignored on every future Apply --
    // never read, never recalculated, never touched, just permanently
    // frozen with stale data.
    for (let i = 0; i < 50; i++) {
      const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
      if (!field) break; // field itself doesn't exist -- structure ends here
      const ref = field.referenceData;
      if (!ref || ref.tableId !== pipelineTableId) break; // first empty slot -- this team's true count
      rows4306.push(ref.rowNumber);
    }

    teamsByIndex[teamRecord.TeamIndex] = {
      displayName: teamRecord.DisplayName,
      rows4306,
    };
  }

  return { teamsByIndex, pipelineInfluenceTable };
}

/**
 * Encodes a {tableId, rowNumber} reference as the raw 32-bit binary
 * string this schema's reference fields expect -- 15 bits for tableId,
 * 17 bits for rowNumber. Confirmed against a real save by decoding an
 * existing known-good reference and checking the bits matched exactly.
 */
function encodeReference(tableId, rowNumber) {
  const tableIdBits = tableId.toString(2).padStart(15, '0');
  const rowNumberBits = rowNumber.toString(2).padStart(17, '0');
  return tableIdBits + rowNumberBits;
}

// A reference field's value when it points at nothing -- confirmed
// against real save data. Writing this to a list slot's field is what
// "unlinks" that slot from a team, the necessary first step before that
// row can be handed to anyone else (see shrinkTeamPipelineSlots below).
const NULL_REFERENCE = encodeReference(0, 0);

/**
 * EXPERIMENTAL -- writes brand-new pipeline slot references for a team
 * that currently has fewer than `targetCount` real slots, "adopting"
 * currently-unreferenced rows from the shared SchoolPipelineInfluence
 * table (confirmed there are ~188 such orphaned rows in a real save,
 * none referenced by any team). This is a fundamentally different kind
 * of write than anything else in this file -- every other write updates
 * a VALUE on an already-existing link; this creates the link itself for
 * the first time.
 *
 * Confirmed working at the file-read/write level: written references
 * persist correctly on a completely fresh re-open, and this project's own
 * read code correctly recognizes the newly-added slots afterward.
 * NOT YET confirmed against actual in-game behavior -- the game might
 * have other bookkeeping tied to slot count that this doesn't know
 * about. Treat as experimental until verified in-game on a disposable
 * save copy.
 *
 * @param {Franchise} franchise - an already-open franchise (same one the
 *   caller is about to write other updates through)
 * @param {Object} teamsByIndex - from readTeamPipelineMapping, used to
 *   find every team's currently-referenced rows so we don't hand out a
 *   row that's secretly already in use by someone else
 * @param {Object} pipelineInfluenceTable - from readTeamPipelineMapping
 * @param {number} teamIndex - which team to expand
 * @param {number} targetCount - how many real slots this team should
 *   have after this call (does nothing if it already has this many or
 *   more)
 * @returns {number[]} this team's full rows4306 array after expansion
 *   (existing real rows plus any newly-linked ones)
 */
async function expandTeamPipelineSlots(franchise, teamsByIndex, pipelineInfluenceTable, teamIndex, targetCount) {
  const teamInfo = teamsByIndex[teamIndex];
  const currentRows = teamInfo.rows4306;
  const currentCount = currentRows.length;
  if (currentCount >= targetCount) return currentRows;

  const pipelineTableId = pipelineInfluenceTable.header.tableId;

  // Find every row already referenced by ANY team, so we only ever hand
  // out rows nobody else is using.
  const referencedRows = new Set();
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) referencedRows.add(row);
  }
  const orphanedRows = [];
  for (let i = 0; i < pipelineInfluenceTable.records.length; i++) {
    if (!referencedRows.has(i)) orphanedRows.push(i);
  }

  const numNeeded = targetCount - currentCount;
  if (orphanedRows.length < numNeeded) {
    throw new Error(`Not enough unused pipeline rows available to expand this team (need ${numNeeded}, found ${orphanedRows.length}).`);
  }
  const rowsToAdopt = orphanedRows.slice(0, numNeeded);

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const teamRecord = teamTable.records.find((r) => r.TeamIndex === Number(teamIndex));
  const listTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();
  const listRef = teamRecord.getFieldByKey('SchoolPipelineInfluenceList').referenceData;
  const listRecord = listTable.records[listRef.rowNumber];

  const newRows = [...currentRows];
  for (let i = 0; i < rowsToAdopt.length; i++) {
    const slotIndex = currentCount + i;
    const rowToAdopt = rowsToAdopt[i];
    const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${slotIndex}`);
    field.value = encodeReference(pipelineTableId, rowToAdopt);
    newRows.push(rowToAdopt);
  }

  return newRows;
}

/**
 * EXPERIMENTAL, NOT YET IN-GAME VERIFIED -- the counterpart to
 * expandTeamPipelineSlots. Shrinks a team's real slot count DOWN to
 * targetCount by unlinking the excess slots and returning those rows to
 * the shared orphan pool. This is the "10 is a ceiling" one-time
 * normalization from academy_mode_spec.md -- the mechanism that actually
 * supplies Academy Mode's expansion pool. Does nothing if the team
 * already has targetCount or fewer real slots.
 *
 * IMPORTANT -- this is genuinely new, higher-risk territory compared to
 * everything else in this file. Every other write here either updates a
 * value on an already-existing link (safe, extensively proven) or ADDS a
 * new link (expandTeamPipelineSlots -- proven at the file level and
 * spot-checked in-game). This is the first function that REMOVES a real
 * link a team already has. Confirmed correct at the file level (see
 * hardcap_test.cjs, which used this exact unlink pattern inline before it
 * was promoted here) -- NOT yet confirmed against actual in-game behavior.
 * Test on a disposable save copy before trusting this with a real dynasty.
 *
 * Only ever called for a ONE-TIME ceiling normalization (a team currently
 * above the target gets brought down to it, once). This is NOT the
 * mechanism for a team's own pipeline count naturally coming back lower
 * in some future season -- that's a different, engine-level concern (see
 * the "Engine implication" section of academy_mode_spec.md): a slot that
 * goes blank because its region's score dropped stays LINKED to that same
 * team, and must never be unlinked or handed to anyone else. This
 * function should only ever be invoked for a team whose CURRENT real
 * slot count exceeds the ceiling, never as a per-season "trim to fit"
 * step.
 *
 * @param {Franchise} franchise - an already-open franchise (same one the
 *   caller is about to write other updates through)
 * @param {Object} teamsByIndex - from readTeamPipelineMapping; MUTATED in
 *   place (teamsByIndex[teamIndex].rows4306 is updated to the shrunk
 *   list) so a caller looping over multiple teams in the same run
 *   correctly sees these freed rows as available for expansion, and
 *   never hands the same row to two different teams.
 * @param {Object} pipelineInfluenceTable - from readTeamPipelineMapping
 * @param {number} teamIndex - which team to shrink
 * @param {number} targetCount - how many real slots this team should
 *   have after this call (does nothing if it already has this many or
 *   fewer)
 * @returns {number[]} this team's remaining rows4306 after shrinking
 */
async function shrinkTeamPipelineSlots(franchise, teamsByIndex, pipelineInfluenceTable, teamIndex, targetCount) {
  const teamInfo = teamsByIndex[teamIndex];
  const currentRows = teamInfo.rows4306;
  const currentCount = currentRows.length;
  if (currentCount <= targetCount) return currentRows;

  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const teamRecord = teamTable.records.find((r) => r.TeamIndex === Number(teamIndex));
  const listTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
  await listTable.readRecords();
  const listRef = teamRecord.getFieldByKey('SchoolPipelineInfluenceList').referenceData;
  const listRecord = listTable.records[listRef.rowNumber];

  // Unlink every slot from targetCount onward, and reset the freed row's
  // tier/value so it doesn't carry stale data while it sits in the
  // orphan pool. Pipeline (region name) is deliberately left as-is,
  // matching the pattern already proven in hardcap_test.cjs -- an
  // Unrecognized/0 row is already treated as placeholder noise
  // everywhere this project reads pipeline rows, so the leftover region
  // string is harmless.
  for (let i = targetCount; i < currentCount; i++) {
    const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
    field.value = NULL_REFERENCE;

    const freedRow = currentRows[i];
    const record = pipelineInfluenceTable.records[freedRow];
    if (record) {
      record.InfluenceLevel = 'Unrecognized';
      record.InfluenceValue = 0;
    }
  }

  const newRows = currentRows.slice(0, targetCount);
  teamInfo.rows4306 = newRows; // keep in sync so a later team in this same loop can adopt these freed rows
  return newRows;
}

function resolveTable(franchise, tableId) {
  return franchise.tables.find((t) => t.header && t.header.tableId === tableId);
}

// Player.TeamIndex is NOT reliable as "who is currently on this team" --
// confirmed across multiple real test saves (a companion tool,
// Preseason Transfer Wave, hit the identical bug: a handful of real
// teams can carry TeamIndex=0 for their entire roster while a normal
// roster sits in their Roster array, and the human-controlled team
// specifically can accumulate stale phantom TeamIndex references).
// This resolves player->team membership from each team's real Roster
// reference array instead -- the same field the game itself renders
// rosters from. Players not found in any real team's Roster array are
// excluded entirely rather than guessed at via their own TeamIndex.
async function buildRosterTeamByPlayerIndex(franchise) {
  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const playerTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.player);
  await playerTable.readRecords();
  const playerTableId = playerTable.header.tableId;

  const map = new Map();
  for (const team of teamTable.records) {
    let name;
    try { name = team.DisplayName; } catch { continue; }
    if (!name) continue; // skip placeholder rows, same guard readTeamPipelineMapping uses
    if (!team.fields || !('Roster' in team.fields) || !team.fields.Roster.isReference) continue;
    const ref = team.fields.Roster.referenceData;
    const rosterTable = resolveTable(franchise, ref.tableId);
    if (!rosterTable) continue;
    if (!rosterTable.recordsRead) await rosterTable.readRecords();
    const rosterRecord = rosterTable.records[ref.rowNumber];
    if (!rosterRecord) continue;
    for (const slotName of Object.keys(rosterRecord.fields)) {
      const field = rosterRecord.fields[slotName];
      if (!field || !field.isReference) continue;
      const slotRef = field.referenceData;
      if (!slotRef || slotRef.tableId !== playerTableId) continue;
      const record = playerTable.records[slotRef.rowNumber];
      if (!record || record.isEmpty) continue;
      // Team.TeamIndex (the field), NOT team.index (row position) --
      // every other function in this file (readTeamPipelineMapping,
      // readCoaches, the integrity pass, capacity reclaim) keys teams by
      // the field, and on a real save the two can genuinely differ (a
      // team's own TeamIndex field and its row position aren't
      // guaranteed to match -- confirmed on a real save after
      // conference realignment). Keying by row position here instead
      // caused this player-team map to silently disagree with every
      // other part of this file about which numeric ID means which team.
      map.set(slotRef.rowNumber, team.TeamIndex);
    }
  }
  return map;
}

/** Player table -> { [teamIndex]: [{ pipeline, state, star }, ...] } */
async function readPlayers(franchise) {
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.player);
  await table.readRecords();
  const rosterTeamByPlayerIndex = await buildRosterTeamByPlayerIndex(franchise);
  const byTeam = {};
  for (const r of table.records) {
    const ti = rosterTeamByPlayerIndex.get(r.index);
    if (ti === undefined) continue; // not found in any real team's Roster array -- don't guess via TeamIndex
    if (!byTeam[ti]) byTeam[ti] = [];
    byTeam[ti].push({ pipeline: r.HomePipeline, state: r.PLYR_HOME_STATE, star: r.ProspectStarRating });
  }
  return byTeam;
}

/**
 * Coach.TeamIndex is NOT reliable -- confirmed on a real save: after a
 * human coach changed jobs, ALL THREE of that team's real staff
 * (HeadCoach, OffensiveCoordinator, DefensiveCoordinator) still carried
 * the OLD team's TeamIndex on their own Coach records, even though the
 * new team's own data correctly showed them as current staff. This
 * resolves staff the authoritative way instead: each Team record has its
 * own direct HeadCoach / OffensiveCoordinator / DefensiveCoordinator
 * reference field pointing straight into the Coach table (confirmed via
 * a real save's field list -- same pattern as Team.Roster for players,
 * just a single reference each instead of an array). Coach.TeamIndex is
 * never read here at all.
 *
 * Team table -> { [teamIndex]: { HeadCoach: {...}, OffensiveCoordinator: {...}, DefensiveCoordinator: {...} } }
 */
async function readCoaches(franchise) {
  const teamTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
  await teamTable.readRecords();
  const coachTable = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.coach);
  await coachTable.readRecords();
  const coachTableId = coachTable.header.tableId;

  const STAFF_FIELDS = ['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator'];

  const byTeam = {};
  for (const teamRecord of teamTable.records) {
    if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue; // skip placeholder rows, same guard readTeamPipelineMapping uses

    const staff = {};
    for (const posLabel of STAFF_FIELDS) {
      const field = teamRecord.getFieldByKey(posLabel);
      if (!field) continue;
      const ref = field.referenceData;
      if (!ref || ref.tableId !== coachTableId) continue;
      const coachRecord = coachTable.records[ref.rowNumber];
      if (!coachRecord) continue;
      staff[posLabel] = {
        pipeline: coachRecord.PrimaryPipeline,
        seasons: coachRecord.SeasonsWithTeam || 0,
        name: `${coachRecord.FirstName || ''} ${coachRecord.LastName || ''}`.trim(),
      };
    }
    if (Object.keys(staff).length > 0) byTeam[teamRecord.TeamIndex] = staff;
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
 * Writes recomputed values back. Backs up the original save first (to a
 * "Pipeline Backup" folder next to it, timestamped -- previous backups
 * are never overwritten), then works on a temp copy and only replaces
 * the real save once every step below has actually succeeded --
 * matches the same safe-write pattern Preseason Transfer Wave uses (see
 * that project's lib/redistribution.js), so a crash or interruption
 * mid-write can never corrupt the real save, even in a cloud-synced
 * folder like OneDrive.
 *
 * Takes per-team results directly (rather than a pre-flattened row map)
 * because expansion (writing brand-new pipeline slots for a team with
 * fewer than 10 real ones) and shrinking (unlinking excess slots for a
 * team with more than the target) both have to happen on this exact same
 * open copy -- expansion needs row numbers that don't exist until it
 * creates them, and shrinking needs teamsByIndex kept in sync so a later
 * team in the same call can see freed rows as available. A pre-built row
 * map from an earlier, separate read of the file can't reflect either.
 *
 * @param {string} savePath - the real save file. Backed up first, then
 *   overwritten in place once the write below succeeds.
 * @param {Object} teamUpdates - { [teamIndex]: { after: [[tier,region,value],...] } }
 *   `after.length` may be larger OR SMALLER than that team's current real
 *   slot count:
 *     - larger -> EXPANSION (expandTeamPipelineSlots) creates enough new
 *       slots to fit everything computed.
 *     - smaller -> SHRINKING (shrinkTeamPipelineSlots) unlinks the excess
 *       slots, returning those rows to the shared pool. This is the "10
 *       is a ceiling, not a floor" mechanism from academy_mode_spec.md --
 *       ONLY call this with a smaller after.length when the shrink is
 *       genuinely intended (e.g. a one-time ceiling normalization, or the
 *       engine legitimately finding fewer non-zero-scoring regions this
 *       season). Both directions are experimental -- expansion has been
 *       spot-checked in-game; shrinking has been in-game verified for the
 *       ceiling-normalization case (see shrink_test.cjs) but not yet
 *       exercised through this exact function end-to-end in a live Apply.
 * @param {string|null} backupDir - where to place the backup copy.
 *   Optional -- omit it (or pass null/undefined) to use the default
 *   "Pipeline Backup" folder next to savePath.
 * @returns {{ outputPath: string|null, backupPath: string, verified: boolean, verificationError: string|null }}
 */
/**
 * Builds a short, dash-free backup filename: the original save's name,
 * immediately followed by a 5-character month+day suffix (e.g.
 * "DYNASTY-FP" -> "DYNASTY-FPJUL23"). Same reasoning as before this
 * moved to backup+overwrite -- a full ISO-timestamp-with-dashes name was
 * reported to cause the game to hang on its load screen for some users
 * when a file named that way ever ended up somewhere the game could see
 * it. The real save's own filename never changes at all now (it's
 * overwritten in place, not renamed), so that risk no longer applies to
 * it directly -- kept here anyway for the backup copy, both to preserve
 * a working, already-proven naming scheme and because a backup folder
 * being simple and collision-free is still worth having on its own merits.
 *
 * Same-day re-Applies of the same base file (e.g. repeated testing) are
 * handled by appending a single extra letter (B, C, D...) rather than
 * reintroducing a long timestamp -- keeps collisions impossible while
 * staying just as short and dash-free for every case after the first.
 */
function buildShortBackupPath(backupDir, base, date) {
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const suffix = `${MONTHS[date.getMonth()]}${String(date.getDate()).padStart(2, '0')}`;

  let candidate = path.join(backupDir, `${base}${suffix}`);
  if (!fs.existsSync(candidate)) return candidate;

  for (let i = 1; i < 26; i++) {
    candidate = path.join(backupDir, `${base}${suffix}${String.fromCharCode(65 + i)}`); // B, C, D...
    if (!fs.existsSync(candidate)) return candidate;
  }
  // Extremely unlikely fallback -- more than 26 Applies of the exact
  // same base file on the exact same day.
  return path.join(backupDir, `${base}${suffix}Z${Date.now()}`);
}

async function writeUpdatedSave(savePath, teamUpdates, backupDir = null, capacityReclaim = null) {
  const saveDir = path.dirname(savePath);
  const base = path.basename(savePath);

  const resolvedBackupDir = backupDir || path.join(saveDir, 'Pipeline Backup');
  fs.mkdirSync(resolvedBackupDir, { recursive: true });
  const backupPath = buildShortBackupPath(resolvedBackupDir, base, new Date());
  fs.copyFileSync(savePath, backupPath);

  // Work on a temp copy next to the real save; only renamed into place
  // once every step below has actually succeeded.
  const tempPath = path.join(saveDir, `.${base}.tmp-${Date.now()}`);
  fs.copyFileSync(savePath, tempPath);

  const franchise = await Franchise.create(tempPath);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);
  const pipelineTableIdForIntegrityPass = pipelineInfluenceTable.header.tableId;

  // ---- Integrity pass: fix pre-existing row problems before anything else runs ----
  // Two confirmed real problems, found via extensive testing on real saves:
  //   1. CROSS-TEAM COLLISIONS -- the same row genuinely, structurally
  //      referenced by two different teams' real slots at once (or twice
  //      by the same team through two different slot fields). Left
  //      unfixed, this causes a "didn't match after writing" verification
  //      failure the moment Apply tries to write both teams' different
  //      content to the same physical row.
  //   2. WITHIN-TEAM HOLES -- a team's own slot list has an invalid
  //      (null, or pointing at the wrong table) slot with a REAL slot
  //      still sitting somewhere after it. readTeamPipelineMapping only
  //      ever sees the contiguous prefix up to the first invalid slot,
  //      so any real data past a hole is invisible to every other part
  //      of this tool -- and is exactly the shape of null-reference
  //      damage confirmed to have caused real, reproducible crashes.
  //
  // Both get fixed the same simple way: give the affected slot a genuine,
  // uniquely-owned orphan row instead of whatever invalid/duplicate thing
  // it currently points at. No shared placeholder row, no change to how
  // shrink or expand behave -- this only cleans up rows that were already
  // broken before this Apply ever started.
  //
  // Reported, not silent -- see integrityFixesApplied in this function's
  // return value.
  const integrityFixesApplied = [];
  {
    const teamTableForIntegrity = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
    await teamTableForIntegrity.readRecords();
    const listTableForIntegrity = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
    await listTableForIntegrity.readRecords();

    function isValidPipelineRef(ref) {
      return !!ref && ref.tableId === pipelineTableIdForIntegrityPass;
    }

    const claimedRows = new Set();
    for (const info of Object.values(teamsByIndex)) {
      for (const row of info.rows4306) claimedRows.add(row);
    }
    function takeFreshOrphanRow() {
      for (let i = 0; i < pipelineInfluenceTable.records.length; i++) {
        if (!claimedRows.has(i)) {
          claimedRows.add(i);
          return i;
        }
      }
      return null;
    }

    // Read every team's FULL slot pattern up front (not just the
    // contiguous prefix readTeamPipelineMapping already computed) --
    // needed to see holes and to detect which rows are shared by more
    // than one team.
    const fullSlotsByTeam = {};
    const rowOwnerCount = new Map();
    for (const teamRecord of teamTableForIntegrity.records) {
      if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue;
      const listRef = teamRecord.getFieldByKey('SchoolPipelineInfluenceList').referenceData;
      if (!listRef || listRef.tableId === 0) continue;
      const listRecord = listTableForIntegrity.records[listRef.rowNumber];
      if (!listRecord) continue;

      const slots = [];
      for (let i = 0; i < 50; i++) {
        const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
        if (!field) break;
        const ref = field.referenceData;
        const valid = isValidPipelineRef(ref);
        slots.push({ index: i, field, valid, row: valid ? ref.rowNumber : null });
        if (valid) rowOwnerCount.set(ref.rowNumber, (rowOwnerCount.get(ref.rowNumber) || 0) + 1);
      }
      fullSlotsByTeam[teamRecord.TeamIndex] = { teamName: teamRecord.DisplayName, slots };
    }

    for (const [teamIndex, { teamName, slots }] of Object.entries(fullSlotsByTeam)) {
      // Cross-team (or same-team-twice) collisions: any valid slot whose
      // row is claimed more than once total, across everyone.
      for (const slot of slots) {
        if (slot.valid && rowOwnerCount.get(slot.row) > 1) {
          const freshRow = takeFreshOrphanRow();
          if (freshRow === null) {
            console.error(`Integrity pass: no free row available to resolve a collision for ${teamName} slot ${slot.index} -- left as-is.`);
            continue;
          }
          const rec = pipelineInfluenceTable.records[freshRow];
          rec.InfluenceLevel = 'Unrecognized';
          rec.InfluenceValue = 0;
          slot.field.value = encodeReference(pipelineTableIdForIntegrityPass, freshRow);
          rowOwnerCount.set(slot.row, rowOwnerCount.get(slot.row) - 1);
          integrityFixesApplied.push({ kind: 'collision', teamName, slotIndex: slot.index, oldRow: slot.row, newRow: freshRow });

          // If this slot was one of the team's REAL, counted slots (not
          // sitting inside/past an existing hole), keep teamsByIndex in
          // sync -- every later pass (feasibility check, shrink, expand,
          // write) trusts rows4306 to reflect what's actually there now.
          const info = teamsByIndex[Number(teamIndex)];
          if (info && slot.index < info.rows4306.length && info.rows4306[slot.index] === slot.row) {
            info.rows4306[slot.index] = freshRow;
          }
        }
      }

      // Within-team holes: any invalid slot with a real slot after it.
      let sawRealAfter = false;
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i].valid) {
          sawRealAfter = true;
        } else if (sawRealAfter) {
          const freshRow = takeFreshOrphanRow();
          if (freshRow === null) {
            console.error(`Integrity pass: no free row available to resolve a hole for ${teamName} slot ${slots[i].index} -- left as-is.`);
            continue;
          }
          const rec = pipelineInfluenceTable.records[freshRow];
          rec.InfluenceLevel = 'Unrecognized';
          rec.InfluenceValue = 0;
          slots[i].field.value = encodeReference(pipelineTableIdForIntegrityPass, freshRow);
          integrityFixesApplied.push({ kind: 'hole', teamName, slotIndex: slots[i].index, newRow: freshRow });
        }
      }
    }
  }
  // ---- End integrity pass ----

  // ---- Upfront feasibility check ----
  // Compute total demand (every expansion's need) against total supply
  // (rows about to be freed by every shrink, plus rows already sitting
  // orphaned) BEFORE writing anything. Catches a genuinely-insufficient
  // combination cleanly, with a real message, instead of throwing
  // partway through a mixed write -- which previously could leave a
  // fully untouched file with no user-facing explanation (the exception
  // happened before franchise.save() was ever reached, and the promise
  // rejection wasn't being handled on the renderer side either).
  let totalDemand = 0;
  let totalFreedByShrinking = 0;
  for (const [teamIndexStr, update] of Object.entries(teamUpdates)) {
    const teamInfo = teamsByIndex[Number(teamIndexStr)];
    if (!teamInfo) continue;
    const diff = update.after.length - teamInfo.rows4306.length;
    if (diff > 0) totalDemand += diff;
    else if (diff < 0) totalFreedByShrinking += -diff;
  }
  const referencedRows = new Set();
  for (const info of Object.values(teamsByIndex)) {
    for (const row of info.rows4306) referencedRows.add(row);
  }
  let existingOrphans = 0;
  for (let i = 0; i < pipelineInfluenceTable.records.length; i++) {
    if (!referencedRows.has(i)) existingOrphans++;
  }
  const totalSupply = totalFreedByShrinking + existingOrphans;
  if (totalDemand > totalSupply) {
    // Persist any integrity fixes already made above, even though the
    // REQUESTED Apply can't proceed -- those fixes are independent,
    // legitimate cleanup and shouldn't be thrown away just because this
    // specific request doesn't fit.
    if (integrityFixesApplied.length > 0) {
      await franchise.save();
      fs.renameSync(tempPath, savePath);
    } else {
      fs.unlinkSync(tempPath); // nothing to keep -- don't leave a stray temp file behind
    }
    return {
      outputPath: integrityFixesApplied.length > 0 ? savePath : null,
      backupPath,
      verified: false,
      verificationError:
        `Not enough unused pipeline rows to make this Apply work: need ${totalDemand} new slots total, ` +
        `only ${totalSupply} would be available (${totalFreedByShrinking} freed by shrinking + ${existingOrphans} already unused). ` +
        `Nothing from this specific request was written` +
        (integrityFixesApplied.length > 0 ? `, but ${integrityFixesApplied.length} pre-existing integrity fix(es) were saved. ` : '. ') +
        `Try a smaller Academy Mode target count, or apply fewer teams at once.`,
      integrityFixesApplied,
      pipelineInitialInfluenceReset: [],
      capacityReclaimed: [],
    };
  }

  // Passes 1-3 and the save itself are wrapped together -- if ANYTHING
  // unexpected goes wrong here (a per-team structural cap the aggregate
  // feasibility check above doesn't account for, or anything else), this
  // returns a clean failure result instead of throwing uncaught. An
  // uncaught throw here previously propagated all the way to the
  // renderer as a rejected promise with no user-facing handling on
  // either end -- silently leaving whatever result panel was already on
  // screen, with no indication anything failed except the DevTools
  // console.
  let finalRowsByTeam;
  let pipelineInitialInfluenceReset = [];
  const capacityReclaimed = [];
  try {
    // ---- Pass 1: shrink everyone that needs it, FIRST ----
    // Frees rows back to the shared pool before anyone tries to draw from
    // it. Doing shrink and expand in one mixed pass previously relied on
    // Object.entries()'s iteration order for numeric-looking keys (always
    // ascending team-index order, regardless of insertion order) -- which
    // has nothing to do with which teams need to free rows vs. claim them,
    // so an expansion could fail even when total supply was fine, just
    // because it happened to be processed before enough shrinks had run.
    for (const [teamIndexStr, update] of Object.entries(teamUpdates)) {
      const teamIndex = Number(teamIndexStr);
      const teamInfo = teamsByIndex[teamIndex];
      if (!teamInfo) continue;
      if (update.after.length < teamInfo.rows4306.length) {
        const rows4306 = await shrinkTeamPipelineSlots(franchise, teamsByIndex, pipelineInfluenceTable, teamIndex, update.after.length);
        teamsByIndex[teamIndex].rows4306 = rows4306;
      }
    }

    // ---- Pass 2: now handle every expansion ----
    // Every shrink above has already run, so the shared pool reflects the
    // true, final supply before any expansion draws from it.
    for (const [teamIndexStr, update] of Object.entries(teamUpdates)) {
      const teamIndex = Number(teamIndexStr);
      const teamInfo = teamsByIndex[teamIndex];
      if (!teamInfo) continue;
      if (update.after.length > teamInfo.rows4306.length) {
        const rows4306 = await expandTeamPipelineSlots(franchise, teamsByIndex, pipelineInfluenceTable, teamIndex, update.after.length);
        teamsByIndex[teamIndex].rows4306 = rows4306;
      }
    }

    // ---- Pass 3: write actual content into every team's final row set ----
    // Tracks, per team, exactly which rows ended up holding this team's
    // data -- needed for verification below, since passes 1/2 can change
    // which rows a team owns.
    finalRowsByTeam = {};
    for (const [teamIndexStr, update] of Object.entries(teamUpdates)) {
      const teamIndex = Number(teamIndexStr);
      const teamInfo = teamsByIndex[teamIndex];
      if (!teamInfo) continue;

      const rows4306 = teamInfo.rows4306;
      finalRowsByTeam[teamIndex] = rows4306;

      rows4306.forEach((rowIndex, i) => {
        const [tier, pipeline, value] = update.after[i] || [];
        if (tier === undefined) return;
        const record = pipelineInfluenceTable.records[rowIndex];
        if (!record) return;
        record.InfluenceLevel = tier;
        record.Pipeline = pipeline;
        record.InfluenceValue = value;
      });
    }

    // ---- PipelineInitialInfluence reset ----
    // CONFIRMED via extensive multi-season testing: this field
    // occasionally drifts to a nonzero value through ordinary base-game
    // simulation -- not written by this tool, not by any other tool
    // this project tested against. A nonzero value here was confirmed
    // (across four checkpoints spanning a full season-transition cycle)
    // to be the actual load-bearing cause of a real, reproducible
    // crash. A save with genuinely null pipeline references AND a clean
    // (zeroed) PipelineInitialInfluence across every team survived
    // multiple full season transitions with no crash. Resetting this on
    // every Apply is cheap insurance against drift that happened during
    // ordinary play since the last Apply.
    //
    // Reported, not silent -- see pipelineInitialInfluenceReset in this
    // function's return value.
    {
      const teamTableForReset = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
      await teamTableForReset.readRecords();
      for (const record of teamTableForReset.records) {
        if (!record.DisplayName || record.TeamIndex === 255) continue;
        const field = record._fields.PipelineInitialInfluence;
        if (!field) continue;
        const currentValue = record.PipelineInitialInfluence;
        const isZero = typeof currentValue === 'string' && /^0+$/.test(currentValue);
        if (isZero) continue;

        pipelineInitialInfluenceReset.push({
          teamIndex: record.TeamIndex,
          teamName: record.DisplayName,
          previousValue: currentValue,
        });
        field.value = NULL_REFERENCE; // all-zero bit string, same width as this field
      }
    }

    // ---- Pass 5: reclaim capacity from any non-academy team over cap ----
    // CONFIRMED (2026-07-30): this table's 1500-row capacity can fill
    // completely within a single season under real play. Whatever the
    // ultimate cause (still under investigation -- possibly recurring
    // integrity-pass fixes each consuming a fresh, never-reused row,
    // possibly genuine engine-driven growth), running this every Apply
    // is a cheap, safe backstop: any non-academy team currently sitting
    // above the cap gets trimmed back down to it, keeping their
    // highest-value pipelines and freeing the rest back into the pool.
    // Academy teams are completely excluded via capacityReclaim's
    // academyTeamNames, driven by the real settings.academyTeams --
    // NOT hardcoded, so a custom academy list is respected correctly.
    //
    // Opt-in: only runs if the caller actually passes capacityReclaim
    // (see main.js's call site). Existing callers that don't pass it
    // are completely unaffected.
    //
    // Reported, not silent -- see capacityReclaimed in this function's
    // return value.
    if (capacityReclaim && capacityReclaim.maxPipelines) {
      const maxPipelines = capacityReclaim.maxPipelines;
      const academyTeamNames = new Set(capacityReclaim.academyTeamNames || []);

      const teamTableForReclaim = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.team);
      await teamTableForReclaim.readRecords();
      const listTableForReclaim = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluenceList);
      await listTableForReclaim.readRecords();
      const pipelineTableIdForReclaim = pipelineInfluenceTable.header.tableId;

      for (const teamRecord of teamTableForReclaim.records) {
        if (!teamRecord.DisplayName || teamRecord.TeamIndex === 255) continue;
        if (academyTeamNames.has(teamRecord.DisplayName)) continue;

        const info = teamsByIndex[teamRecord.TeamIndex];
        if (!info || info.rows4306.length <= maxPipelines) continue;

        const withValues = info.rows4306.map((row) => ({
          row,
          value: pipelineInfluenceTable.records[row] ? pipelineInfluenceTable.records[row].InfluenceValue : 0,
        }));
        withValues.sort((a, b) => b.value - a.value);
        const orderedKeep = withValues.slice(0, maxPipelines).map((w) => w.row);
        const drop = withValues.slice(maxPipelines);

        const listRef = teamRecord.getFieldByKey('SchoolPipelineInfluenceList').referenceData;
        const listRecord = listTableForReclaim.records[listRef.rowNumber];

        for (let i = 0; i < info.rows4306.length; i++) {
          const field = listRecord.getFieldByKey(`SchoolPipelineInfluence${i}`);
          if (!field) break;
          if (i < orderedKeep.length) {
            field.value = encodeReference(pipelineTableIdForReclaim, orderedKeep[i]);
          } else {
            field.value = NULL_REFERENCE;
          }
        }
        for (const d of drop) {
          const rec = pipelineInfluenceTable.records[d.row];
          if (rec) {
            rec.InfluenceLevel = 'Unrecognized';
            rec.InfluenceValue = 0;
          }
        }

        info.rows4306 = orderedKeep;
        capacityReclaimed.push({
          teamName: teamRecord.DisplayName,
          previousCount: withValues.length,
          newCount: maxPipelines,
          rowsFreed: drop.length,
          droppedValues: drop.map((d) => d.value),
        });
      }
    }

    await franchise.save();
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch {} // original savePath is untouched either way -- just don't leave debris
    return {
      outputPath: null,
      backupPath,
      verified: false,
      verificationError: `Apply failed before finishing: ${err.message}. Nothing was written to your real save -- a backup was still made beforehand, but the original is otherwise untouched.`,
      integrityFixesApplied,
      pipelineInitialInfluenceReset: [],
      capacityReclaimed,
    };
  }

  // Only now, after the temp copy was written successfully, replace the
  // real save with it.
  fs.renameSync(tempPath, savePath);

  // Post-write verification: re-open the REAL save now that the temp copy
  // has been renamed into place (a completely separate read from what
  // was just written, not trusting in-memory state) and confirm every
  // intended change actually landed. Cheap insurance for the one
  // operation in this whole app that actually modifies someone's save.
  let verified = true;
  let verificationError = null;
  try {
    const verifyFranchise = await Franchise.create(savePath);
    const verifyTable = verifyFranchise.getTableByUniqueId(TABLE_UNIQUE_IDS.schoolPipelineInfluence);
    await verifyTable.readRecords();

    outer:
    for (const [teamIndexStr, update] of Object.entries(teamUpdates)) {
      const teamIndex = Number(teamIndexStr);
      const rows4306 = finalRowsByTeam[teamIndex];
      if (!rows4306) continue;
      for (let i = 0; i < rows4306.length; i++) {
        const [tier, pipeline, value] = update.after[i] || [];
        if (tier === undefined) continue;
        const record = verifyTable.records[rows4306[i]];
        const matches = record
          && record.InfluenceLevel === tier
          && record.Pipeline === pipeline
          && record.InfluenceValue === value;
        if (!matches) {
          verified = false;
          verificationError = `Row ${rows4306[i]} (team index ${teamIndex}) didn't match after writing (expected [${tier}, ${pipeline}, ${value}], found ${record ? JSON.stringify({ InfluenceLevel: record.InfluenceLevel, Pipeline: record.Pipeline, InfluenceValue: record.InfluenceValue }) : 'no record at all'}).`;
          break outer;
        }
      }
    }
  } catch (err) {
    verified = false;
    verificationError = `Could not verify the write: ${err.message}`;
  }

  return { outputPath: savePath, backupPath, verified, verificationError, integrityFixesApplied, pipelineInitialInfluenceReset, capacityReclaimed };
}

/**
 * Reads REAL, exact conference membership directly from the save file --
 * no statistical inference needed. Ported from a sibling tool (the CFB27
 * Bracket Tool's conferenceMemberships.mjs), which itself borrowed this
 * from another sibling tool (the CFB27 Schedule Generator) -- confirmed
 * working there against a real save with a heavily scrambled custom
 * realignment, every team landing in the right conference against real
 * in-game standings screenshots. The decode logic below is left exactly
 * as validated there; only the final return shape changed.
 *
 * The "Conference" table has "Name" and "TeamSlots" fields, and
 * TeamSlots is a reference into a separate slot-array record -- same
 * shape as Team.Roster, just decoded through the manual 32-bit reference
 * string instead of the schema's .isReference/.referenceData API (which
 * doesn't expose this particular field the normal way -- not a stylistic
 * choice, this was the part that actually took real work to figure out
 * in the sibling tool, so it's kept as-is rather than "improved" blind).
 *
 * IMPORTANT: resolveSlotArray below returns Team table ROW POSITIONS, not
 * Team.TeamIndex. Every other function in this file keys teams by
 * Team.TeamIndex (the field) -- confirmed on a real save that these two
 * numbers can genuinely differ for the same team. getConferenceMembers()
 * converts row -> Team.TeamIndex right before returning, specifically so
 * nothing downstream of this function ever has to think about row
 * position at all -- the exact class of bug that caused a real,
 * confirmed cross-keying issue in readPlayers() earlier this project.
 *
 * @returns {Array<{ name: string, memberTeamIndexes: number[] }>}
 */
function decodeRef32(binaryStr) {
  if (!binaryStr || typeof binaryStr !== 'string' || binaryStr.length !== 32) return null;
  const tableId = parseInt(binaryStr.slice(0, 15), 2);
  const row = parseInt(binaryStr.slice(15), 2);
  if (!tableId && !row) return null;
  return { t: tableId, r: row };
}

function getTableIdByName(franchise, name) {
  const matches = franchise.tables.filter((t) => t.name === name);
  if (!matches.length) throw new Error(`Table not found by name: ${name}`);
  return matches.reduce((a, r) => (r.header.recordCapacity > a.header.recordCapacity ? r : a)).header.tableId;
}

async function resolveSlotArray(franchise, refString, teamTableId) {
  const ref = decodeRef32(refString);
  if (!ref) return [];
  const table = franchise.getTableById(ref.t);
  await table.readRecords();
  const record = table.records[ref.r];
  if (!record) return [];
  const rows = [];
  for (const field of table.offsetTable) {
    try {
      const decoded = decodeRef32(record[field.name]);
      if (decoded && decoded.t === teamTableId) rows.push(decoded.r);
    } catch {
      // Not every field decodes as a reference -- expected, skip it.
    }
  }
  return rows;
}

async function getConferenceMembers(franchise) {
  const teamTableId = getTableIdByName(franchise, 'Team');
  const teamTable = franchise.getTableById(teamTableId);
  if (!teamTable.recordsRead) await teamTable.readRecords();

  const conferenceTableId = getTableIdByName(franchise, 'Conference');
  const confTable = franchise.getTableById(conferenceTableId);
  await confTable.readRecords();

  const conferences = [];
  for (const record of confTable.records) {
    let name;
    try { name = String(record.Name || '').trim(); } catch { continue; }
    if (!name) continue;

    const rows = await resolveSlotArray(franchise, record.TeamSlots, teamTableId);
    if (!rows.length && name !== 'Independent') continue;

    // Row -> Team.TeamIndex conversion happens here, once, so every
    // caller downstream only ever sees Team.TeamIndex values.
    const memberTeamIndexes = rows
      .map((row) => {
        const teamRecord = teamTable.records[row];
        if (!teamRecord) return null;
        try { return teamRecord.TeamIndex; } catch { return null; }
      })
      .filter((ti) => ti !== null);

    conferences.push({ name, memberTeamIndexes });
  }
  return conferences;
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
  expandTeamPipelineSlots,
  shrinkTeamPipelineSlots,
  getConferenceMembers,
};
