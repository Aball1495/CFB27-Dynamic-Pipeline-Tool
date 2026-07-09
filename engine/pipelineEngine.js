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
 * @returns {Array} top 10 [[tierName, regionName, score], ...] sorted descending by score
 */
function computeTeamPipelines(teamName, players, coaches, priorEntries, regionCentroids, settings) {
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

  const ranked = Object.entries(rawScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

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
  STAR_WEIGHT,
  PRESETS,
  defaultSettings,
  applyPreset,
  coachComponent,
  computeTeamPipelines,
};
