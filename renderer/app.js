let settings = null;
let presets = null;
let teamColors = {};
let engineResults = {};
let selectedTeams = new Set();

const TIER_ORDER = ["Unrecognized", "NicheInterest", "Respected", "Popular", "HouseholdName", "CulturalPillar"];

async function init() {
  settings = await window.api.getSettings();
  presets = await window.api.getPresets();
  teamColors = await window.api.getTeamColors();
  syncSlidersFromSettings();
  updatePresetLabel();
}

// ---- File selection (direct save file) ----

let savePath = null;

document.getElementById('btn-select-save').addEventListener('click', async () => {
  const picked = await window.api.selectSaveFile();
  if (!picked) return;
  savePath = picked;
  document.getElementById('save-path-display').textContent = `Selected: ${savePath}`;
});

// ---- Settings sliders/presets ----

const sliderIds = ['wRoster', 'wStar', 'wCoach', 'wGeo'];

function syncSlidersFromSettings() {
  for (const id of sliderIds) {
    document.getElementById(`slider-${id}`).value = settings[id];
    document.getElementById(`num-${id}`).value = settings[id].toFixed(2);
  }
  document.getElementById('chk-hc').checked = settings.coachInclude.HeadCoach;
  document.getElementById('chk-oc').checked = settings.coachInclude.OffensiveCoordinator;
  document.getElementById('chk-dc').checked = settings.coachInclude.DefensiveCoordinator;

  document.getElementById('slider-coachWeightHC').value = settings.coachWeight.HeadCoach;
  document.getElementById('num-coachWeightHC').value = settings.coachWeight.HeadCoach.toFixed(2);
  document.getElementById('slider-coachWeightOC').value = settings.coachWeight.OffensiveCoordinator;
  document.getElementById('num-coachWeightOC').value = settings.coachWeight.OffensiveCoordinator.toFixed(2);
  document.getElementById('slider-coachWeightDC').value = settings.coachWeight.DefensiveCoordinator;
  document.getElementById('num-coachWeightDC').value = settings.coachWeight.DefensiveCoordinator.toFixed(2);

  document.getElementById('select-ramp-mode').value = settings.coachRampMode;
  document.getElementById('input-ramp-seasons').value = settings.coachRampSeasons;
  document.getElementById('slider-decay').value = settings.decay;
  document.getElementById('num-decay').value = settings.decay.toFixed(2);
  document.getElementById('slider-geoRadius').value = settings.geoRadius;
  document.getElementById('num-geoRadius').value = settings.geoRadius;

  const scheme = settings.mapColorScheme || 'team';
  document.getElementById('map-color-scheme-toggle').value = scheme;
  document.getElementById('history-color-scheme-toggle').value = scheme;

  checkWeightSum();
}

function checkWeightSum() {
  const sum = sliderIds.reduce((s, id) => s + settings[id], 0);
  const warning = document.getElementById('weight-sum-warning');
  if (Math.abs(sum - 1.0) > 0.02) {
    warning.classList.remove('hidden');
    document.getElementById('weight-sum-value').textContent = sum.toFixed(2);
  } else {
    warning.classList.add('hidden');
  }
}

function updatePresetLabel() {
  const label = document.getElementById('preset-label');
  const matched = Object.entries(presets).find(([, p]) =>
    sliderIds.every((id) => Math.abs(p[id] - settings[id]) < 0.001)
  );
  document.querySelectorAll('.preset-btn').forEach((btn) => btn.classList.remove('active'));
  if (matched) {
    label.textContent = presetLabelFor(matched[0]);
    const btn = document.querySelector(`[data-preset="${matched[0]}"]`);
    if (btn) btn.classList.add('active');
  } else {
    label.textContent = 'Custom';
  }
}

function presetLabelFor(key) {
  return {
    rosterDriven: 'Roster-driven', blueChipFocused: 'Blue-chip focused',
    coachLegacy: 'Coach-legacy', grounded: 'Grounded',
  }[key] || key;
}

/**
 * Keeps a range slider and a number input showing the same value, in
 * either direction -- dragging the slider updates the number box, typing
 * an exact value in the number box moves the slider to match. onChange
 * receives the new numeric value and is responsible for updating
 * `settings`, persisting, and any side effects (weight-sum check, preset
 * label, re-render, etc.).
 */
function bindSliderNumberPair(sliderId, numId, onChange) {
  const slider = document.getElementById(sliderId);
  const num = document.getElementById(numId);
  const decimals = (slider.step && slider.step.includes('.')) ? slider.step.split('.')[1].length : 0;

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    num.value = decimals > 0 ? v.toFixed(decimals) : v;
    onChange(v);
  });
  num.addEventListener('input', () => {
    const raw = parseFloat(num.value);
    if (Number.isNaN(raw)) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const v = Math.min(max, Math.max(min, raw));
    slider.value = v;
    onChange(v);
  });
}

for (const id of sliderIds) {
  bindSliderNumberPair(`slider-${id}`, `num-${id}`, (v) => {
    settings[id] = v;
    checkWeightSum();
    updatePresetLabel();
    window.api.saveSettings(settings);
  });
}

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    settings = await window.api.applyPreset(settings, btn.dataset.preset);
    syncSlidersFromSettings();
    updatePresetLabel();
    window.api.saveSettings(settings);
  });
});

document.getElementById('chk-hc').addEventListener('change', (e) => { settings.coachInclude.HeadCoach = e.target.checked; window.api.saveSettings(settings); });
document.getElementById('chk-oc').addEventListener('change', (e) => { settings.coachInclude.OffensiveCoordinator = e.target.checked; window.api.saveSettings(settings); });
document.getElementById('chk-dc').addEventListener('change', (e) => { settings.coachInclude.DefensiveCoordinator = e.target.checked; window.api.saveSettings(settings); });

bindSliderNumberPair('slider-coachWeightHC', 'num-coachWeightHC', (v) => {
  settings.coachWeight.HeadCoach = v;
  window.api.saveSettings(settings);
});
bindSliderNumberPair('slider-coachWeightOC', 'num-coachWeightOC', (v) => {
  settings.coachWeight.OffensiveCoordinator = v;
  window.api.saveSettings(settings);
});
bindSliderNumberPair('slider-coachWeightDC', 'num-coachWeightDC', (v) => {
  settings.coachWeight.DefensiveCoordinator = v;
  window.api.saveSettings(settings);
});

document.getElementById('select-ramp-mode').addEventListener('change', (e) => { settings.coachRampMode = e.target.value; window.api.saveSettings(settings); });
document.getElementById('input-ramp-seasons').addEventListener('change', (e) => { settings.coachRampSeasons = parseInt(e.target.value, 10); window.api.saveSettings(settings); });

bindSliderNumberPair('slider-decay', 'num-decay', (v) => {
  settings.decay = v;
  window.api.saveSettings(settings);
});
bindSliderNumberPair('slider-geoRadius', 'num-geoRadius', (v) => {
  settings.geoRadius = Math.round(v);
  window.api.saveSettings(settings);
});

// ---- Map color scheme (team colors vs. the game's own 1-5 pin styling) ----

function applyMapColorScheme(scheme) {
  settings.mapColorScheme = scheme;
  document.getElementById('map-color-scheme-toggle').value = scheme;
  document.getElementById('history-color-scheme-toggle').value = scheme;
  window.api.saveSettings(settings);
  // Re-render whichever map is currently visible so the change shows immediately.
  if (!document.getElementById('map-modal').classList.contains('hidden') && lastOpenedMapTeam) {
    openMapModal(lastOpenedMapTeam, engineResults[lastOpenedMapTeam].after);
  }
  if (!document.getElementById('history-modal').classList.contains('hidden')) {
    currentHistoryTeam = null; // force a full rebuild with the new color scheme
    lastRenderedSeason = null;
    renderHistoryMapForSelection();
  }
}
document.getElementById('map-color-scheme-toggle').addEventListener('change', (e) => applyMapColorScheme(e.target.value));
document.getElementById('history-color-scheme-toggle').addEventListener('change', (e) => applyMapColorScheme(e.target.value));

// ---- Run engine ----

document.getElementById('btn-run').addEventListener('click', async () => {
  if (!savePath) {
    alert('Select a save file first.');
    return;
  }
  const btn = document.getElementById('btn-run');
  btn.textContent = 'Running\u2026';
  btn.disabled = true;
  try {
    engineResults = await window.api.runEngine(savePath, settings);
    selectedTeams = new Set();
    renderPreview();
  } finally {
    btn.textContent = 'Run engine';
    btn.disabled = false;
  }
});

// ---- Preview rendering ----

function tierColorFor(teamName, tierName) {
  const colors = teamColors[teamName];
  const base = colors ? colors[0] : '#888888';
  const tierIndex = TIER_ORDER.indexOf(tierName);
  const lightnessSteps = [0.92, 0.86, 0.68, 0.50, 0.34, 0.20];
  return shadeHex(base, lightnessSteps[tierIndex] ?? 0.5);
}

function shadeHex(hex, targetLightness) {
  const [h, , s] = hexToHsl(hex);
  return hslToHex(h, targetLightness, Math.max(s, 0.5));
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = 0; s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, l, s];
}

function hslToHex(h, l, s) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function isTeamChanged(teamName) {
  const { prior, after } = engineResults[teamName];
  const priorRegions = new Set(prior.map((e) => e[1]));
  const afterRegions = new Set(after.map((e) => e[1]));
  return [...priorRegions].some((r) => !afterRegions.has(r)) || [...afterRegions].some((r) => !priorRegions.has(r));
}

function renderPreview() {
  const list = document.getElementById('preview-list');
  list.innerHTML = '';
  const search = document.getElementById('team-search').value.toLowerCase();
  const changedOnly = document.getElementById('chk-changed-only').checked;

  const teamNames = Object.keys(engineResults)
    .filter((n) => n.toLowerCase().includes(search))
    .filter((n) => !changedOnly || isTeamChanged(n))
    .sort();

  for (const teamName of teamNames) {
    const { prior, after, coaches } = engineResults[teamName];
    const changed = isTeamChanged(teamName);
    const priorRegions = new Set(prior.map((e) => e[1]));

    const row = document.createElement('div');
    row.className = 'team-row';

    const checkboxCell = document.createElement('div');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedTeams.has(teamName);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedTeams.add(teamName);
      else selectedTeams.delete(teamName);
      updateSelectedCount();
    });
    checkboxCell.appendChild(checkbox);

    const nameCell = document.createElement('div');
    nameCell.className = 'team-name';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = teamName + (changed ? ' \u25CF' : '');
    nameCell.appendChild(nameSpan);

    const mapBtn = document.createElement('button');
    mapBtn.className = 'btn btn-map';
    mapBtn.textContent = 'View map';
    mapBtn.addEventListener('click', () => openMapModal(teamName, after));
    nameCell.appendChild(mapBtn);

    const coachPositions = [
      ['HeadCoach', 'HC'],
      ['OffensiveCoordinator', 'OC'],
      ['DefensiveCoordinator', 'DC'],
    ];
    const coachRows = coachPositions.map(([pos, label]) => {
      const c = coaches && coaches[pos];
      if (!c || !c.name) return '';
      return `<div class="coach-line">
        <div class="coach-top"><span class="coach-pos">${label}</span><span class="coach-name">${c.name}</span></div>
        <div class="coach-pipeline">${c.pipeline || '\u2014'}</div>
      </div>`;
    }).filter(Boolean).join('');
    const coachesBlock = document.createElement('div');
    coachesBlock.className = 'team-coaches';
    coachesBlock.innerHTML = coachRows;
    nameCell.appendChild(coachesBlock);

    const beforeCell = document.createElement('div');
    beforeCell.innerHTML = '<div class="team-col-label">Before</div>' + prior.map(([tier, region, val]) =>
      `<div class="region-line"><span><span class="tier-swatch" style="background:${tierColorFor(teamName, tier)}"></span>${region}</span><span>${val}</span></div>`
    ).join('');

    const afterCell = document.createElement('div');
    afterCell.innerHTML = '<div class="team-col-label">After</div>' + after.map(([tier, region, val]) => {
      const isNew = !priorRegions.has(region);
      return `<div class="region-line ${isNew ? 'changed' : ''}"><span><span class="tier-swatch" style="background:${tierColorFor(teamName, tier)}"></span>${region}</span><span>${val}</span></div>`;
    }).join('');

    row.append(checkboxCell, nameCell, beforeCell, afterCell);
    list.appendChild(row);
  }
  updateSelectedCount();
}

document.getElementById('team-search').addEventListener('input', renderPreview);
document.getElementById('chk-changed-only').addEventListener('change', renderPreview);

// ---- Map modal ----

let lastOpenedMapTeam = null;

function openMapModal(teamName, afterEntries) {
  const modal = document.getElementById('map-modal');
  const body = document.getElementById('map-modal-body');
  modal.classList.remove('hidden');
  lastOpenedMapTeam = teamName;
  const colors = teamColors[teamName];
  const baseColor = colors ? colors[0] : '#888888';
  window.PipelineMap.renderTeamMap(body, teamName, baseColor, afterEntries, null, settings.mapColorScheme);
}

document.getElementById('btn-close-map').addEventListener('click', () => {
  document.getElementById('map-modal').classList.add('hidden');
});
document.getElementById('map-modal').addEventListener('click', (e) => {
  if (e.target.id === 'map-modal') e.target.classList.add('hidden');
});

// ---- History modal ----

let currentDynastyHistory = {}; // { [teamName]: { [season]: { [region]: tier } } }

async function openHistoryModal() {
  if (!savePath) {
    alert('Select a save file first -- history is tracked per dynasty, and the tool needs to know which one.');
    return;
  }
  const modal = document.getElementById('history-modal');
  const teamSelect = document.getElementById('history-team-select');
  modal.classList.remove('hidden');

  const dynastyCode = await window.api.getDynastyCodeForSave(savePath);
  const fullHistory = await window.api.getHistory();
  currentDynastyHistory = fullHistory[dynastyCode] || {};

  const teamNames = Object.keys(currentDynastyHistory).sort();
  if (teamNames.length === 0) {
    document.getElementById('history-modal-body').innerHTML =
      '<p class="hint">No history yet for this dynasty -- apply changes at least once, then come back here to see it.</p>';
    teamSelect.innerHTML = '';
    document.querySelector('.history-controls').style.display = 'none';
    return;
  }
  document.querySelector('.history-controls').style.display = '';

  teamSelect.innerHTML = teamNames.map((t) => `<option value="${t}">${t}</option>`).join('');
  teamSelect.value = teamNames[0];
  refreshHistorySeasonRange();
}

let currentHistoryTeam = null;
let lastRenderedSeason = null;

function refreshHistorySeasonRange() {
  const teamName = document.getElementById('history-team-select').value;
  const seasons = Object.keys(currentDynastyHistory[teamName] || {}).map(Number).sort((a, b) => a - b);
  const slider = document.getElementById('history-season-slider');
  if (seasons.length === 0) return;
  slider.min = 0;
  slider.max = seasons.length - 1;
  slider.value = seasons.length - 1; // default to the most recent season
  slider.dataset.seasons = JSON.stringify(seasons);
  currentHistoryTeam = null; // force a full render for the new team
  lastRenderedSeason = null;
  renderHistoryMapForSelection();
}

/**
 * Older history entries (recorded before coach tracking) are a flat
 * { region: tier, ... } object. Newer ones are { tiers: {...}, coaches:
 * {...} }. This normalizes either shape so the rest of the code never
 * needs to care which one it's looking at.
 */
function extractSeasonData(seasonEntry) {
  if (seasonEntry && typeof seasonEntry === 'object' && 'tiers' in seasonEntry) {
    return { tiers: seasonEntry.tiers || {}, coaches: seasonEntry.coaches || null };
  }
  return { tiers: seasonEntry || {}, coaches: null };
}

function renderHistoryMapForSelection() {
  const teamName = document.getElementById('history-team-select').value;
  const slider = document.getElementById('history-season-slider');
  const seasons = JSON.parse(slider.dataset.seasons || '[]');
  const season = seasons[Number(slider.value)];
  if (season === undefined) return;

  // A mouse drag fires many 'input' events that resolve to the same
  // quantized season (only 2-3 real positions on the whole track) --
  // without this guard, each one re-triggers the recolor + legend
  // rebuild, which is what made dragging feel jankier than arrow keys
  // (which naturally fire once per discrete step).
  if (season === lastRenderedSeason && teamName === currentHistoryTeam) return;
  lastRenderedSeason = season;

  document.getElementById('history-season-out').textContent = season;

  const { tiers: tiersByRegion } = extractSeasonData(currentDynastyHistory[teamName][String(season)]);
  const fakeAfterEntries = Object.entries(tiersByRegion).map(([region, tier]) => [tier, region, 0]);

  const seasonIndex = Number(slider.value);
  const prevSeason = seasonIndex > 0 ? seasons[seasonIndex - 1] : null;
  const { tiers: prevTiersByRegionRaw } = prevSeason !== null
    ? extractSeasonData(currentDynastyHistory[teamName][String(prevSeason)])
    : { tiers: null };
  const prevTiersByRegion = prevSeason !== null ? prevTiersByRegionRaw : null;
  const fakePreviousEntries = prevTiersByRegion
    ? Object.entries(prevTiersByRegion).map(([region, tier]) => [tier, region, 0])
    : null;

  const colors = teamColors[teamName];
  const baseColor = colors ? colors[0] : '#888888';
  const body = document.getElementById('history-modal-body');

  renderSeasonChangesSummary(tiersByRegion, prevTiersByRegion);

  if (currentHistoryTeam === teamName) {
    // Same team, just a different season -- recolor in place so the CSS
    // transition on path fill/stroke actually has something to animate.
    window.PipelineMap.updateTeamMapColors(body, baseColor, fakeAfterEntries, fakePreviousEntries, settings.mapColorScheme);
  } else {
    // New team (or first open) -- full rebuild, including the header/logo.
    currentHistoryTeam = teamName;
    window.PipelineMap.renderTeamMap(body, teamName, baseColor, fakeAfterEntries, fakePreviousEntries, settings.mapColorScheme);
  }
}

/**
 * Shows which regions entered or dropped out of the top 10 entirely
 * between the previous season and this one -- distinct from (and a
 * complement to) the up/down arrows in the tier list, which can only
 * mark regions still present in the CURRENT season. A region that fell
 * out of the top 10 completely has nowhere to show an arrow, so this is
 * the only place that gap gets surfaced.
 */
function renderSeasonChangesSummary(currentTiersByRegion, prevTiersByRegion) {
  const el = document.getElementById('history-season-changes');
  if (!prevTiersByRegion) {
    el.innerHTML = '<p class="hint">This is the first tracked season for this team -- nothing to compare yet.</p>';
    return;
  }
  const currentRegions = new Set(Object.keys(currentTiersByRegion));
  const prevRegions = new Set(Object.keys(prevTiersByRegion));
  const newRegions = [...currentRegions].filter((r) => !prevRegions.has(r)).sort();
  const droppedRegions = [...prevRegions].filter((r) => !currentRegions.has(r)).sort();

  if (newRegions.length === 0 && droppedRegions.length === 0) {
    el.innerHTML = '<p class="hint">No pipelines gained or lost this season.</p>';
    return;
  }

  el.innerHTML = `
    ${newRegions.length ? `<div class="season-change-row"><span class="season-change-label new">New Pipelines</span>${newRegions.join(', ')}</div>` : ''}
    ${droppedRegions.length ? `<div class="season-change-row"><span class="season-change-label dropped">Dropped Out Pipelines</span>${droppedRegions.join(', ')}</div>` : ''}
  `;
}

document.getElementById('btn-open-history').addEventListener('click', openHistoryModal);
document.getElementById('history-team-select').addEventListener('change', refreshHistorySeasonRange);
document.getElementById('history-season-slider').addEventListener('input', renderHistoryMapForSelection);
document.getElementById('btn-close-history').addEventListener('click', () => {
  document.getElementById('history-modal').classList.add('hidden');
});
document.getElementById('history-modal').addEventListener('click', (e) => {
  if (e.target.id === 'history-modal') e.target.classList.add('hidden');
});

document.getElementById('chk-select-all').addEventListener('change', (e) => {
  const teamNames = Object.keys(engineResults);
  if (e.target.checked) selectedTeams = new Set(teamNames);
  else selectedTeams = new Set();
  renderPreview();
});

function updateSelectedCount() {
  document.getElementById('selected-count').textContent = `${selectedTeams.size} team(s) selected`;
  document.getElementById('btn-apply').disabled = selectedTeams.size === 0;
}

// ---- Apply ----

document.getElementById('btn-apply').addEventListener('click', async () => {
  const confirmed = confirm(
    `This will write a brand new save file copy with recomputed pipeline values for ${selectedTeams.size} team(s). ` +
    `Your original save is never modified. Continue?`
  );
  if (!confirmed) return;

  const outputDir = await window.api.selectOutputDir();
  if (!outputDir) return;

  const result = await window.api.commitChanges(savePath, engineResults, [...selectedTeams], outputDir);
  const resultDiv = document.getElementById('apply-result');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = `
    <div>New save file created: <strong>${result.outputPath}</strong></div>
    <div class="hint">Load this save in-game to use the recomputed pipelines. Your original save was never touched.</div>
  `;
});

init();
