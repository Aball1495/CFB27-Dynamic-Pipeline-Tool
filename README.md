# Dynamic Recruiting Pipeline Tool

Recomputes each school's active recruiting pipeline regions/tiers each
preseason, based on roster composition, star-weighted quality, coach
influence, and geography, blended against last season's persistent score.
How many pipelines each team gets is configurable (up to 10 for regular
teams; Army/Navy/Air Force can optionally get a much larger, more
realistic footprint under Academy Mode -- see below).

**Reads and writes your dynasty save file directly.** No exports from the
Franchise Editor needed at all -- point this at your save, run it, get a
new save copy with recomputed pipelines.

Every mechanic here has been validated end-to-end against a real dynasty:
the write persists correctly, survives a full season of real gameplay and
a preseason transition, and produces a measurable, realistic competitive
effect on recruiting (confirmed head-to-head against real opponents in a
real save).

## Setup

**Easiest option (recommended):** download the latest `.zip` from
[Releases], extract it, and double-click `Dynamic Recruiting Pipeline
Tool.exe` inside the extracted folder. **No Node.js or any other install
needed** -- everything the app needs (including its own Node.js runtime)
is bundled inside the exe already. Keep the exe inside its extracted
folder; it depends on the other files sitting next to it.

> **Windows may show a "Windows protected your PC" warning** the first
> time you run this -- that's normal for any small unsigned app like this
> one, not a sign of an actual problem. Click **More info** -> **Run
> anyway** to continue.

**Building/running from source instead:** this path *does* require
Node.js installed on your machine (only the packaged exe above is
self-contained).
```
npm install
npm start
```
Or on Windows, double-click `start.bat`, which runs `npm install`
automatically on first launch.

## Workflow

1. **Open your save** -- select your dynasty save file directly. That's it,
   no exports.
2. **Settings** -- pick a preset (Roster-driven / Blue-chip focused /
   Coach-legacy / Grounded) or adjust individual sliders. Dragging any
   slider away from a preset's values automatically switches the label to
   "Custom." Click a slider then use your keyboard's **arrow keys** for
   small, precise adjustments -- easier than dragging with a mouse when
   you're trying to land on an exact value.
3. **Run engine** -- reads every team's roster, coaching staff, and current
   pipeline data straight from the save, and computes new pipelines for
   each (up to your configured max, or Academy Mode's target for any
   teams covered by it).
4. **Preview** -- review before/after for every team side by side before
   anything is written. Search/filter and select which teams to actually
   apply. A **filled dot (●)** next to a team's name means at least one
   region entered or dropped out of that team's top 10 entirely -- not
   just a score shifting, but the actual lineup of regions changing. No
   dot means the same regions stuck around, just with different scores.
5. **Apply** -- backs up your original save first (to a `Pipeline Backup`
   folder next to it), then overwrites the save itself with the recomputed
   values. Nothing is written to your real save until the backup exists and
   the new content has been written and verified on a separate working
   copy first -- see [How the save-file access works](#how-the-save-file-access-works)
   for the full commit order.

## History

Every time you Apply, that season's results get saved locally (keyed to
your dynasty, not tied to any one save file's location). The **History**
button lets you pick any team and scrub through every season you've
applied so far on the same map view, seeing exactly how its pipeline
footprint shifted year to year. Regions that climbed a tier show a green
up arrow, regions that dropped show a red down arrow, and a separate box
calls out any region that entered or fell out of the top 10 entirely.

**Seasons applied before this version of the tool show tier only, with no
score in the map legend.** Score tracking in History was added back after
initially being left out, so any season you'd already applied before that
point simply doesn't have a number to show -- there's no way to
retroactively recover it, since it was never recorded. Every season you
apply going forward has the real score, right alongside the tier, exactly
like the regular map view already shows. You'll see both styles side by
side in the same team's history for a while, which is expected -- older
seasons look a little plainer, newer ones show the number too.

History only starts accumulating from whenever you begin using the tool
-- there's no way to retroactively reconstruct seasons from before you
started applying changes.

## Presets, weights, and what each one means

The 4 sliders (Roster composition / Star-weighted quality / Coach
pipeline / Geography) control how much each factor counts toward a
school's new pipeline scores.

**The 4 presets, and their exact weights:**

| Preset | Roster | Star | Coach | Geo | Best for... |
|---|---|---|---|---|---|
| **Roster-driven** | 0.35 | 0.35 | 0.20 | 0.10 | A balanced, "what does the roster actually look like" view -- current roster makeup and recruit quality matter about equally, coaching has a modest say, geography barely nudges things. Good default if you're not sure which to pick. |
| **Blue-chip focused** | 0.20 | 0.55 | 0.15 | 0.10 | Star power dominates. A school that's landed a handful of 4-5 star recruits will see its pipeline jump fast, even if the rest of the roster is thin. Good for highlighting programs on a hot recruiting streak. |
| **Coach-legacy** | 0.20 | 0.25 | 0.45 | 0.10 | Coaching staff's own recruiting ties matter most. A new hire with a strong home-region pipeline can reshape a school's map even before the roster catches up (subject to the ramp-up setting below). |
| **Grounded** | 0.30 | 0.25 | 0.10 | 0.35 | Geography matters most here -- schools pull harder from nearby regions and coaching/star factors count for less. Produces a more "realistic recruiting footprint" feel, closer to real-world regional recruiting. |

**Going custom:** drag any slider away from a preset's exact values and
the label switches to "Custom" automatically. Arrow keys (after clicking
a slider) move it in small steps -- handy for nudging values to land
exactly on 1.0 instead of eyeballing it with the mouse. **The 4 weights
should always sum to 1.0** -- the app shows a warning banner if your custom
sliders add up to anything else, so one factor doesn't silently end up
over- or under-weighted relative to what the numbers suggest. That said,
the warning is advisory, not a hard block -- the engine will still run if
your sliders don't sum to 1.0, so keep an eye on that banner if you're
customizing.

## Advanced: coach & geography detail

Tucked under the "Advanced" disclosure in Settings:

- **Include Head Coach / Offensive Coordinator / Defensive Coordinator**
  -- checkboxes controlling which staff members' `PrimaryPipeline`
  contributes to the Coach pipeline factor. Unchecking one removes their
  influence entirely rather than just reducing it.
- **Ramp-up mode** -- `Ramp up over seasons` (default) means a newly
  hired coach's pipeline influence phases in gradually rather than
  applying at full strength on day one; `Full weight immediately` skips
  that phase-in and treats every coach's influence as fully active from
  the moment they're hired.
- **Ramp-up seasons** (default 3) -- only matters in ramp mode. How many
  seasons it takes a new coach's influence to reach full weight. A coach
  in their first season under a 3-season ramp contributes roughly 1/3
  weight, season two roughly 2/3, full weight by season three onward.
- **Decay** (default 0.75) -- how much of last season's pipeline score
  carries forward into the new calculation, versus how much comes from
  this season's fresh numbers. At 0.75, a school's new score is 75% prior
  score + 25% freshly computed -- pipelines shift gradually rather than
  swinging wildly preseason to preseason. Lower this if you want pipelines
  to react faster to roster/coaching changes; raise it for more stability
  season to season.
- **Recruiting radius** (default 300 miles) -- the distance at which the
  Geography factor's bonus has decayed to about a third of its
  close-range value. Schools pull geography credit hardest from nearby
  regions, tapering off smoothly with distance rather than cutting off
  sharply at the radius line. Smaller radius = more hyper-local recruiting
  footprints; larger radius = geography credit extends further from
  campus.

## How the save-file access works

Every core table is accessed by its **numeric unique ID**, not by name --
this was a real, hard-won discovery. Name-based lookup
(`getTableByName('Team')`) only found a handful of team records due to how
this file format lazily registers tables; ID-based lookup finds all of
them correctly. The actual IDs in current use live in `TABLE_UNIQUE_IDS`
at the top of `io/saveFile.js` -- not duplicated here on purpose, since
those values are tied to this specific game patch and would go stale in
this doc the moment they ever change; the code itself is the source of
truth.

Reference-type fields (like `Team.SchoolPipelineInfluenceList`, pointing
into the list table) are resolved via the field's built-in
`.referenceData` property (`{ tableId, rowNumber }`) -- no manual bit
manipulation needed, despite how this project started out doing exactly
that by hand before this was discovered.

The Team table also contains 5 non-real placeholder rows (blank
`DisplayName`, `TeamIndex === 255`) alongside the 138 real FBS teams --
`readTeamPipelineMapping()` filters these out automatically.

## Where you'll actually see the changes in-game

The recomputed pipeline values only show up in the **recruiting tabs** (team
recruiting board, recruit's school interest/pipeline breakdown, etc.) --
they do **not** change anything on the team-select screen or other UI when
you pick a team in the game. That screen shows separate, unrelated team
data. If you're checking whether the tool worked, look at a recruit's
pipeline/interest breakdown for the school you changed, not the team
picker.

## Known limitations / next steps

- **The base game appears to run its own preseason pipeline logic,
  independent of anything this tool writes** -- confirmed across multiple
  real season advances on a real save. Teams below some internal baseline
  count (looks like 10) can gain brand-new pipelines the game generates
  itself, not a restoration of whatever was removed. Even teams already
  well above that baseline (Academy Mode's 42) aren't fully immune --
  occasionally a single slot's tier/value gets silently overwritten by
  the game, though this didn't compound uncontrollably every season in
  testing (several academy teams went a full season completely
  untouched). **Recommended usage: re-run this tool every preseason**,
  the same way you'd already do for roster or coaching changes, rather
  than treating a single Apply as permanent.
- Geography uses real haversine distance from empirically-derived region
  centroids (`data/regionCentroids.json`), built from real player hometown
  data gathered earlier in this project.
- Per-team map view is wired in (click "View map" in the preview list) --
  shows real state/county boundaries colored by pipeline tier, with
  sub-state splits for TX/FL/GA/CA. Runs fully offline: the map libraries
  (`renderer/vendor/`) and county boundary data (`renderer/data/`) are
  vendored directly in this repo, no internet needed after cloning.
- `engine/pipelineEngine.js` is a direct, verified port of the originally
  validated Python prototype -- same formula, same rounding, tested
  byte-for-byte identical output on real save data before this rewrite.
- Team logos are included out of the box in the downloaded release --
  they show up next to team names in the map view. Running from source
  instead, you'll need to add your own logo images to a `logos/` folder
  (see `logos/README.md` for the naming convention).

## Credits

The "Game style" map color option (an alternative to the default
team-colored map) is inspired by
[CollegeFootball.gg's pipeline tool](https://collegefootball.gg/pipelines/) --
a great unofficial resource if you want to look up any team's or region's
pipelines outside of this tool.

## Changelog

**v1.0.0**

- **Fixed a real crash on Apply** (`TypeError: The "path" argument must be
  of type string... Received undefined`) -- caused by a naming mismatch
  between `preload.js` (still sending the old `outputDir` key) and
  `main.js`'s handler (already expecting `backupDir`, from an earlier,
  never-finished migration). The renderer and confirmation dialog had
  already been updated to describe backup-then-overwrite behavior, but
  `writeUpdatedSave()` itself had never actually been changed to do it --
  it silently still wrote a brand-new file every time. Both are now fixed:
  the naming is consistent end to end, and `writeUpdatedSave()` genuinely
  backs up the original (to `Pipeline Backup`, timestamped, previous
  backups never overwritten) and then overwrites it in place via the same
  safe temp-file-then-rename pattern used elsewhere in this tool.
- **`readCoaches()` no longer trusts `Coach.TeamIndex` at all.** Confirmed
  on a real save: after a human coach changed jobs, all three of that
  team's real staff (HeadCoach, OffensiveCoordinator, DefensiveCoordinator)
  still carried the *old* team's `TeamIndex` on their own Coach records,
  even though the new team's own data correctly showed them as current
  staff. Staff is now resolved the authoritative way instead -- each Team
  record has its own direct `HeadCoach` / `OffensiveCoordinator` /
  `DefensiveCoordinator` reference field pointing straight into the Coach
  table (same pattern as `Team.Roster` for players), and that's what gets
  read now.
- **`readPlayers()` now resolves team membership via each team's real
  `Roster` array**, not `Player.TeamIndex` -- the same class of staleness
  bug as the coach one, confirmed on a real save (a handful of teams can
  carry `TeamIndex` pointing at rosters that read as nearly empty while a
  normal roster sits in their `Roster` array). Players not found in any
  real team's `Roster` array are excluded entirely rather than guessed at.
- **Fixed a real keying bug this same fix introduced and then caught**:
  the first version of the `readPlayers()` fix keyed its results by a
  team's row position, while every other function in this file (including
  the new `readCoaches()`) has always keyed by `Team.TeamIndex` (the
  field). Confirmed on a real save that these two numbers can genuinely
  differ for the same team -- row position and the team's own `TeamIndex`
  field aren't guaranteed to match. `readPlayers()` now keys the same way
  as everything else, so players and coaches always agree on which number
  means which team.
- **Stress-tested against mid-dynasty conference realignment and two
  separate coaching changes** on a real save. Team identity (row position,
  each team's own `TeamIndex` field) held up cleanly through all of it;
  coach/player attribution stayed correct even while `Coach.TeamIndex`
  itself continued going stale after each coaching change, exactly as
  expected -- confirming the fix resolves around that staleness rather
  than depending on it not happening.

**v0.9.0**

- Added a **startup integrity pass**, run automatically at the start of
  every Apply -- fixes cross-team row collisions and within-team slot
  "holes" (an invalid slot with real data sitting after it). Each fix uses
  a genuinely unique, fresh orphan row -- no shared placeholder row, no
  changes to the underlying shrink/expand logic.
- Added a **PipelineInitialInfluence reset**, run automatically at the end
  of every Apply -- zeroes any team's drifted `Team.PipelineInitialInfluence`
  value. Confirmed via multi-season testing that this prevents the crash
  that originally prompted the v0.8.0 investigation.
- Added **automatic capacity reclamation**, run at the end of every Apply --
  any non-Academy team currently over the configured pipeline cap is
  trimmed back down to it, keeping its highest-value pipelines and freeing
  the rest. Uses your actual `maxPipelines` / `academyTeams` settings, not
  hardcoded team names.
- Removed the investigation-era `PLACEHOLDER_ROW` concept entirely --
  shrink/expand now write plain null references exactly as the original
  tool always did.
- Repo cleanup: removed dozens of one-off investigation scripts used to
  diagnose the v0.8.0 crash; the ones with lasting troubleshooting value
  moved into a `diagnostics/` folder.

**v0.8.0**

- Investigated a reported save crash at the offseason after season 2, on
  a save also touched by a separate community recruiting tool. Built a
  new read-only save-integrity diagnostic and confirmed this tool's own
  pipeline data was structurally clean -- no cross-team row collisions,
  no out-of-bounds references, no malformed content. Also ruled out one
  candidate third-party tool entirely by inspecting its own code: it
  never touches pipeline data in any way. The actual root cause turned
  out to be an order-of-operations issue with a different tool, Fang's
  Recruiting Mod/Tool -- it has to run BEFORE this tool, every time, on
  every save; running them in the wrong order caused the corruption.
- Added a reminder prompt when selecting a save file, asking whether
  Fang's Tool has already been run on it (or isn't being used at all).
  Answering "no" stops the save from loading here and reminds you to run
  Fang's Tool first; "yes" or "n/a" both proceed normally.
- Changed the output filename format from a long, dash-heavy full
  timestamp (e.g. `DYNASTY-FP-PIPELINES-2026-07-23T14-35-10-123Z`) to a
  short month+day suffix (e.g. `DYNASTY-FPJUL23`) -- the long format was
  reported to make the game hang on its load screen for some users.
  Re-Applying the same save more than once on the same day gets a single
  extra letter appended (`B`, `C`, `D`...) instead of reintroducing a
  long timestamp, so collisions stay impossible without giving up the
  short, clean naming.

**v0.7.0**

- Investigated a community report that removed/shrunk pipelines can
  reappear (or have their tier/value silently overwritten) after an
  in-game season advance, independent of anything this tool writes.
  Confirmed across multiple real season advances on a real save -- see
  the new note under **Known limitations** above, along with the
  recommended workaround (re-run this tool every preseason).
- Fixed a real bug where Apply could silently fail to write anything at
  all for a large combined run (e.g. Academy Mode plus a big
  regular-team shrink across many teams). The write step processed
  shrinking and expanding in a single mixed pass, in an order based
  purely on internal team-index numbers rather than which teams actually
  needed to free rows first -- a team needing to expand could get
  processed before enough other teams had freed up rows for it, even
  when there was plenty of supply in total once everyone was done,
  causing the whole Apply to fail partway through before anything was
  actually saved.
- Added an upfront capacity check before any writing starts: totals up
  exactly how many new pipeline slots a run needs versus how many will
  actually be available (existing unused rows, plus everything about to
  be freed by shrinking), and fails cleanly with a clear explanation if
  it's genuinely not enough, instead of a confusing mid-write crash.
- Fixed the confusing case where a failed Apply could still show
  "✓ Write verified" -- that check only ever verified the teams it
  actually got to process, so if the write failed before really doing
  anything, there was nothing to find wrong with, and it defaulted to
  looking fine. It now correctly reflects an actual failure.
- Fixed a related bug in History tracking: a failed Apply could still
  get recorded into History as if it had succeeded, due to a leftover
  check for a field that was never actually being set.
- Apply's result panel now always shows something meaningful if
  something goes wrong, even in cases that aren't cleanly handled
  elsewhere -- previously, an unexpected failure could leave whatever
  result panel was already on screen from an earlier, successful Apply,
  with no indication anything had actually gone wrong except the
  developer console.
- History now shows what settings were actually in effect for a given
  team's season, right under the season slider -- the max-pipelines
  ceiling that was active at the time, and Academy Mode status if that
  team was covered by it that season. Seasons applied before this was
  added simply don't show anything here, same as the existing pattern
  for older tier-only seasons that predate score tracking.
- Added the ability to clear History from inside the app, instead of
  hunting down and hand-editing `pipeline-history.json` yourself:
  **Clear this season** removes just the currently-viewed season across
  every team in the dynasty, leaving every other season untouched;
  **Clear ALL history for this dynasty** wipes the whole thing. Both ask
  for confirmation first, since neither can be undone.

**v0.6.0**

- Fixed a real bug where any team with more than 30 real pipeline slots
  would have every slot beyond 30 silently ignored on every future
  Apply -- never read, never recalculated, just permanently frozen with
  stale data. The old 30-slot read cap was chosen before this project
  discovered the confirmed structural max is actually 42; the cap is
  gone.
- Replaced the old experimental "Expand teams with fewer real pipeline
  slots" toggle with a single **Max pipelines per team** setting (1-10).
  This is a genuine ceiling, not a floor: teams above it get shrunk down
  to it (freeing rows back to a shared pool), and teams whose real
  recruiting signal only supports fewer pipelines now legitimately come
  back with fewer -- nothing pads a team's count back up with meaningless
  filler just to hit a target number.
- Added **Academy Mode**, under a new settings panel: Army, Navy, and
  Air Force (or any teams you configure) get a much larger, more
  realistic pipeline footprint reflecting their real-world national
  recruiting reach, up to the confirmed structural max of 42 slots,
  instead of the handful the base game gives them. Configurable per-team
  behavior:
  - **Target pipeline count** -- how many slots to bring these teams up to.
  - **Uniform tier** -- lock every slot to the same tier (values still
    vary naturally within that tier's range), or use a one-time
    real-engine-computed snapshot instead.
  - **Exempt** -- set up once, then completely excluded from every future
    run. A fixed real-world trait, not a competitive ranking that
    recalculates every season.
- The engine itself now filters out any region whose score rounds to zero
  before slicing to the target pipeline count, instead of always padding
  a team's result to exactly N regardless of whether N regions actually
  have a meaningful score.
- Added the write-side capability to actually shrink a team's real slot
  count when needed (unlinking excess slots and returning those rows to
  the shared pool) -- the counterpart to the existing expansion capability,
  and the first operation in this project that removes a real link a team
  already has rather than adding one or updating a value. Confirmed at
  the file level and in-game across several teams, including both a small
  drop (11 -> 10 real slots) and a large one (15 -> 10), with the
  remaining pipelines' content verified unchanged and the dropped ones
  verified actually gone.
- Fixed a bug that could crash Apply entirely ("Cannot read properties of
  undefined") -- the write step was building its update data in the wrong
  shape for the underlying save-writing code, left over from an earlier
  version of that code path.
- The Preview list now shows an "[Academy]" status badge (setup / exempt /
  active) next to a team's name when Academy Mode is on, and "Select all"
  now skips academy teams that are already fully set up and exempt, since
  there's nothing to Apply for them.

**v0.5.0**

- After selecting a save, a small info bar now shows the current season,
  which team you're actually playing as (with its logo), and the
  dynasty's code -- confirmed against a real save (the same
  Coach.IsUserControlled field the game itself uses to know who you are).
- If you Apply against a save that's behind other seasons already in that
  dynasty's History (usually from testing against an older copy of the
  same save), you'll now get a clear heads-up explaining what happened,
  instead of just wondering why the newest season didn't show up.
- If History fails to record a season for any reason, that's no longer a
  silent failure -- you'll see a warning that the save itself wrote fine,
  but that specific season's tracking didn't.
- Every Apply now re-opens the freshly-written save as a completely
  separate read and confirms every intended change actually landed
  correctly, showing a green confirmation on success or a clear red
  warning if anything doesn't match -- cheap insurance for the one
  operation in this whole app that touches a copy of your save.

**v0.4.0**

- Added a Before/After toggle to the regular map view, alongside the
  existing "Map colors" toggle -- see a team's pipeline footprint as it
  was before this run, or after, without leaving the map.
- The regular map now also shows a "New Pipelines" / "Dropped Out
  Pipelines" box, the same one History already had -- catches a region
  entering or leaving the top 10 entirely, which the up/down arrows
  can't show since there's no tier to point an arrow at anymore.
- The "Map colors" toggle (team colors vs. the game's own style) is now
  available in three places instead of one -- the regular map, History,
  and now Preview's team list too, all three staying in sync with each
  other since it's really just one shared setting.
- The map's tier legend now shows each region's actual score in
  parentheses, e.g. "Alabama (363)" -- explains cases where two regions
  in the same tier swap listing order season to season (the map color
  doesn't change since the tier didn't change, but the underlying score
  did, and now you can see it).
- History's map legend shows real scores too, for any season applied
  with this version or later -- see the History section above for how
  older, already-applied seasons differ.
- Fixed the Preview list's "Before" column not being sorted the same way
  as "After" -- After was always sorted by score, Before was showing
  whatever raw order the save file happened to store those rows in.
- Added a point-change indicator next to each region's score in the
  "After" column of Preview -- green for gains, red for drops, "new" for
  a region that wasn't tracked at all before this run.
- The weight-sum warning under Settings is now far more sensitive --
  previously it only flagged sums more than 0.02 away from 1.0, so small
  intentional deviations near the edge of that range could look like the
  warning "stopped working." Now anything more than 0.0001 away from 1.0
  triggers it, which only tolerates genuine floating-point rounding, not
  real deviations.
- Added a note at the top of Settings confirming every slider, number
  box, and checkbox saves automatically.

**v0.3.0-beta**

- Added a "Changed only" checkbox next to the team search bar in Preview,
  to quickly narrow the list down to just the teams whose top-10 regions
  actually changed (the same thing the &bull; dot next to a team's name
  flags) -- handy after tweaking a setting when you just want to see
  what actually moved.
- Added adjustable weights for each coaching position (Head Coach vs.
  Offensive/Defensive Coordinator) under Advanced settings -- these are
  proportions, not required to sum to 1, so making Head Coach matter 3x
  more than the coordinators is as simple as setting its number higher.
- Every weight slider (the main 4, decay, geo radius, and the new coach
  position weights) now has a paired number box -- drag the slider or
  type an exact value, both stay in sync.
- Added a "Game style" map color option, alongside the existing
  team-colored map -- a fixed 5-color palette matching the pipeline
  tiers you'd see in-game, for anyone who prefers that over each team's
  own colors. Toggle it from either map view; the choice is remembered.
- Fortified every save-file table lookup to use each table's unique ID
  instead of its numeric table ID or name, on the advice of a community
  member experienced with this file format. Numeric table IDs can shift
  on a game update, which would previously risk silently reading the
  wrong table after a patch -- unique ID is stable across that kind of
  change, and independently verified against a real save file table by
  table before shipping.

**v0.2.0-beta**

- Added a **History** tab: pick any team and scrub through every season
  you've applied so far on the same map view you already know, with
  smooth color transitions between seasons.
- Regions that climbed a tier (or newly entered the top 10) show a green
  up arrow; regions that dropped a tier show a red down arrow, right in
  the tier legend.
- A "New Pipelines" / "Dropped Out Pipelines" box shows any region that
  entered or fell out of the top 10 entirely since the previous season --
  catches cases the arrows can't (a region that's gone completely has no
  tier to show an arrow next to).
- Each team's card in the main preview now shows its Head Coach,
  Offensive Coordinator, and Defensive Coordinator by name, along with
  each one's own pipeline -- something the game itself never surfaces.
- Fixed the normalized-logo sizing/proportions across the full 138-team
  set, so every logo reads at a consistent visual weight regardless of
  how much padding the original image had.

**v0.1.1-beta**

- Fixed a bug where states with a space in their name (New Mexico, North
  Carolina, South Carolina, West Virginia, New York, New Jersey, New
  Hampshire, North Dakota, South Dakota, Rhode Island) weren't showing
  their assigned tier color on the map, even when correctly listed in the
  legend below it.
- Added team logos next to team names in the map view, included out of
  the box.
- Bigger, easier-to-read team name and logo in the map view header.
- Added a custom app icon.
- Preview list now marks any team whose top-10 regions actually changed
  (not just scores shifting) with a small dot next to the name.

**v0.1.0-beta**

- Initial release.
