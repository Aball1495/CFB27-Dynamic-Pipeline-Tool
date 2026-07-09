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

You need Node.js installed.

**Easiest option (Windows):** double-click `start.bat`. First run installs
dependencies automatically (needs internet, only happens once); every run
after that just launches the app straight away.

**Manual option (any OS):**
```
npm install
npm start
```

## Workflow

1. **Open your save** -- select your dynasty save file directly. That's it,
   no exports.
2. **Settings** -- pick a preset (Roster-driven / Blue-chip focused /
   Coach-legacy / Grounded) or adjust individual sliders. Dragging any
   slider away from a preset's values automatically switches the label to
   "Custom."
3. **Run engine** -- reads every team's roster, coaching staff, and current
   pipeline data straight from the save, and computes new top-10 pipelines
   for each.
4. **Preview** -- review before/after for every team side by side before
   anything is written. Search/filter and select which teams to actually
   apply.
5. **Apply** -- writes a **brand new save file copy** with the recomputed
   values. Your original save is **never opened in write mode** at any
   point in this flow -- the app always works on a fresh copy. Load that
   new copy in-game to use the recomputed pipelines.

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

## Known limitations / next steps

- Geography uses real haversine distance from empirically-derived region
  centroids (`data/regionCentroids.json`), built from real player hometown
  data gathered earlier in this project.
- Map/leaderboard visualizations (designed, colors validated against real
  team branding) aren't wired into this UI yet -- currently a simple
  before/after list per team. Worth adding once the core direct-save
  workflow is confirmed solid across a real season of use.
- `engine/pipelineEngine.js` is a direct, verified port of the originally
  validated Python prototype -- same formula, same rounding, tested
  byte-for-byte identical output on real save data before this rewrite.
