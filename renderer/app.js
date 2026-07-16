let settings = null;
let presets = null;
let teamColors = {};
let engineResults = {};
let selectedTeams = new Set();

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
  await refreshSaveInfoBar();
});

async function refreshSaveInfoBar() {
  const bar = document.getElementById('save-info-bar');
  const logoImg = document.getElementById('save-info-logo');
  const swatchEl = document.getElementById('save-info-swatch');
  const textEl = document.getElementById('save-info-text');

  bar.classList.remove('hidden');
  textEl.textContent = 'Loading dynasty info\u2026';
  logoImg.style.display = 'none';
  swatchEl.style.display = 'none';

  try {
    const info = await window.api.getSaveInfo(savePath);
    const teamName = info.userTeam ? info.userTeam.displayName : null;
    textEl.textContent = teamName
      ? `Season ${info.season} \u2014 Playing as ${teamName} \u2014 Dynasty ${info.dynastyCode}`
      : `Season ${info.season} \u2014 Dynasty ${info.dynastyCode}`;

    if (teamName) {
      const colors = teamColors[teamName];
      swatchEl.style.background = colors ? colors[0] : '#888888';
      swatchEl.style.display = 'inline-block';
      const logosDirUrl = await window.PipelineMap.getLogosDirUrl();
      logoImg.onload = () => { logoImg.style.display = 'inline-block'; swatchEl.style.display = 'none'; };
      logoImg.onerror = () => { logoImg.style.display = 'none'; swatchEl.style.display = 'inline-block'; };
      logoImg.src = `${logosDirUrl}/${encodeURIComponent(teamName)}.png`;
    }
  } catch (err) {
    console.error('Could not load save info:', err);
    textEl.textContent = 'Could not read dynasty info from this save.';
  }
}

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
  document.getElementById('slider-maxPipelines').value = settings.maxPipelines || 10;
  document.getElementById('num-maxPipelines').value = settings.maxPipelines || 10;

  document.getElementById('chk-academy-mode').checked = !!settings.academyMode;
  const academyTeams = settings.academyTeams || [];
  document.getElementById('chk-academy-army').checked = academyTeams.includes('Army');
  document.getElementById('chk-academy-navy').checked = academyTeams.includes('Navy');
  document.getElementById('chk-academy-airforce').checked = academyTeams.includes('Air Force');
  document.getElementById('slider-academyTarget').value = settings.academyTargetCount || 42;
  document.getElementById('num-academyTarget').value = settings.academyTargetCount || 42;
  document.getElementById('chk-academy-exempt').checked = settings.academyExempt !== false;
  document.getElementById('chk-academy-uniform').checked = settings.academyUniform !== false;
  document.getElementById('select-academyUniformTier').value = settings.academyUniformTier || 'Respected';
  updateAcademySubSettingsVisibility();

  const scheme = settings.mapColorScheme || 'team';
  document.getElementById('map-color-scheme-toggle').value = scheme;
  document.getElementById('history-color-scheme-toggle').value = scheme;
  document.getElementById('preview-color-scheme-toggle').value = scheme;

  checkWeightSum();
}

function checkWeightSum() {
  const sum = sliderIds.reduce((s, id) => s + settings[id], 0);
  const warning = document.getElementById('weight-sum-warning');
  if (Math.abs(sum - 1.0) > 0.0001) {
    warning.classList.remove('hidden');
    document.getElementById('weight-sum-value').textContent = sum.toFixed(4);
  } else {
    warning.classList.add('hidden');
  }
}

/**
 * Academy Mode's sub-settings (which teams, target count, exempt,
 * uniform tier) only matter once the feature itself is on, and the
 * uniform-tier picker only matters when academyUniform is also checked
 * -- hides both blocks otherwise rather than showing controls with no
 * effect.
 */
function updateAcademySubSettingsVisibility() {
  const academyOn = document.getElementById('chk-academy-mode').checked;
  document.getElementById('academy-sub-settings').classList.toggle('hidden', !academyOn);
  const uniformOn = document.getElementById('chk-academy-uniform').checked;
  document.getElementById('academy-uniform-tier-row').classList.toggle('hidden', !uniformOn);
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
bindSliderNumberPair('slider-maxPipelines', 'num-maxPipelines', (v) => {
  settings.maxPipelines = Math.round(v);
  window.api.saveSettings(settings);
});

function updateAcademyTeamsFromCheckboxes() {
  const teams = [];
  if (document.getElementById('chk-academy-army').checked) teams.push('Army');
  if (document.getElementById('chk-academy-navy').checked) teams.push('Navy');
  if (document.getElementById('chk-academy-airforce').checked) teams.push('Air Force');
  settings.academyTeams = teams;
  window.api.saveSettings(settings);
}

document.getElementById('chk-academy-mode').addEventListener('change', (e) => {
  settings.academyMode = e.target.checked;
  updateAcademySubSettingsVisibility();
  window.api.saveSettings(settings);
});
document.getElementById('chk-academy-army').addEventListener('change', updateAcademyTeamsFromCheckboxes);
document.getElementById('chk-academy-navy').addEventListener('change', updateAcademyTeamsFromCheckboxes);
document.getElementById('chk-academy-airforce').addEventListener('change', updateAcademyTeamsFromCheckboxes);

bindSliderNumberPair('slider-academyTarget', 'num-academyTarget', (v) => {
  settings.academyTargetCount = Math.round(v);
  window.api.saveSettings(settings);
});

document.getElementById('chk-academy-exempt').addEventListener('change', (e) => {
  settings.academyExempt = e.target.checked;
  window.api.saveSettings(settings);
});
document.getElementById('chk-academy-uniform').addEventListener('change', (e) => {
  settings.academyUniform = e.target.checked;
  updateAcademySubSettingsVisibility();
  window.api.saveSettings(settings);
});
document.getElementById('select-academyUniformTier').addEventListener('change', (e) => {
  settings.academyUniformTier = e.target.value;
  window.api.saveSettings(settings);
});
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
  document.getElementById('preview-color-scheme-toggle').value = scheme;
  window.api.saveSettings(settings);
  // Re-render whichever map is currently visible so the change shows immediately.
  if (!document.getElementById('map-modal').classList.contains('hidden') && lastOpenedMapTeam) {
    switchMapView(currentMapView);
  }
  if (!document.getElementById('history-modal').classList.contains('hidden')) {
    currentHistoryTeam = null; // force a full rebuild with the new color scheme
    lastRenderedSeason = null;
    renderHistoryMapForSelection();
  }
  // Also refresh the Preview list's tier swatches, which use the same scheme.
  if (Object.keys(engineResults).length > 0) renderPreview();
}
document.getElementById('map-color-scheme-toggle').addEventListener('change', (e) => applyMapColorScheme(e.target.value));
document.getElementById('history-color-scheme-toggle').addEventListener('change', (e) => applyMapColorScheme(e.target.value));
document.getElementById('preview-color-scheme-toggle').addEventListener('change', (e) => applyMapColorScheme(e.target.value));

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
  const tierColor = window.PipelineMap.computeTierColor(base, settings.mapColorScheme);
  return tierColor[tierName] || '#888888';
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
    const academyBadge = {
      exempt: ' [Academy \u2014 exempt, no changes]',
      setup: ' [Academy \u2014 setup]',
      active: ' [Academy]',
    }[engineResults[teamName].academyStatus] || '';
    nameSpan.textContent = teamName + (changed ? ' \u25CF' : '') + academyBadge;
    nameCell.appendChild(nameSpan);

    const mapBtn = document.createElement('button');
    mapBtn.className = 'btn btn-map';
    mapBtn.textContent = 'View map';
    mapBtn.addEventListener('click', () => openMapModal(teamName, prior, after));
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

    const sortedPrior = [...prior].sort((a, b) => b[2] - a[2]);
    const beforeCell = document.createElement('div');
    beforeCell.innerHTML = '<div class="team-col-label">Before</div>' + sortedPrior.map(([tier, region, val]) =>
      `<div class="region-line"><span><span class="tier-swatch" style="background:${tierColorFor(teamName, tier)}"></span>${region}</span><span>${val}</span></div>`
    ).join('');

    const priorValueByRegion = {};
    for (const [, region, val] of prior) priorValueByRegion[region] = val;

    const afterCell = document.createElement('div');
    afterCell.innerHTML = '<div class="team-col-label">After</div>' + after.map(([tier, region, val]) => {
      const isNew = !priorRegions.has(region);
      const deltaLabel = isNew
        ? '<span class="region-delta new">new</span>'
        : (() => {
            const delta = val - priorValueByRegion[region];
            if (delta === 0) return '';
            const sign = delta > 0 ? '+' : '';
            const cls = delta > 0 ? 'up' : 'down';
            return `<span class="region-delta ${cls}">${sign}${delta}</span>`;
          })();
      return `<div class="region-line ${isNew ? 'changed' : ''}"><span><span class="tier-swatch" style="background:${tierColorFor(teamName, tier)}"></span>${region}</span><span>${val} ${deltaLabel}</span></div>`;
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
let lastOpenedMapPrior = null;
let lastOpenedMapAfter = null;
let currentMapView = 'after'; // 'before' | 'after'

function entriesToTierMap(entries) {
  const map = {};
  for (const [tier, region] of entries) map[region] = tier;
  return map;
}

function openMapModal(teamName, priorEntries, afterEntries) {
  const modal = document.getElementById('map-modal');
  const body = document.getElementById('map-modal-body');
  modal.classList.remove('hidden');
  lastOpenedMapTeam = teamName;
  lastOpenedMapPrior = priorEntries;
  lastOpenedMapAfter = afterEntries;
  currentMapView = 'after';
  document.getElementById('map-before-after-toggle').value = 'after';
  const colors = teamColors[teamName];
  const baseColor = colors ? colors[0] : '#888888';
  // Comparing against "before" gives the up/down arrows -- showing what
  // changed to get to this point. No comparison baseline when viewing
  // "before" itself (nothing came before the before).
  window.PipelineMap.renderTeamMap(body, teamName, baseColor, afterEntries, priorEntries, settings.mapColorScheme);
  renderSeasonChangesSummary(entriesToTierMap(afterEntries), entriesToTierMap(priorEntries), 'map-season-changes',
    "Nothing to compare -- this team's before/after regions are identical.");
}

function switchMapView(view) {
  currentMapView = view;
  const body = document.getElementById('map-modal-body');
  const colors = teamColors[lastOpenedMapTeam];
  const baseColor = colors ? colors[0] : '#888888';
  if (view === 'after') {
    window.PipelineMap.updateTeamMapColors(body, baseColor, lastOpenedMapAfter, lastOpenedMapPrior, settings.mapColorScheme);
    renderSeasonChangesSummary(entriesToTierMap(lastOpenedMapAfter), entriesToTierMap(lastOpenedMapPrior), 'map-season-changes',
      "Nothing to compare -- this team's before/after regions are identical.");
  } else {
    window.PipelineMap.updateTeamMapColors(body, baseColor, lastOpenedMapPrior, null, settings.mapColorScheme);
    // Viewing "before" itself has nothing earlier to compare against.
    document.getElementById('map-season-changes').innerHTML =
      '<p class="hint">Viewing the before state -- switch to "After" to see what changed.</p>';
  }
}
document.getElementById('map-before-after-toggle').addEventListener('change', (e) => switchMapView(e.target.value));

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
/**
 * Older seasons store each region as a plain tier string (no score
 * tracked). Newer seasons store { tier, value } per region. Detects
 * which shape a given season is in (by checking one region's entry) and
 * normalizes either way -- also transparently unwraps the now-unused
 * { tiers, coaches } shape from an earlier, scrapped experiment, in case
 * any entries got written in that shape.
 */
function extractSeasonData(seasonEntry) {
  const flat = (seasonEntry && typeof seasonEntry === 'object' && 'tiers' in seasonEntry)
    ? (seasonEntry.tiers || {})
    : (seasonEntry || {});

  const regions = Object.keys(flat);
  const hasScores = regions.length > 0 && typeof flat[regions[0]] === 'object' && flat[regions[0]] !== null;

  const tiers = {};
  const values = {};
  for (const region of regions) {
    if (hasScores) {
      tiers[region] = flat[region].tier;
      values[region] = flat[region].value;
    } else {
      tiers[region] = flat[region];
    }
  }
  return { tiers, values, hasScores };
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

  const { tiers: tiersByRegion, values: valuesByRegion, hasScores } =
    extractSeasonData(currentDynastyHistory[teamName][String(season)]);
  const fakeAfterEntries = Object.entries(tiersByRegion).map(([region, tier]) =>
    [tier, region, hasScores ? valuesByRegion[region] : 0]
  );

  const seasonIndex = Number(slider.value);
  const prevSeason = seasonIndex > 0 ? seasons[seasonIndex - 1] : null;
  const prevData = prevSeason !== null
    ? extractSeasonData(currentDynastyHistory[teamName][String(prevSeason)])
    : null;
  const prevTiersByRegion = prevData ? prevData.tiers : null;
  const fakePreviousEntries = prevData
    ? Object.entries(prevData.tiers).map(([region, tier]) =>
        [tier, region, prevData.hasScores ? prevData.values[region] : 0]
      )
    : null;

  const colors = teamColors[teamName];
  const baseColor = colors ? colors[0] : '#888888';
  const body = document.getElementById('history-modal-body');

  renderSeasonChangesSummary(tiersByRegion, prevTiersByRegion, 'history-season-changes',
    'This is the first tracked season for this team -- nothing to compare yet.');

  if (currentHistoryTeam === teamName) {
    // Same team, just a different season -- recolor in place so the CSS
    // transition on path fill/stroke actually has something to animate.
    window.PipelineMap.updateTeamMapColors(body, baseColor, fakeAfterEntries, fakePreviousEntries, settings.mapColorScheme, hasScores);
  } else {
    // New team (or first open) -- full rebuild, including the header/logo.
    currentHistoryTeam = teamName;
    window.PipelineMap.renderTeamMap(body, teamName, baseColor, fakeAfterEntries, fakePreviousEntries, settings.mapColorScheme, hasScores);
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
function renderSeasonChangesSummary(currentTiersByRegion, prevTiersByRegion, elementId, noComparisonMessage) {
  const el = document.getElementById(elementId);
  if (!prevTiersByRegion) {
    el.innerHTML = `<p class="hint">${noComparisonMessage}</p>`;
    return;
  }
  const currentRegions = new Set(Object.keys(currentTiersByRegion));
  const prevRegions = new Set(Object.keys(prevTiersByRegion));
  const newRegions = [...currentRegions].filter((r) => !prevRegions.has(r)).sort();
  const droppedRegions = [...prevRegions].filter((r) => !currentRegions.has(r)).sort();

  if (newRegions.length === 0 && droppedRegions.length === 0) {
    el.innerHTML = '<p class="hint">No pipelines gained or lost.</p>';
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
  // Exempt academy teams have nothing to apply (after mirrors prior) --
  // selecting them is a harmless but pointless write. Select All skips
  // them; a user can still check one individually if they really want to.
  const teamNames = Object.keys(engineResults).filter((n) => engineResults[n].academyStatus !== 'exempt');
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
    ${result.verified === true ? '<div class="verified-ok">\u2713 Write verified -- re-read the new file and confirmed every change landed correctly.</div>' : ''}
    ${result.verified === false ? `<div class="warning-severe">This save may not have written correctly -- ${result.verificationError || 'a post-write check failed.'} Don't load this save yet; re-run Apply, and if this keeps happening, something's genuinely wrong and worth reporting.</div>` : ''}
    ${result.dynastyHistorySeasonWarning ? `<div class="warning">${result.dynastyHistorySeasonWarning}</div>` : ''}
    ${result.historyWarning ? `<div class="warning">${result.historyWarning}</div>` : ''}
  `;
});

init();
