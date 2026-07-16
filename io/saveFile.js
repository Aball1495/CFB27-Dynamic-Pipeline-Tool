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

/** Player table -> { [teamIndex]: [{ pipeline, state, star }, ...] } */
async function readPlayers(franchise) {
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.player);
  await table.readRecords();
  const byTeam = {};
  for (const r of table.records) {
    const ti = r.TeamIndex;
    if (!byTeam[ti]) byTeam[ti] = [];
    byTeam[ti].push({ pipeline: r.HomePipeline, state: r.PLYR_HOME_STATE, star: r.ProspectStarRating });
  }
  return byTeam;
}

/** Coach table -> { [teamIndex]: { HeadCoach: {...}, OffensiveCoordinator: {...}, DefensiveCoordinator: {...} } } */
async function readCoaches(franchise) {
  const table = franchise.getTableByUniqueId(TABLE_UNIQUE_IDS.coach);
  await table.readRecords();
  const byTeam = {};
  const relevant = new Set(['HeadCoach', 'OffensiveCoordinator', 'DefensiveCoordinator']);
  for (const r of table.records) {
    if (!relevant.has(r.Position)) continue;
    const ti = r.TeamIndex;
    if (!byTeam[ti]) byTeam[ti] = {};
    byTeam[ti][r.Position] = {
      pipeline: r.PrimaryPipeline,
      seasons: r.SeasonsWithTeam || 0,
      name: `${r.FirstName || ''} ${r.LastName || ''}`.trim(),
    };
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
 * Writes recomputed values back. ALWAYS works on a copy -- the original
 * save at savePath is opened read-only in spirit; we never call .save() on
 * a franchise instance tied to the original path. A fresh copy is made
 * first, a fresh Franchise instance opens that copy, the edits happen
 * there, and that copy is what gets saved.
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
 * @param {string} savePath - original save file (never modified)
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
 * @param {string} outputDir - where to place the new save copy
 * @returns {{ outputPath: string, verified: boolean, verificationError: string|null }}
 */
async function writeUpdatedSave(savePath, teamUpdates, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(savePath);
  const outputPath = path.join(outputDir, `${base}-PIPELINES-${timestamp}`);

  fs.copyFileSync(savePath, outputPath);

  const franchise = await Franchise.create(outputPath);
  const { teamsByIndex, pipelineInfluenceTable } = await readTeamPipelineMapping(franchise);

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
    return {
      outputPath: null,
      verified: false,
      verificationError:
        `Not enough unused pipeline rows to make this Apply work: need ${totalDemand} new slots total, ` +
        `only ${totalSupply} would be available (${totalFreedByShrinking} freed by shrinking + ${existingOrphans} already unused). ` +
        `Nothing was written -- try a smaller Academy Mode target count, or apply fewer teams at once.`,
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

    await franchise.save();
  } catch (err) {
    return {
      outputPath: null,
      verified: false,
      verificationError: `Apply failed before finishing: ${err.message}. Nothing in this output file should be trusted -- please report this.`,
    };
  }

  // Post-write verification: re-open the fresh copy (a completely separate
  // read from what was just written, not trusting in-memory state) and
  // confirm every intended change actually landed. Cheap insurance for the
  // one operation in this whole app that touches a copy of someone's save.
  let verified = true;
  let verificationError = null;
  try {
    const verifyFranchise = await Franchise.create(outputPath);
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

  return { outputPath, verified, verificationError };
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
};
