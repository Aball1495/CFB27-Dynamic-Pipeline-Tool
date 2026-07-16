/**
 * CFB27 Dynamic Recruiting Pipeline Engine
 * Recomputes each school's 10 active pipeline regions + tiers each preseason,
 * based on roster composition, star-weighted roster quality, coach influence,
 * and geography -- blended with the prior season's persistent score.
 *
 * Ported from the validated Python prototype (pipeline_engine.py). Logic is
 * intentionally identical -- this file should produce the same numbers given
 * the same inputs.
 */

const { SCHOOL_COORDS, haversineMiles } = require('../data/schoolCoordinates');

const ALL_REGIONS = [
  "Alabama","Arizona","Arkansas","BigApple","BigSky","CentralFlorida","Colorado",
  "EastTexas","Hawaii","Illinois","Indiana","Iowa","Kansas","Kentucky","Louisiana",
  "MetroAtlanta","Michigan","Minnesota","Mississippi","Missouri","Nebraska","Nevada",
  "NewEngland","NewMexico","NorthCarolina","NorthFlorida","NorthTexas","NorthernCalifornia",
  "Ohio","Oklahoma","PacificNorthwest","Pennsylvania","SouthCarolina","SouthFlorida",
  "SouthGeorgia","SouthernCalifornia","SouthwestTexas","Tennessee","Tidewater","Utah",
  "WestVirginia","Wisconsin","International"
];

const TIER_NAMES = ["Unrecognized","NicheInterest","Respected","Popular","HouseholdName","CulturalPillar"];

// Real observed score bands from live save data (0-1000 scale)
const DEFAULT_TIER_CUTOFFS = [0, 40, 80, 150, 250];

// Exponential star curve -- validated against real rosters (see project notes).
// A single 5-star meaningfully outweighs a pile of 3-stars, without letting one
// recruit define an entire region on its own.
const STAR_WEIGHT = { ONE_STAR: 1, TWO_STAR: 4, THREE_STAR: 16, FOUR_STAR: 64, FIVE_STAR: 256 };

/**
 * Default settings object. UI should clone/mutate a copy of this per-user,
 * never mutate this shared default.
 */
function defaultSettings() {
  return {
    wRoster: 0.35,
    wStar: 0.35,
    wCoach: 0.20,
    wGeo: 0.10,
    coachInclude: { HeadCoach: true, OffensiveCoordinator: true, DefensiveCoordinator: true },
    coachWeight: { HeadCoach: 0.6, OffensiveCoordinator: 0.2, DefensiveCoordinator: 0.2 },
    coachRampMode: 'ramp',       // 'full' | 'ramp'
    coachRampSeasons: 3,
    decay: 0.75,                  // fraction of prior score kept each preseason
    tierCutoffs: DEFAULT_TIER_CUTOFFS.slice(),
    geoRadius: 300,                // miles; distance at which geo bonus has decayed to ~1/3
    mapColorScheme: 'team',        // 'team' | 'game' -- how the map/legend colors tiers
    // Hard ceiling on how many pipelines a regular (non-academy) team can
    // ever have -- confirmed the underlying save field structurally
    // supports far more, but 11+ was decided against for regular teams.
    // Range 1-10, default 10. This is a CEILING, never a floor: a team
    // whose real engine output has fewer non-zero-scoring regions than
    // this legitimately ends up with fewer (see computeTeamPipelines'
    // zero-score filter) -- nothing pads it back up. Passing this
    // straight into computeTeamPipelines as numPipelines means expansion
    // (a team gaining real slots up to the ceiling, when its genuine
    // signal supports it) and shrinking (a team losing excess real slots
    // above the ceiling) both happen automatically and symmetrically via
    // writeUpdatedSave -- no separate "expand" toggle needed.
    //
    // Superseded the old expandSmallPipelines / pipelineExpansionTarget
    // settings (removed) -- those allowed padding a team UP to a target
    // that could exceed 10 and didn't handle the shrink direction at
    // all; this single setting covers both directions correctly.
    //
    // When academyMode is on, academyTeams are exempt from this cap
    // entirely and use academyTargetCount instead (see below). When
    // academyMode is off, EVERY team -- including Army/Navy/Air Force --
    // follows this ceiling like any other team.
    maxPipelines: 10,

    // Academy Mode -- see academy_mode_spec.md. Represents Army/Navy/Air
    // Force's real-world national recruiting reach as a wide, mostly-fixed
    // pipeline footprint rather than the handful the base game gives them.
    // EXPERIMENTAL, default off -- confirmed at the file level (two-pass
    // setup/skip test) and now spot-checked in-game for the expand+assign
    // side, but never yet lived through a real multi-season Apply cycle
    // in this app.
    academyMode: false,
    academyTeams: ['Army', 'Navy', 'Air Force'],
    academyTargetCount: 42,        // confirmed structural max -- ALL_REGIONS.length (43)
                                    // minus 1, verified across 5 different teams' records
    academyUniform: true,          // true: every slot locked to academyUniformTier (value
                                    // still varies naturally within that tier's range).
                                    // false: a one-time real-engine-computed ranking instead.
                                    // Ignored entirely when academyExempt is false -- see below.
    academyUniformTier: 'Respected',
    academyExempt: true,           // true: set up ONCE, then completely excluded from every
                                    // future run -- a fixed real-world trait, not a
                                    // competitive ranking. false: runs the normal engine
                                    // every season like any other team, just targeting
                                    // academyTargetCount instead of 10.
  };
}

/**
 * The four named presets from the design doc. Each is a full settings object;
 * the UI applies one wholesale, then falls back to labeling the settings
 * "Custom" the moment the user drags any individual slider.
 */
const PRESETS = {
  rosterDriven: { wRoster: 0.35, wStar: 0.35, wCoach: 0.20, wGeo: 0.10 },
  blueChipFocused: { wRoster: 0.20, wStar: 0.55, wCoach: 0.15, wGeo: 0.10 },
  coachLegacy: { wRoster: 0.20, wStar: 0.25, wCoach: 0.45, wGeo: 0.10 },
  grounded: { wRoster: 0.30, wStar: 0.25, wCoach: 0.10, wGeo: 0.35 },
};

function applyPreset(settings, presetName) {
  const preset = PRESETS[presetName];
  if (!preset) throw new Error(`Unknown preset: ${presetName}`);
  return { ...settings, ...preset };
}

/**
 * Given a team's coaching staff, compute a { region: score(0-1) } map based on
 * each active coach's PrimaryPipeline, weighted by coachWeight and ramped up
 * over coachRampSeasons if coachRampMode === 'ramp'.
 */
function coachComponent(coachData, settings) {
  const scores = {};
  const activeEntries = Object.entries(settings.coachWeight).filter(
    ([pos]) => settings.coachInclude[pos]
  );
  const totalW = activeEntries.reduce((sum, [, w]) => sum + w, 0) || 1.0;

  for (const [pos, w] of activeEntries) {
    const info = coachData[pos];
    if (!info || !info.pipeline) continue;
    let ramp = 1.0;
    if (settings.coachRampMode === 'ramp') {
      ramp = settings.coachRampSeasons > 0
        ? Math.min(1.0, info.seasons / settings.coachRampSeasons)
        : 1.0;
    }
    scores[info.pipeline] = (scores[info.pipeline] || 0) + (w / totalW) * ramp;
  }
  return scores;
}

// Value ranges for Academy Mode's uniform-tier assignment -- keeps the map
// color uniform while letting the underlying number vary naturally instead
// of every slot showing the exact same value. Boundaries line up with
// DEFAULT_TIER_CUTOFFS; CulturalPillar's upper end (400) is the same
// arbitrary ceiling already proven out in hardcap_test.cjs / academy_mode_test.cjs.
const TIER_VALUE_RANGES = {
  NicheInterest: [1, 39],
  Respected: [40, 79],
  Popular: [80, 149],
  HouseholdName: [150, 249],
  CulturalPillar: [250, 400],
};

function randomInRange([lo, hi]) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Academy Mode's one-time uniform assignment: every one of targetCount
 * slots gets the same tier, with the underlying value varying naturally
 * within that tier's range. Ported directly from the validated
 * academy_mode_test.cjs / hardcap_test.cjs standalone scripts -- same
 * shuffle-and-slice-to-targetCount logic, same tier-value ranges.
 *
 * Region selection is random per call -- re-previewing before Applying
 * will pick a different subset of ALL_REGIONS each time. That's expected
 * and harmless: nothing is written to the save until Apply, and once a
 * team reaches academyTargetCount real slots (and academyExempt is true),
 * this never runs again for that team.
 */
function buildAcademyAssignment(uniformTier, targetCount) {
  const shuffled = [...ALL_REGIONS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, targetCount).map((region) => [
    uniformTier,
    region,
    randomInRange(TIER_VALUE_RANGES[uniformTier]),
  ]);
}

function tierFor(score, tierCutoffs) {
  let tier = 0;
  for (let i = 0; i < tierCutoffs.length; i++) {
    if (score >= tierCutoffs[i]) tier = i + 1;
  }
  return TIER_NAMES[tier];
}

/**
 * Core computation. Mirrors compute_team_pipelines() from the Python prototype
 * exactly -- same formula, same ordering, same rounding.
 *
 * @param {string} teamName - must match a key in SCHOOL_COORDS
 * @param {Array}  players - [{ pipeline, state, star }]
 * @param {Object} coaches - { HeadCoach: {pipeline, seasons}, OffensiveCoordinator: {...}, DefensiveCoordinator: {...} }
 * @param {Array}  priorEntries - [[tierName, regionName, influenceValue], ...] from last known save state
 * @param {Object} regionCentroids - { regionName: [lat, lng] }
 * @param {Object} settings - a settings object (see defaultSettings())
 * @param {number} numPipelines - how many ranked regions to return. Not
 *   every team actually has 10 real pipeline slots in the save -- some
 *   have fewer (e.g. Sac State has just 1), some have more (many teams
 *   have 11, one has 12), confirmed by reading real save data. Defaults
 *   to 10 for any caller that doesn't know a team's real count, but the
 *   real fix is always passing the team's actual slot count here.
 * @returns {Array} top N [[tierName, regionName, score], ...] sorted descending by score
 */
function computeTeamPipelines(teamName, players, coaches, priorEntries, regionCentroids, settings, numPipelines = 10) {
  const totalRoster = players.length;
  let totalStar = 0;
  for (const p of players) totalStar += STAR_WEIGHT[p.star] || 0;

  const rosterCount = {};
  const starCount = {};
  for (const p of players) {
    if (!p.pipeline) continue;
    rosterCount[p.pipeline] = (rosterCount[p.pipeline] || 0) + 1;
    starCount[p.pipeline] = (starCount[p.pipeline] || 0) + (STAR_WEIGHT[p.star] || 0);
  }

  const coachScores = coachComponent(coaches, settings);
  const schoolCoord = SCHOOL_COORDS[teamName];

  const priorScores = {};
  for (const [, region, value] of priorEntries) priorScores[region] = value;

  const rawScores = {};
  for (const region of ALL_REGIONS) {
    const rosterShare = totalRoster ? (rosterCount[region] || 0) / totalRoster : 0;
    const starShare = totalStar ? (starCount[region] || 0) / totalStar : 0;
    const coachShare = coachScores[region] || 0;

    // Geography: real haversine distance from school to region's empirical
    // centroid, exponential decay -- 1.0 at zero distance, ~0.37 at geoRadius
    // miles. International has no meaningful "distance", always scores 0.
    const regionCoord = regionCentroids[region];
    let geoShare = 0;
    if (schoolCoord && regionCoord) {
      const distance = haversineMiles(schoolCoord, regionCoord);
      geoShare = Math.exp(-distance / settings.geoRadius);
    }

    const thisSeason =
      settings.wRoster * rosterShare +
      settings.wStar * starShare +
      settings.wCoach * coachShare +
      settings.wGeo * geoShare;
    const thisSeasonScaled = thisSeason * 1000;

    const prior = priorScores[region] || 0;
    rawScores[region] = settings.decay * prior + (1 - settings.decay) * thisSeasonScaled;
  }

  // Only regions with a genuinely meaningful score make the cut -- a
  // team's real, non-zero-scoring region count can legitimately be less
  // than numPipelines (e.g. a small program with only 6 real recruiting
  // ties), and this should return exactly that many, not pad the
  // remainder with near-zero filler just to hit N. Math.round(score) > 0
  // matches the same "0 means nothing" convention already used
  // throughout this project (main.js's placeholder-slot filter,
  // shrinkTeamPipelineSlots' freed-row reset) -- a region whose combined
  // roster/star/coach/geo signal rounds to 0 is indistinguishable from
  // one with no real signal at all, even though the raw pre-rounding
  // value from geography's exponential decay is never quite exactly zero.
  const ranked = Object.entries(rawScores)
    .filter(([, score]) => Math.round(score) > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, numPipelines);

  return ranked.map(([region, score]) => [
    tierFor(score, settings.tierCutoffs),
    region,
    Math.round(score),
  ]);
}

module.exports = {
  ALL_REGIONS,
  TIER_NAMES,
  DEFAULT_TIER_CUTOFFS,
  TIER_VALUE_RANGES,
  STAR_WEIGHT,
  PRESETS,
  defaultSettings,
  applyPreset,
  coachComponent,
  computeTeamPipelines,
  buildAcademyAssignment,
};
