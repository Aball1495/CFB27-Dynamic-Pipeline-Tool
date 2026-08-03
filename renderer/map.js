/**
 * Renders the per-team pipeline map: real US county/state boundaries,
 * shaded with that team's own sharpened color ramp, plus the exact
 * tier-grouped region list below it. This is the validated design from
 * earlier in the project, wired to real engine output instead of mockup
 * data.
 *
 * Uses D3 + topojson (loaded via CDN in index.html) and real US county
 * topology (fetched client-side, same as the original design prototypes).
 */

const TIER_NAMES = ["Unrecognized", "NicheInterest", "Respected", "Popular", "HouseholdName", "CulturalPillar"];
const SPLIT_STATE_FIPS = new Set(["48", "12", "13", "06"]); // TX, FL, GA, CA

// The game's own pin colors for pipeline strength 1-5 (NicheInterest through
// CulturalPillar) -- exact values pulled from the game's own "PIPELINE
// TIERS" legend, not an approximation.
const GAME_TIER_COLORS = {
  Unrecognized: "transparent",
  NicheInterest: "#8e5435",
  Respected: "#9c9c9c",
  Popular: "#cba14b",
  HouseholdName: "#62aec5",
  CulturalPillar: "#bd5fbb",
};

function computeTierColor(baseColor, colorScheme) {
  if (colorScheme === 'game') {
    return { ...GAME_TIER_COLORS };
  }
  const ramp = sharpenedRamp(baseColor);
  const tierColor = {};
  TIER_NAMES.forEach((t, i) => { tierColor[t] = ramp[i - 1] || 'transparent'; });
  return tierColor;
}

let stateToPipelineCache = null;
let countyTopologyCache = null;

function hexToHls(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let l = (max + min) / 2, s, hue;
  if (max === min) { s = 0; hue = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  return [hue, l, s];
}

function hlsToHex(h, l, s) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Validated sharpened ramp: constant hue/saturation, lightness stepped per tier. */
function sharpenedRamp(baseColor, minSat = 0.55) {
  const [hue, , s] = hexToHls(baseColor);
  const sat = Math.max(s, minSat);
  return [0.88, 0.66, 0.46, 0.28, 0.14].map((lt) => hlsToHex(hue, lt, sat));
}

function classifySplit(stateFips, lon, lat) {
  if (stateFips === '48') { // Texas
    if (lat >= 32.3) return 'NorthTexas';
    if (lon <= -98.0) return 'SouthwestTexas';
    return 'EastTexas';
  }
  if (stateFips === '12') { // Florida
    if (lat >= 29.5) return 'NorthFlorida';
    if (lat >= 27.3) return 'CentralFlorida';
    return 'SouthFlorida';
  }
  if (stateFips === '13') { // Georgia
    const d = Math.hypot(lon - -84.39, lat - 33.75);
    return d <= 1.0 ? 'MetroAtlanta' : 'SouthGeorgia';
  }
  if (stateFips === '06') { // California
    return lat >= 36.0 ? 'NorthernCalifornia' : 'SouthernCalifornia';
  }
  return null;
}

function relLuminance(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Border color reacts to the fill it outlines, not just the app's dark/light mode --
 * otherwise two adjacent same-tier regions get a border too faint to read against
 * saturated fills (e.g. a 15%-opacity white line on a dark red fill). */
function borderStrokeFor(fillHex, isDark) {
  if (!fillHex || fillHex === 'transparent') return isDark ? 'rgba(255,255,255,.15)' : '#fff';
  return relLuminance(fillHex) > 0.35 ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.45)';
}

async function getStateToPipeline() {
  if (!stateToPipelineCache) stateToPipelineCache = await window.api.getStateToPipeline();
  return stateToPipelineCache;
}

/**
 * Compares two seasons' region->tier assignments and returns a Map of
 * region -> 'up' | 'down' for every region present in currentEntries
 * whose status improved or declined since previousEntries. A region
 * that's newly present (wasn't tracked at all in the previous season)
 * counts as 'up', since entering the top 10 is itself a gain.
 * previousEntries can be null/undefined -- in that case the map is empty.
 */
function computeRegionChangeDirections(currentEntries, previousEntries) {
  const directions = new Map();
  if (!previousEntries) return directions;

  const tierRank = {};
  TIER_NAMES.forEach((t, i) => { tierRank[t] = i; });

  const prevTiers = {};
  for (const [tier, region] of previousEntries) prevTiers[region] = tier;

  for (const [tier, region] of currentEntries) {
    const prevTier = prevTiers[region];
    if (prevTier === undefined) {
      directions.set(region, 'up'); // newly entered the top 10
    } else if (tierRank[tier] > tierRank[prevTier]) {
      directions.set(region, 'up');
    } else if (tierRank[tier] < tierRank[prevTier]) {
      directions.set(region, 'down');
    }
  }
  return directions;
}

let logosDirUrlCache = null;
async function getLogosDirUrl() {
  if (logosDirUrlCache) return logosDirUrlCache;
  const absPath = await window.api.getLogosDir();
  let p = absPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p; // Windows drive letters need a leading slash for file://
  logosDirUrlCache = 'file://' + p;
  return logosDirUrlCache;
}

async function getCountyTopology() {
  if (!countyTopologyCache) {
    try {
      const res = await fetch('data/counties-10m.json');
      if (!res.ok) throw new Error('local county data missing');
      countyTopologyCache = await res.json();
    } catch (err) {
      const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json');
      countyTopologyCache = await res.json();
    }
  }
  return countyTopologyCache;
}

/**
 * Renders the map + tier list into the given container element.
 *
 * @param {HTMLElement} container
 * @param {string} teamName
 * @param {string} baseColor - team's primary hex color
 * @param {Array} afterEntries - [[tierName, regionName, value], ...] (the engine's "after" output)
 */
async function renderTeamMap(container, teamName, baseColor, afterEntries, previousEntries, colorScheme, showScores = true) {
  container.innerHTML = '<div class="map-loading">Loading map data\u2026</div>';

  const stateToPipeline = await getStateToPipeline();
  const us = await getCountyTopology();

  const tiers = {};
  for (const [tier, region] of afterEntries) tiers[region] = tier;
  const changeDirections = computeRegionChangeDirections(afterEntries, previousEntries);

  const tierColor = computeTierColor(baseColor, colorScheme);
  // index 0 (Unrecognized) intentionally has no color -- shouldn't appear in real "after" data

  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const noneColor = isDark ? '#383835' : '#e1e0d9';

  container.innerHTML = `
    <div class="map-header">
      <span class="map-swatch" style="background:${baseColor}"></span>
      <img class="map-logo" alt="" style="display:none">
      <span class="map-team-name">${teamName}</span>
    </div>
    <div class="map-svg-container"></div>
    <div class="map-tier-list"></div>
    <div class="map-disclaimer">Sub-state lines for TX/FL/GA/CA are geography-based approximations, not EA's exact boundaries.</div>
  `;

  const swatchEl = container.querySelector('.map-swatch');
  const logoImg = container.querySelector('.map-logo');
  logoImg.onload = () => { logoImg.style.display = 'inline-block'; swatchEl.style.display = 'none'; };
  logoImg.onerror = () => { logoImg.style.display = 'none'; swatchEl.style.display = 'inline-block'; };
  const logosDirUrl = await getLogosDirUrl();
  logoImg.src = `${logosDirUrl}/${encodeURIComponent(teamName)}.png`;

  const svgContainer = container.querySelector('.map-svg-container');
  const svg = d3.select(svgContainer).append('svg').attr('viewBox', '0 0 975 610').attr('width', '100%');

  const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const path = d3.geoPath(projection);

  const counties = topojson.feature(us, us.objects.counties).features;
  const states = topojson.feature(us, us.objects.states).features;

  const relevant = counties.filter((d) => SPLIT_STATE_FIPS.has(d.id.slice(0, 2)));
  relevant.forEach((d) => {
    const c = d3.geoCentroid(d);
    d.properties.subregion = classifySplit(d.id.slice(0, 2), c[0], c[1]);
  });
  const grouped = d3.groups(relevant, (d) => d.properties.subregion);
  const mergedShapes = grouped.map(([label, feats]) => ({
    label,
    geo: topojson.merge(us, feats.map((f) => us.objects.counties.geometries[counties.indexOf(f)])),
  }));

  svg.selectAll('.state').data(states.filter((d) => !SPLIT_STATE_FIPS.has(d.id.slice(0, 2)))).join('path')
    .attr('d', path)
    .attr('data-region', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      return stateToPipeline[stateKey] || '';
    })
    .attr('fill', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const pipeline = stateToPipeline[stateKey];
      const tier = tiers[pipeline];
      return tier ? tierColor[tier] : noneColor;
    })
    .attr('stroke', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const pipeline = stateToPipeline[stateKey];
      const tier = tiers[pipeline];
      return borderStrokeFor(tier ? tierColor[tier] : noneColor, isDark);
    })
    .attr('stroke-width', 1.1);

  mergedShapes.forEach((m) => {
    const tier = tiers[m.label];
    const fillC = tier ? tierColor[tier] : noneColor;
    svg.append('path')
      .attr('d', path({ type: 'MultiPolygon', coordinates: m.geo.coordinates || [m.geo] }))
      .attr('data-region', m.label)
      .attr('fill', fillC)
      .attr('stroke', borderStrokeFor(fillC, isDark))
      .attr('stroke-width', 1.1);
  });

  // Tier-grouped list below, highest tier first -- removes any ambiguity
  // about the map showing more/fewer shapes than real regions (multi-state
  // pipelines like Tidewater or Pacific Northwest span several states).
  const tierListEl = container.querySelector('.map-tier-list');
  tierListEl.innerHTML = buildTierListHTML(afterEntries, tierColor, changeDirections, showScores);
}

function buildTierListHTML(afterEntries, tierColor, changeDirections, showScores = true) {
  const directions = changeDirections || new Map();
  const byTier = {};
  for (const [tier, region, value] of afterEntries) {
    if (!byTier[tier]) byTier[tier] = [];
    const dir = directions.get(region);
    const marker = dir === 'up' ? '<span class="region-up">\u25B2</span>'
      : dir === 'down' ? '<span class="region-down">\u25BC</span>'
      : '';
    const scoreLabel = showScores ? ` <span class="region-score">(${value})</span>` : '';
    byTier[tier].push(`${region}${scoreLabel}${marker}`);
  }
  const orderedTiers = [...TIER_NAMES].reverse().filter((t) => byTier[t]);
  return orderedTiers.map((tier) => `
    <div class="tier-group">
      <div class="tier-group-heading">
        <span class="tier-swatch-lg" style="background:${tierColor[tier]}"></span>
        <span class="tier-group-name">${tier}</span>
      </div>
      <div class="tier-group-regions">${byTier[tier].join(', ')}</div>
    </div>
  `).join('');
}

/**
 * Recolors an already-rendered map in place, without rebuilding the SVG --
 * lets the CSS transition on path fill/stroke actually animate between
 * old and new colors. Use this for season-to-season scrubbing (same team,
 * just different data) instead of calling renderTeamMap again, which
 * tears down and recreates every path with its final color already set
 * (nothing to transition from).
 *
 * Assumes renderTeamMap was already called once for this container/team
 * (so the paths, their data-region tags, and the header/disclaimer exist).
 */
function updateTeamMapColors(container, baseColor, afterEntries, previousEntries, colorScheme, showScores = true) {
  const tiers = {};
  for (const [tier, region] of afterEntries) tiers[region] = tier;
  const changeDirections = computeRegionChangeDirections(afterEntries, previousEntries);

  const tierColor = computeTierColor(baseColor, colorScheme);

  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const noneColor = isDark ? '#383835' : '#e1e0d9';

  const paths = container.querySelectorAll('.map-svg-container path[data-region]');
  paths.forEach((p) => {
    const region = p.getAttribute('data-region');
    const tier = region ? tiers[region] : undefined;
    const fillC = tier ? tierColor[tier] : noneColor;
    p.setAttribute('fill', fillC);
    p.setAttribute('stroke', borderStrokeFor(fillC, isDark));
    p.setAttribute('stroke-width', 1.1);
  });

  const tierListEl = container.querySelector('.map-tier-list');
  if (tierListEl) tierListEl.innerHTML = buildTierListHTML(afterEntries, tierColor, changeDirections, showScores);
}

// ===== National Map (all teams at once) =====
//
// Pipelines aren't exclusive -- dozens of teams can legitimately have the
// same region in their own top 10 simultaneously. There's no single
// "owner" of a region in the data, so this deliberately does NOT try to
// render one. Instead: color each region by whichever team currently has
// the HIGHEST value there ("Regional King" -- who's the biggest fish in
// this pond, not who owns the pond), with a distinct stroke on regions
// where the top two are close (genuinely contested), and the full ranked
// list of every claimant available on click/hover rather than crammed
// into the map fill itself.

// Starting heuristic, not deeply tuned -- top two claimants count as
// "contested" if they're within 15% of the leader's value.
const CONTESTED_RELATIVE_GAP = 0.15;

/**
 * Builds the full per-region breakdown from engineResults (as already
 * returned by run-engine for every team, not just ones selected to
 * Apply). No extra save read needed -- this is pure aggregation over
 * data already sitting in memory.
 *
 * @param {Object} engineResults - { [teamName]: { teamIndex, after: [[tier,region,value],...], ... } }
 * @returns {Object} { [regionName]: { claimants: [{teamName, teamIndex, tierNum, value}, ...] (desc by value), king, contested: boolean } }
 */
function buildNationalPipelineData(engineResults) {
  const byRegion = {};
  for (const [teamName, result] of Object.entries(engineResults)) {
    if (!result || !Array.isArray(result.after)) continue;
    for (const [tierName, region, value] of result.after) {
      if (!byRegion[region]) byRegion[region] = [];
      byRegion[region].push({
        teamName,
        teamIndex: result.teamIndex,
        tierNum: TIER_NAMES.indexOf(tierName), // 1-5 -- same numeric scale the game itself uses
        value,
      });
    }
  }

  const regions = {};
  for (const [region, claimants] of Object.entries(byRegion)) {
    claimants.sort((a, b) => b.value - a.value);
    const king = claimants[0];
    const runnerUp = claimants[1];
    const contested = !!(runnerUp && king && king.value > 0 && (king.value - runnerUp.value) <= king.value * CONTESTED_RELATIVE_GAP);
    regions[region] = { claimants, king, contested };
  }
  return regions;
}

/**
 * Per-conference strongest collective pipeline -- sums each member team's
 * value in a region (0 if that team doesn't have it at all), finds the
 * region with the highest combined total for that conference.
 *
 * @param {Array<{name: string, memberTeamIndexes: number[]}>} conferences - from getConferenceMembers()
 * @param {Object} engineResults - same shape as buildNationalPipelineData
 */
function buildConferenceStrengths(conferences, engineResults) {
  const teamNameByIndex = {};
  for (const [teamName, result] of Object.entries(engineResults)) {
    if (result && result.teamIndex !== undefined) teamNameByIndex[result.teamIndex] = teamName;
  }

  return conferences.map((conf) => {
    const regionTotals = {};
    let membersWithData = 0;
    for (const teamIndex of conf.memberTeamIndexes) {
      const teamName = teamNameByIndex[teamIndex];
      const result = teamName ? engineResults[teamName] : null;
      if (!result || !Array.isArray(result.after)) continue;
      membersWithData++;
      for (const [, region, value] of result.after) {
        regionTotals[region] = (regionTotals[region] || 0) + value;
      }
    }
    let strongestRegion = null;
    let bestTotal = -1;
    for (const [region, total] of Object.entries(regionTotals)) {
      if (total > bestTotal) { bestTotal = total; strongestRegion = region; }
    }
    return {
      conference: conf.name,
      memberCount: conf.memberTeamIndexes.length,
      membersWithData,
      strongestRegion,
      total: strongestRegion ? bestTotal : 0,
    };
  }).sort((a, b) => b.total - a.total);
}

function primaryColorFor(teamName, teamColors) {
  const colors = teamColors && teamColors[teamName];
  return (colors && colors[0]) || null;
}

// Same 5 colors as the game's own pipeline pin icons (bronze -> gray ->
// gold -> teal -> purple), index 0 unused since tier 0 (Unrecognized)
// never appears in real "after" data.
const TIER_PIN_COLORS = [null, '#8e5435', '#9c9c9c', '#cba14b', '#62aec5', '#bd5fbb'];

/**
 * A small inline SVG pin badge matching the game's own pipeline-tier
 * icon shape/coloring (teardrop pin, tier number centered inside) --
 * not the literal game asset (not available to us), but the same shape
 * and exact colors so it reads the same way at a glance.
 */
function buildTierPinSVG(tierNum, size = 22) {
  const color = TIER_PIN_COLORS[tierNum] || '#888';
  return `
    <svg class="tier-pin" width="${size}" height="${Math.round(size * 1.33)}" viewBox="0 0 24 32" aria-label="Tier ${tierNum} of 5">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 8 12 20 12 20s12-12 12-20C24 5.4 18.6 0 12 0z" fill="${color}"/>
      <text x="12" y="16" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" font-family="sans-serif">${tierNum}</text>
    </svg>`;
}

/**
 * Builds the click-detail breakdown for one region -- every claimant,
 * ranked, tier shown as the game's own pin-badge icon (colored 1-5)
 * instead of a name or plain "N/5" text.
 */
function buildRegionBreakdownHTML(regionName, nationalData, teamColors) {
  const entry = nationalData[regionName];
  if (!entry || !entry.claimants.length) {
    return `<div class="region-breakdown-empty">No team currently has ${regionName} in their top pipelines.</div>`;
  }
  const rows = entry.claimants.map((c, i) => {
    const color = primaryColorFor(c.teamName, teamColors) || '#888';
    const isKing = i === 0;
    return `
      <div class="region-claimant-row${isKing ? ' region-claimant-king' : ''}">
        <span class="region-claimant-rank">${i + 1}</span>
        <span class="region-claimant-swatch" style="background:${color}"></span>
        <span class="region-claimant-team">${c.teamName}</span>
        ${buildTierPinSVG(c.tierNum)}
        <span class="region-claimant-value">${c.value}</span>
      </div>`;
  }).join('');
  const contestedNote = entry.contested
    ? `<div class="region-contested-note">Closely contested -- top two are within ${Math.round(CONTESTED_RELATIVE_GAP * 100)}% of each other.</div>`
    : '';
  return `
    <div class="region-breakdown-header">${regionName}</div>
    ${contestedNote}
    <div class="region-claimant-list">${rows}</div>`;
}

/**
 * Renders the national map -- same topology/projection/split-state
 * merging as renderTeamMap, but colored by Regional King instead of one
 * team's own tiers, with a click handler per shape.
 *
 * @param {HTMLElement} container
 * @param {Object} engineResults
 * @param {Object} teamColors - { [teamName]: { primary, ... } }
 * @param {(regionName: string) => void} onRegionClick
 */
async function renderNationalMap(container, engineResults, teamColors, onRegionClick) {
  container.innerHTML = '<div class="map-loading">Loading national map\u2026</div>';

  const stateToPipeline = await getStateToPipeline();
  const us = await getCountyTopology();
  const nationalData = buildNationalPipelineData(engineResults);

  const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const noneColor = isDark ? '#383835' : '#e1e0d9';

  function fillFor(regionName) {
    const entry = nationalData[regionName];
    if (!entry || !entry.king) return noneColor;
    return primaryColorFor(entry.king.teamName, teamColors) || noneColor;
  }
  function isContested(regionName) {
    const entry = nationalData[regionName];
    return !!(entry && entry.contested);
  }

  container.innerHTML = '<div class="map-svg-container"></div>';
  const svgContainer = container.querySelector('.map-svg-container');
  const svg = d3.select(svgContainer).append('svg').attr('viewBox', '0 0 975 610').attr('width', '100%');

  const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const path = d3.geoPath(projection);

  const counties = topojson.feature(us, us.objects.counties).features;
  const states = topojson.feature(us, us.objects.states).features;

  const relevant = counties.filter((d) => SPLIT_STATE_FIPS.has(d.id.slice(0, 2)));
  relevant.forEach((d) => {
    const c = d3.geoCentroid(d);
    d.properties.subregion = classifySplit(d.id.slice(0, 2), c[0], c[1]);
  });
  const grouped = d3.groups(relevant, (d) => d.properties.subregion);
  const mergedShapes = grouped.map(([label, feats]) => ({
    label,
    geo: topojson.merge(us, feats.map((f) => us.objects.counties.geometries[counties.indexOf(f)])),
  }));

  function attachClick(selection, regionNameFn) {
    selection.style('cursor', 'pointer').on('click', function (event, d) {
      const regionName = regionNameFn(d);
      if (regionName && onRegionClick) onRegionClick(regionName);
    });
  }

  const statePaths = svg.selectAll('.state').data(states.filter((d) => !SPLIT_STATE_FIPS.has(d.id.slice(0, 2)))).join('path')
    .attr('d', path)
    .attr('data-region', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      return stateToPipeline[stateKey] || '';
    })
    .attr('fill', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const region = stateToPipeline[stateKey];
      return region ? fillFor(region) : noneColor;
    })
    .attr('stroke', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const region = stateToPipeline[stateKey];
      const contested = region ? isContested(region) : false;
      const fillC = region ? fillFor(region) : noneColor;
      return contested ? '#ffffff' : borderStrokeFor(fillC, isDark);
    })
    .attr('stroke-width', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const region = stateToPipeline[stateKey];
      return region && isContested(region) ? 2.5 : 1.1;
    })
    .attr('stroke-dasharray', (d) => {
      const stateKey = d.properties.name.replace(/[\s']/g, '');
      const region = stateToPipeline[stateKey];
      return region && isContested(region) ? '4,2' : null;
    });
  attachClick(statePaths, (d) => {
    const stateKey = d.properties.name.replace(/[\s']/g, '');
    return stateToPipeline[stateKey] || null;
  });

  mergedShapes.forEach((m) => {
    const fillC = fillFor(m.label);
    const contested = isContested(m.label);
    const shape = svg.append('path')
      .attr('d', path({ type: 'MultiPolygon', coordinates: m.geo.coordinates || [m.geo] }))
      .attr('data-region', m.label)
      .attr('fill', fillC)
      .attr('stroke', contested ? '#ffffff' : borderStrokeFor(fillC, isDark))
      .attr('stroke-width', contested ? 2.5 : 1.1)
      .attr('stroke-dasharray', contested ? '4,2' : null);
    attachClick(shape, () => m.label);
  });

  return nationalData;
}

window.PipelineMap = {
  renderTeamMap, updateTeamMapColors, sharpenedRamp, computeTierColor, getLogosDirUrl,
  renderNationalMap, buildNationalPipelineData, buildConferenceStrengths, buildRegionBreakdownHTML,
};
