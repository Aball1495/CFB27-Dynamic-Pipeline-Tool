# Dynamic Recruiting Pipeline Tool

Recomputes each school's 10 active recruiting pipeline regions/tiers each
preseason, based on roster composition, star-weighted quality, coach
influence, and geography, blended against last season's persistent score.

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
   pipeline data straight from the save, and computes new top-10 pipelines
   for each.
4. **Preview** -- review before/after for every team side by side before
   anything is written. Search/filter and select which teams to actually
   apply. A **filled dot (●)** next to a team's name means at least one
   region entered or dropped out of that team's top 10 entirely -- not
   just a score shifting, but the actual lineup of regions changing. No
   dot means the same regions stuck around, just with different scores.
5. **Apply** -- writes a **brand new save file copy** with the recomputed
   values. Your original save is **never opened in write mode** at any
   point in this flow -- the app always works on a fresh copy. Load that
   new copy in-game to use the recomputed pipelines.

## History

Every time you Apply, that season's results get saved locally (keyed to
your dynasty, not tied to any one save file's location). The **History**
button lets you pick any team and scrub through every season you've
applied so far on the same map view, seeing exactly how its pipeline
footprint shifted year to year. Regions that climbed a tier show a green
up arrow, regions that dropped show a red down arrow, and a separate box
calls out any region that entered or fell out of the top 10 entirely.

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

Every table is accessed by its **numeric ID**, not by name -- this was a
real, hard-won discovery. Name-based lookup (`getTableByName('Team')`)
only found 9 of 143 team records due to how this file format lazily
registers tables; `getTableById(6334)` finds all 143 correctly. The IDs
used throughout `io/saveFile.js`:

| Table | ID |
|---|---|
| Team | 6334 |
| SchoolPipelineInfluence[] (list) | 5919 |
| SchoolPipelineInfluence | 4306 |
| Player | 4244 |
| Coach | 4173 |

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
