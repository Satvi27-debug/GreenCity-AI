import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { regions, missionDetails, missionStatuses, initialBuilder } from './data.js';
import { getStoredUser, saveUser, clearStoredUser, mountGoogleButton, verifyGoogleCredential, createDemoUser } from './auth.js';

const STORAGE_KEY = 'green-city-ai-state-v1';

const state = {
  view: 'landing',
  region: 'Coimbatore',
  missionFilter: 'all',
  selectedBuilderTool: null,
  builderMode: 'design',
  compareVisible: false,
  joinedMissions: new Set(),
  savedMissions: new Set(),
  missionStatuses: {},
  generatedObjects: 0,
  builderObjects: [],
  activeMission: null,
  liveData: { status: 'idle', region: null, payload: null, error: null },
  liveRequestId: 0,
  realMap: null,
  realMapLayers: {},
  realMapMarkers: [],
  authUser: getStoredUser(),
  builder: { ...initialBuilder },
};

const readStoredState = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persisted = readStoredState();
if (persisted) {
  state.region = regions.some((region) => region.name === persisted.region) ? persisted.region : state.region;
  state.joinedMissions = new Set(persisted.joinedMissions || []);
  state.savedMissions = new Set(persisted.savedMissions || []);
  state.missionStatuses = persisted.missionStatuses || {};
  state.builder = { ...initialBuilder, ...(persisted.builder || {}) };
  state.builderObjects = Array.isArray(persisted.builderObjects) ? persisted.builderObjects : [];
}

function persistState() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      region: state.region,
      joinedMissions: [...state.joinedMissions],
      savedMissions: [...state.savedMissions],
      missionStatuses: state.missionStatuses,
      builder: state.builder,
      builderObjects: state.builderObjects,
    }));
  } catch {
    // Persistence is an enhancement; the demo remains usable if storage is blocked.
  }
}

const viewNames = {
  landing: 'Home',
  overview: 'Overview',
  map: 'Explore map',
  missions: 'Green missions',
  'green-card': 'My Green Card',
  builder: 'City builder',
  reports: 'Reports',
};

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function iconMarkup(name, className = 'icon') {
  return `<svg class="${className}"><use href="#icon-${name}"></use></svg>`;
}

function showToast(message, type = 'success') {
  const toast = $('#toast');
  const toastMessage = $('#toast-message');
  if (!toast || !toastMessage) return;
  toastMessage.textContent = message;
  toast.classList.toggle('warning', type === 'warning');
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 3400);
}

function regionSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function formatLiveDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function setLiveSourceState(status, message) {
  const element = $('#live-source-state');
  if (!element) return;
  element.className = `live-source-state ${status}`;
  element.innerHTML = `<i></i> ${message}`;
}

function updateMapDataStatus(message, status = 'live') {
  $$('.data-status').forEach((element) => {
    element.classList.toggle('live', status === 'live');
    element.classList.toggle('loading', status === 'loading');
    element.classList.toggle('fallback', status === 'error');
    element.innerHTML = `<span class="status-dot"></span> ${message}`;
  });
}

function resetLivePlaceholders() {
  ['live-temperature', 'live-humidity', 'live-precipitation', 'live-wind', 'live-climate-temperature', 'live-climate-trend', 'live-climate-period', 'live-change-temperature', 'live-change-temperature-period', 'live-change-precipitation', 'live-change-precipitation-period', 'live-change-observation', 'live-change-observation-meta', 'live-imagery-date', 'live-imagery-cloud'].forEach((id) => {
    const element = $(`#${id}`);
    if (element) element.textContent = '—';
  });
  const weatherTime = $('#live-weather-time');
  if (weatherTime) weatherTime.textContent = '—';
  const climateDetail = $('#live-climate-detail');
  if (climateDetail) climateDetail.textContent = 'Connecting to the historical climate record…';
  const image = $('#live-imagery-image');
  if (image) { image.classList.remove('loaded'); image.removeAttribute('src'); }
  const sparkline = $('#live-climate-sparkline-path');
  if (sparkline) sparkline.setAttribute('d', 'M0 34 L720 34');
  $$('.map-surface').forEach((surface) => surface.style.setProperty('--satellite-image', 'none'));
  const placeholder = $('#live-imagery-placeholder');
  if (placeholder) { placeholder.style.display = 'flex'; const label = placeholder.querySelector('span'); if (label) label.textContent = 'Searching for a clear observation…'; }
}

function renderLiveData(payload) {
  const sources = payload?.sources || [];
  const liveSources = sources.filter((source) => source.status === 'ok').length;
  const hasData = payload?.ok && liveSources > 0;
  if (!hasData) {
    setLiveSourceState('error', 'Sources unavailable');
    const networkStatus = $('#network-status-text');
    if (networkStatus) networkStatus.textContent = 'Live sources unavailable · demo fallback';
    const liveLabel = $('#overview-live-label');
    if (liveLabel) liveLabel.textContent = 'DEMO MODE';
    updateMapDataStatus('Demo fallback', 'error');
    return;
  }
  setLiveSourceState('live', `${liveSources}/${sources.length} sources live`);
  const networkStatus = $('#network-status-text');
  if (networkStatus) networkStatus.textContent = `${liveSources}/${sources.length} live sources connected`;
  updateMapDataStatus(`Live sources · ${liveSources}/${sources.length}`);
  const current = payload.current || {};
  const climate = payload.climate || {};
  const imagery = payload.imagery || {};
  const setText = (id, value) => { const element = $(`#${id}`); if (element) element.textContent = value ?? '—'; };
  setText('live-temperature', current.temperatureC ?? '—');
  setText('live-humidity', current.relativeHumidity ?? '—');
  setText('live-precipitation', current.precipitationMm ?? '—');
  setText('live-wind', current.windSpeedKmh ?? '—');
  setText('live-weather-time', current.observedAt ? formatLiveDate(current.observedAt, true) : '—');
  setText('live-climate-temperature', climate.temperatureAverageC ?? '—');
  setText('live-climate-trend', climate.trend || '—');
  setText('live-climate-period', climate.period ? `${climate.period} · MERRA-2` : '—');
  const climateDetail = $('#live-climate-detail');
  if (climateDetail) {
    const delta = climate.temperatureDeltaC;
    const rain = climate.precipitationDeltaMmPerDay;
    climateDetail.textContent = delta === null || delta === undefined ? 'Historical climate summary is not available yet.' : `Temperature ${delta >= 0 ? '+' : ''}${delta}°C and precipitation ${rain >= 0 ? '+' : ''}${rain ?? 0} mm/day vs. the prior period.`;
  }
  const temperatureDelta = climate.temperatureDeltaC;
  const precipitationDelta = climate.precipitationDeltaMmPerDay;
  setText('live-change-temperature', temperatureDelta === null || temperatureDelta === undefined ? '—' : `${temperatureDelta >= 0 ? '+' : ''}${temperatureDelta}°C`);
  setText('live-change-temperature-period', climate.period ? `${climate.period} vs prior period` : 'vs. prior period');
  setText('live-change-precipitation', precipitationDelta === null || precipitationDelta === undefined ? '—' : `${precipitationDelta >= 0 ? '+' : ''}${precipitationDelta} mm/day`);
  setText('live-change-precipitation-period', climate.period ? `${climate.period} vs prior period` : 'vs. prior period');
  setText('live-change-observation', imagery.observedAt ? formatLiveDate(imagery.observedAt) : '—');
  setText('live-change-observation-meta', imagery.observationCount > 1 && imagery.previousObservedAt ? `Latest of ${imagery.observationCount} matches · prior ${formatLiveDate(imagery.previousObservedAt)}` : imagery.cloudCover === null || imagery.cloudCover === undefined ? 'Sentinel-2 observation' : `Sentinel-2 · ${imagery.cloudCover}% cloud`);
  setText('live-change-source', 'NASA POWER · SENTINEL-2');
  setText('live-change-caveat', 'Climate deltas are observed model history; land-cover indices await satellite processing.');
  const sparkline = $('#live-climate-sparkline-path');
  const series = climate.series || [];
  if (sparkline && series.length > 1) {
    const values = series.map((point) => point.temperature).filter((value) => Number.isFinite(value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = series.map((point, index) => {
      const x = (index / (series.length - 1)) * 720;
      const y = 44 - ((point.temperature - min) / range) * 32;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    sparkline.setAttribute('d', points);
  }
  setText('live-imagery-date', imagery.observedAt ? formatLiveDate(imagery.observedAt) : 'No clear match');
  setText('live-imagery-cloud', imagery.cloudCover === null || imagery.cloudCover === undefined ? '' : `${imagery.cloudCover}% cloud cover`);
  const satelliteUrl = imagery.previewUrl ? imagery.previewUrl.replace(/["']/g, '') : '';
  $$('.map-surface').forEach((surface) => surface.style.setProperty('--satellite-image', satelliteUrl ? `url("${satelliteUrl}")` : 'none'));
  const image = $('#live-imagery-image');
  const placeholder = $('#live-imagery-placeholder');
  if (image) {
    image.onload = () => { image.classList.add('loaded'); if (placeholder) placeholder.style.display = 'none'; };
    image.onerror = () => { image.classList.remove('loaded'); if (placeholder) { placeholder.style.display = 'flex'; const label = placeholder.querySelector('span'); if (label) label.textContent = 'Preview unavailable for this observation'; } };
    if (imagery.previewUrl) image.src = imagery.previewUrl; else if (placeholder) { placeholder.style.display = 'flex'; const label = placeholder.querySelector('span'); if (label) label.textContent = 'No clear observation found'; }
  }
  const updated = $('#live-data-updated');
  if (updated) updated.textContent = `Updated ${formatLiveDate(payload.fetchedAt, true)} · ${sources.filter((source) => source.status === 'ok').map((source) => source.id).join(' · ')}`;
  const caveat = $('#live-data-caveat');
  if (caveat) caveat.textContent = imagery.previewUrl ? 'Sentinel-2 preview is observational; vegetation and water indices need processing.' : 'Climate sources are live; satellite preview unavailable.';
  const reportSource = $('#report-data-source');
  if (reportSource) reportSource.textContent = `Live sources · ${sources.filter((source) => source.status === 'ok').map((source) => source.label).join(' · ')}`;
  $$('.map-attribution').forEach((attribution) => { attribution.textContent = imagery.observedAt ? `Sentinel-2 preview · ${formatLiveDate(imagery.observedAt)}` : 'Regional intelligence layer · live sources'; });
  const liveLabel = $('#overview-live-label');
  if (liveLabel) liveLabel.textContent = 'LIVE DATA';
}

async function loadLiveRegionData(regionName, options = {}) {
  const requestId = ++state.liveRequestId;
  const slug = regionSlug(regionName);
  state.liveData = { status: 'loading', region: slug, payload: null, error: null };
  setLiveSourceState('loading', 'Connecting…');
  const networkStatus = $('#network-status-text');
  if (networkStatus) networkStatus.textContent = 'Connecting to public sources…';
  const liveLabel = $('#overview-live-label');
  if (liveLabel) liveLabel.textContent = 'CONNECTING';
  updateMapDataStatus('Connecting…', 'loading');
  resetLivePlaceholders();
  try {
    const refreshQuery = options.refresh ? '?refresh=1' : '';
    const response = await fetch(`/api/regions/${slug}/overview${refreshQuery}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Data service returned ${response.status}`);
    const payload = await response.json();
    if (requestId !== state.liveRequestId) return;
    state.liveData = { status: 'ready', region: slug, payload, error: null };
    renderLiveData(payload);
    if (options.notify) showToast(`Live environmental sources updated for ${regionName}`);
  } catch (error) {
    if (requestId !== state.liveRequestId) return;
    state.liveData = { status: 'error', region: slug, payload: null, error: error.message };
    setLiveSourceState('error', 'Sources unavailable · demo fallback');
    const networkStatus = $('#network-status-text');
    if (networkStatus) networkStatus.textContent = 'Live sources unavailable · demo fallback';
    const liveLabel = $('#overview-live-label');
    if (liveLabel) liveLabel.textContent = 'DEMO MODE';
    updateMapDataStatus('Demo fallback', 'error');
    const caveat = $('#live-data-caveat');
    if (caveat) caveat.textContent = 'Live sources could not be reached; showing the local demo snapshot.';
    const reportSource = $('#report-data-source');
    if (reportSource) reportSource.textContent = 'Demo snapshot · live sources unavailable';
    $$('.map-attribution').forEach((attribution) => { attribution.textContent = 'Regional intelligence layer · demo fallback'; });
    if (options.notify) showToast('Live sources unavailable · showing demo data', 'warning');
  }
}

function userInitials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'AS';
}

function renderAuthUI() {
  const user = state.authUser;
  const initials = userInitials(user?.name);
  const authLabel = $('#auth-button-label');
  const profileButton = $('#profile-button');
  const sidebarAvatar = $('#sidebar-avatar');
  const sidebarName = $('#sidebar-user-name');
  const sidebarRole = $('#sidebar-user-role');
  if (authLabel) authLabel.textContent = user ? 'Account' : 'Sign in';
  if (profileButton) { profileButton.textContent = initials; profileButton.setAttribute('aria-label', user ? `Open ${user.name} account` : 'Sign in to Green City AI'); }
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  if (sidebarName) sidebarName.textContent = user?.name || 'Ananya S.';
  if (sidebarRole) sidebarRole.textContent = user?.provider === 'google' ? 'Google account · Green learner' : user ? 'Demo account · Green learner' : 'Student · Green learner';
  const signedOut = $('#auth-signed-out');
  const signedIn = $('#auth-signed-in');
  if (signedOut) signedOut.hidden = Boolean(user);
  if (signedIn) signedIn.hidden = !user;
  const accountName = $('#auth-account-name');
  const accountEmail = $('#auth-account-email');
  const accountProvider = $('#auth-account-provider');
  const accountAvatar = $('#auth-account-avatar');
  if (accountName) accountName.textContent = user?.name || 'Your Green City profile';
  if (accountEmail) accountEmail.textContent = user?.email || 'Local demo profile';
  if (accountProvider) accountProvider.textContent = user?.provider === 'google' ? 'Google account · identity token received' : 'Demo account · local session';
  if (accountAvatar) accountAvatar.textContent = initials;
  const digitalName = $('#digital-user-name');
  const digitalRole = $('#digital-user-role');
  if (digitalName) digitalName.textContent = user?.name || 'Ananya Sharma';
  if (digitalRole) digitalRole.textContent = user ? `${user.provider === 'google' ? 'Google learner' : 'Demo learner'} · ${state.region}` : `Environmental learner · ${state.region}`;
}

function openAuthModal() {
  renderAuthUI();
  const modal = $('#auth-modal');
  modal?.classList.add('open');
  modal?.setAttribute('aria-hidden', 'false');
  const googleContainer = $('#google-sign-in');
  if (googleContainer) {
    googleContainer.innerHTML = '';
    mountGoogleButton(googleContainer, async (user, credential) => {
      let verifiedUser = user;
      try {
        verifiedUser = await verifyGoogleCredential(credential);
      } catch {
        showToast('Google connected, but server verification is unavailable', 'warning');
      }
      state.authUser = saveUser(verifiedUser);
      renderAuthUI();
      closeAuthModal();
      showToast(`Welcome, ${verifiedUser.name.split(' ')[0]} · Google sign-in connected`);
    }, (error) => showToast(error.message || 'Google sign-in unavailable', 'warning'));
  }
}

function closeAuthModal() {
  const modal = $('#auth-modal');
  modal?.classList.remove('open');
  modal?.setAttribute('aria-hidden', 'true');
}

function bindAuth() {
  $('#auth-button')?.addEventListener('click', openAuthModal);
  $('#profile-button')?.addEventListener('click', openAuthModal);
  $('#auth-close')?.addEventListener('click', closeAuthModal);
  $('#auth-modal')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeAuthModal(); });
  $('#demo-auth-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#auth-demo-name')?.value.trim() || 'Ananya Sharma';
    const email = $('#auth-demo-email')?.value.trim() || 'ananya@example.com';
    const user = createDemoUser(name, email);
    state.authUser = saveUser(user);
    renderAuthUI();
    closeAuthModal();
    showToast(`Welcome, ${name.split(' ')[0]} · demo session started`);
  });
  $('#auth-sign-out')?.addEventListener('click', () => {
    clearStoredUser();
    state.authUser = null;
    renderAuthUI();
    closeAuthModal();
    showToast('You have been signed out');
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAuthModal(); });
  renderAuthUI();
}

function showView(view) {
  if (!viewNames[view]) return;
  state.view = view;
  $$('.view').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  $$('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.body.classList.toggle('landing-mode', view === 'landing');
  if (view !== 'landing') document.body.classList.remove('landing-sidebar-hidden');
  const current = $('#breadcrumb-current');
  if (current) current.textContent = viewNames[view];
  if (view === 'map' && state.realMap) window.setTimeout(() => state.realMap.invalidateSize(), 60);
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mapFeatureSet(regionName) {
  const featureSets = {
    Coimbatore: [
      { name: 'Nilgiri foothills', type: 'Forest', lat: 11.14, lng: 76.86, score: 'Canopy · 82/100' },
      { name: 'Ukkamaram Lake', type: 'Water', lat: 11.02, lng: 76.98, score: 'Water · 64/100' },
      { name: 'R.S. Puram', type: 'City', lat: 11.0, lng: 76.95, score: 'Built-up · +2.8%' },
    ],
    Chennai: [
      { name: 'Adyar river corridor', type: 'Water', lat: 13.0, lng: 80.25, score: 'Water observation' },
      { name: 'Perungali forest edge', type: 'Forest', lat: 12.97, lng: 80.24, score: 'Canopy observation' },
      { name: 'Mylapore', type: 'City', lat: 13.03, lng: 80.27, score: 'Built-up observation' },
    ],
    Bengaluru: [
      { name: 'Cubbon Park', type: 'Forest', lat: 12.976, lng: 77.593, score: 'Canopy observation' },
      { name: 'Ulsoor Lake', type: 'Water', lat: 12.98, lng: 77.62, score: 'Water observation' },
      { name: 'Indiranagar', type: 'City', lat: 12.97, lng: 77.64, score: 'Built-up observation' },
    ],
    Ooty: [
      { name: 'Ooty forest belt', type: 'Forest', lat: 11.42, lng: 76.7, score: 'Canopy observation' },
      { name: 'Ooty lake', type: 'Water', lat: 11.41, lng: 76.69, score: 'Water observation' },
      { name: 'Udhagamandalam', type: 'City', lat: 11.41, lng: 76.695, score: 'Built-up observation' },
    ],
  };
  return featureSets[regionName] || featureSets.Coimbatore;
}

function nasaModisDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 3);
  return date.toISOString().slice(0, 10);
}

function addRealMapLayers(map) {
  const layers = {
    streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }),
    nasa: L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${nasaModisDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxZoom: 18, maxNativeZoom: 9, attribution: 'NASA GIBS · MODIS Terra true color' }),
  };
  Object.entries(layers).forEach(([key, layer]) => { layer.addTo(map); if (key !== 'streets') map.removeLayer(layer); });
  return layers;
}

function setRealMapProvider(provider) {
  if (!state.realMap || !state.realMapLayers[provider]) return;
  Object.entries(state.realMapLayers).forEach(([key, layer]) => {
    if (key === provider) layer.addTo(state.realMap);
    else if (state.realMap.hasLayer(layer)) state.realMap.removeLayer(layer);
  });
  $$('#real-map-provider [data-map-provider]').forEach((button) => button.classList.toggle('active', button.dataset.mapProvider === provider));
  const observation = $('.real-map-observation');
  if (observation) observation.innerHTML = `<i></i> ${provider === 'nasa' ? `NASA GIBS · ${nasaModisDate()}` : provider === 'satellite' ? 'Esri satellite · live tiles' : 'OpenStreetMap · live tiles'}`;
  const labels = { streets: 'OpenStreetMap streets', satellite: 'Esri satellite imagery', nasa: 'NASA GIBS MODIS true color' };
  showToast(`${labels[provider]} layer active`);
}

function updateRealMapRegion() {
  if (!state.realMap) return;
  const region = regions.find((item) => item.name === state.region) || regions[0];
  state.realMap.setView([region.latitude, region.longitude], region.name === 'Ooty' ? 12 : 11, { animate: true });
  state.realMapMarkers.forEach((marker) => marker.remove());
  state.realMapMarkers = mapFeatureSet(region.name).map((feature) => {
    const marker = L.marker([feature.lat, feature.lng], { icon: L.divIcon({ className: `real-map-marker ${feature.type.toLowerCase()}`, html: '', iconSize: [18, 18], iconAnchor: [9, 9] }) });
    marker.addTo(state.realMap);
    marker.bindPopup(`<strong>${feature.name}</strong><span>${feature.type} · ${feature.score}</span>`);
    marker.on('click', () => {
      const title = $('#detail-region-title');
      if (title) title.textContent = feature.name;
      showToast(`${feature.name} selected`);
    });
    return marker;
  });
  state.realMap.invalidateSize();
}

function initRealMap() {
  const container = $('#real-map');
  if (!container || state.realMap) return;
  const region = regions.find((item) => item.name === state.region) || regions[0];
  try {
    state.realMap = L.map(container, { zoomControl: false, attributionControl: true, minZoom: 3, maxZoom: 18, preferCanvas: true }).setView([region.latitude, region.longitude], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(state.realMap);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(state.realMap);
    state.realMapLayers = addRealMapLayers(state.realMap);
    const observation = document.createElement('div');
    observation.className = 'real-map-observation';
    observation.innerHTML = '<i></i> Real map · live tiles';
    container.appendChild(observation);
    $('#full-map')?.classList.add('real-map-ready');
    updateRealMapRegion();
  } catch (error) {
    state.realMap = null;
    showToast('Real map unavailable · showing regional fallback', 'warning');
  }
}

function bindRealMap() {
  initRealMap();
  $$('#real-map-provider [data-map-provider]').forEach((button) => button.addEventListener('click', () => setRealMapProvider(button.dataset.mapProvider)));
}

function closeSidebar() {
  $('#sidebar')?.classList.remove('open');
  document.body.classList.remove('sidebar-open');
}

function openRegionMenu(trigger) {
  const existing = $('.region-menu');
  if (existing) {
    existing.remove();
    if (existing.dataset.trigger === trigger.dataset.trigger) return;
  }
  const menu = document.createElement('div');
  menu.className = 'region-menu';
  menu.dataset.trigger = trigger.dataset.trigger || '';
  menu.innerHTML = regions.map((region) => `
    <button class="region-option ${region.name === state.region ? 'selected' : ''}" data-region="${region.name}">
      <span class="region-option-icon">${iconMarkup('location')}</span>
      <span><strong>${region.name}</strong><small>${region.area}</small></span>
      ${region.name === state.region ? iconMarkup('check', 'icon region-check') : ''}
    </button>
  `).join('');
  document.body.appendChild(menu);
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(205, rect.width);
  menu.style.top = `${rect.bottom + 8}px`;
  menu.style.left = `${Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)}px`;
  menu.style.minWidth = `${width}px`;
  menu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-region]');
    if (!option) return;
    selectRegion(option.dataset.region);
    menu.remove();
  });
}

function selectRegion(name, silent = false) {
  const region = regions.find((item) => item.name === name) || regions[0];
  state.region = region.name;
  const topRegion = $('#top-region');
  if (topRegion) topRegion.textContent = region.name;
  const mapRegionSelect = $('#map-region-select span');
  if (mapRegionSelect) mapRegionSelect.textContent = `${region.name} region`;
  $$('.region-select span:nth-child(2)').forEach((element) => { element.textContent = region.name; });
  const selectedName = $('#map-selected-name');
  if (selectedName) selectedName.textContent = `${region.name} region`;
  const detailTitle = $('#detail-region-title');
  if (detailTitle) detailTitle.textContent = `${region.name} region`;
  const reportEyebrow = $('.report-paper .eyebrow');
  if (reportEyebrow) reportEyebrow.textContent = `${region.name.toUpperCase()} REGION · ${region.area.toUpperCase()}`;
  const mapDetailSubtitle = $('.detail-title-row p');
  if (mapDetailSubtitle) mapDetailSubtitle.textContent = region.area;
  const selectedSubtitle = $('.selected-region small');
  if (selectedSubtitle) selectedSubtitle.textContent = `Selected monitoring area · ${region.size}`;
  $$('.label-city').forEach((cityLabel) => { cityLabel.textContent = region.name.toUpperCase(); });

  const healthScore = $('.health-score');
  if (healthScore) healthScore.innerHTML = `${region.health}<span>/100</span>`;
  const detailScore = $('.detail-score strong');
  if (detailScore) detailScore.innerHTML = `${region.health}<span>/100</span>`;
  const metricValues = $$('.metric-card .metric-value');
  if (metricValues[0]) metricValues[0].innerHTML = `${region.forest.replace('%', '')}<span>%</span>`;
  if (metricValues[1]) metricValues[1].innerHTML = `${region.water.replace('/100', '')}<span>/100</span>`;
  if (metricValues[2]) metricValues[2].textContent = region.missionCount;
  const detailValues = $$('.detail-stat-list strong');
  if (detailValues[0]) detailValues[0].textContent = region.forest;
  if (detailValues[1]) detailValues[1].textContent = region.water;
  if (detailValues[2]) detailValues[2].textContent = region.built;
  const detailChanges = $$('.detail-stat-list em');
  if (detailChanges[0]) detailChanges[0].textContent = region.forestChange;
  if (detailChanges[1]) detailChanges[1].textContent = region.waterChange;
  if (detailChanges[2]) detailChanges[2].textContent = region.builtChange;
  const insight = $('.ai-detail p');
  if (insight) insight.textContent = `“${region.insight}”`;
  const reportStats = $$('.report-paper-stats strong');
  if (reportStats[0]) reportStats[0].textContent = region.health;
  if (reportStats[1]) reportStats[1].textContent = region.forest;
  if (reportStats[2]) reportStats[2].textContent = region.waterChange;
  const healthBreakdown = $$('.health-breakdown b');
  if (healthBreakdown[0]) healthBreakdown[0].textContent = region.canopyScore;
  if (healthBreakdown[1]) healthBreakdown[1].textContent = region.waterScore;
  if (healthBreakdown[2]) healthBreakdown[2].textContent = region.urbanScore;
  persistState();
  renderAuthUI();
  if (state.realMap) updateRealMapRegion();
  loadLiveRegionData(region.name, { notify: !silent });
  if (!silent) showToast(`Now exploring ${region.name} region`);
}

function bindGlobalSearch() {
  const input = $('#global-search');
  if (!input) return;
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const query = input.value.trim();
      if (!query) return;
      showView('missions');
      showToast(`Searching missions for “${query}”`);
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input.focus();
    }
  });
}

function bindNavigation() {
  document.addEventListener('click', (event) => {
    const viewTrigger = event.target.closest('[data-view]');
    if (viewTrigger) {
      event.preventDefault();
      showView(viewTrigger.dataset.view);
      return;
    }
    const actionTrigger = event.target.closest('[data-action]');
    if (actionTrigger) {
      if (actionTrigger.dataset.action === 'settings') showToast('Settings are coming in the next release');
      if (actionTrigger.dataset.action === 'community') showToast('Community spaces are opening soon');
      if (actionTrigger.dataset.action === 'landing-about') showToast('Green City AI turns environmental data into action');
      if (actionTrigger.dataset.action === 'landing-resources') showToast('Resource library is coming in the next release');
      if (actionTrigger.dataset.action === 'landing-contact') showToast('Contact channel is coming in the next release');
    }
  });
  $('#mobile-menu')?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    if (window.matchMedia('(max-width: 760px)').matches) {
      sidebar.classList.toggle('open');
      document.body.classList.toggle('sidebar-open', sidebar.classList.contains('open'));
    } else {
      document.body.classList.toggle('landing-sidebar-hidden');
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#sidebar') && !event.target.closest('#mobile-menu')) closeSidebar();
  });
}

function bindLanding() {
  $('#landing-menu-toggle')?.addEventListener('click', () => {
    const sidebar = $('#sidebar');
    if (window.matchMedia('(max-width: 760px)').matches) {
      document.body.classList.remove('landing-sidebar-hidden');
      sidebar.classList.toggle('open');
      document.body.classList.toggle('sidebar-open', sidebar.classList.contains('open'));
    } else {
      document.body.classList.toggle('landing-sidebar-hidden');
    }
  });
  $('#landing-theme-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('landing-theme-dim');
    showToast(document.body.classList.contains('landing-theme-dim') ? 'Ambient light softened' : 'Ambient light restored');
  });
  $('#landing-sidebar-close')?.addEventListener('click', () => {
    $('#sidebar')?.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    document.body.classList.add('landing-sidebar-hidden');
  });
}

function bindNotifications() {
  const button = $('#notification-button');
  const panel = $('#notification-panel');
  button?.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('open');
    panel.setAttribute('aria-hidden', String(!panel.classList.contains('open')));
  });
  $$('[data-close-panel]').forEach((close) => close.addEventListener('click', () => {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  }));
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#notification-panel') && !event.target.closest('#notification-button')) {
      panel?.classList.remove('open');
      panel?.setAttribute('aria-hidden', 'true');
    }
  });
}

function bindRegionSelectors() {
  $('#region-select')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openRegionMenu(event.currentTarget);
  });
  $('#map-region-select')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openRegionMenu(event.currentTarget);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.region-menu') && !event.target.closest('.region-select') && !event.target.closest('#map-region-select')) {
      $('.region-menu')?.remove();
    }
  });
}

function bindMapLayers() {
  $$('[data-map-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      const layer = button.dataset.mapLayer;
      $$('[data-map-layer]').forEach((item) => item.classList.toggle('active', item.dataset.mapLayer === layer));
      $$('.map-surface').forEach((surface) => { surface.dataset.layerState = layer; });
      if (layer === 'satellite') setRealMapProvider('satellite');
      const label = button.textContent.replace(/\s+\d+$/, '').trim();
      showToast(`${label} layer ${layer === 'all' ? 'enabled' : 'focused'}`);
    });
  });
  $$('.map-marker').forEach((marker) => marker.addEventListener('click', (event) => {
    event.stopPropagation();
    const name = marker.dataset.marker;
    const title = $('#detail-region-title');
    if (title) title.textContent = name;
    const selected = $('#map-selected-name');
    if (selected) selected.textContent = name;
    showToast(`${name} selected · regional detail ready`);
  }));
  $$('.map-zoom-controls button').forEach((button) => button.addEventListener('click', () => {
    showToast(button.getAttribute('aria-label') || 'Map view updated');
  }));
}

function bindTimeControls() {
  const cycle = (element, values) => {
    if (!element) return;
    element.addEventListener('click', () => {
      const current = element.querySelector('span');
      const currentIndex = values.indexOf(current?.textContent);
      const next = values[(currentIndex + 1) % values.length];
      if (current) current.textContent = next;
      showToast(`Showing ${next}`);
    });
  };
  cycle($('#trend-range'), ['2020—2025', '2021—2025', 'Last 12 months']);
  cycle($('#change-range'), ['12 months', '3 years', '5 years']);
  cycle($('#map-period-select'), ['2020 — 2025', '2023 — 2025', 'Last 12 months']);
  cycle($('#mission-sort'), ['Recommended', 'Closest first', 'Most credits']);
}

function bindAlerts() {
  $$('.alert-item[data-alert]').forEach((item) => item.addEventListener('click', () => {
    const name = item.dataset.alert;
    const marker = $$('.map-marker').find((candidate) => candidate.dataset.marker?.toLowerCase().includes(name.split(' ')[0].toLowerCase()));
    if (marker) {
      const title = $('#detail-region-title');
      if (title) title.textContent = name;
    }
    showView('map');
    showToast(`${name} alert opened in regional view`);
  }));
}

function filterMissions(filter = state.missionFilter) {
  state.missionFilter = filter;
  let visible = 0;
  $$('.mission-card').forEach((card) => {
    const matches = filter === 'all' || (filter === 'nearby' ? Number(card.dataset.distance) <= 6.8 : card.dataset.category === filter);
    card.classList.toggle('is-hidden', !matches);
    if (matches) visible += 1;
  });
  $('#mission-empty')?.classList.toggle('visible', visible === 0);
}

const statusOrder = missionStatuses.map((status) => status.key);
const baseProfile = { missions: 3, credits: 124, verified: 2 };

function missionStatus(title) {
  return state.missionStatuses[title] || 'open';
}

function setMissionStatus(title, status) {
  if (!missionDetails[title] || !statusOrder.includes(status)) return;
  state.missionStatuses[title] = status;
  if (status === 'open') state.joinedMissions.delete(title);
  else state.joinedMissions.add(title);
  applyMissionState(title);
  updateMissionProfileStats();
  persistState();
}

function advanceMission(title) {
  const current = missionStatus(title);
  const index = statusOrder.indexOf(current);
  if (index < 0 || index >= statusOrder.length - 1) return;
  const next = statusOrder[index + 1];
  setMissionStatus(title, next);
  const label = missionStatuses.find((status) => status.key === next)?.label || next;
  showToast(next === 'completed' ? `“${title}” completed · ${missionDetails[title].credits} credits added` : `“${title}” moved to ${label}`);
  if (state.activeMission === title) renderMissionDetail(title);
}

function updateMissionProfileStats() {
  const completed = Object.entries(state.missionStatuses).filter(([, status]) => status === 'completed');
  const verified = Object.entries(state.missionStatuses).filter(([, status]) => status === 'verified' || status === 'completed');
  const earnedCredits = completed.reduce((total, [title]) => total + (missionDetails[title]?.credits || 0), 0);
  const joined = $('#hero-missions-joined');
  const credits = $('#hero-credits');
  const verifiedCount = $('#hero-verified-impacts');
  if (joined) joined.textContent = baseProfile.missions + state.joinedMissions.size;
  if (credits) credits.textContent = baseProfile.credits + earnedCredits;
  if (verifiedCount) verifiedCount.textContent = baseProfile.verified + verified.length;
  const impactMetric = $$('.metric-card')[3]?.querySelector('.metric-value');
  if (impactMetric) impactMetric.innerHTML = `${baseProfile.credits + earnedCredits}<span> pts</span>`;
}

function applyMissionState(title) {
  const card = $$('.mission-card').find((item) => item.dataset.mission === title);
  if (!card) return;
  const status = missionStatus(title);
  const button = $('.join-mission', card);
  const save = $('.save-mission', card);
  if (save) save.classList.toggle('saved', state.savedMissions.has(title));
  if (!button) return;
  button.classList.remove('button-primary', 'joined-button');
  button.disabled = false;
  if (status === 'open') {
    button.innerHTML = `Join mission ${iconMarkup('arrow')}`;
    return;
  }
  button.classList.add('joined-button');
  const label = status === 'completed' ? 'Completed' : status === 'verified' ? 'Verified' : 'View progress';
  button.innerHTML = `${iconMarkup(status === 'completed' || status === 'verified' ? 'check' : 'target')} ${label}`;
  button.disabled = status === 'completed';
}

function toggleSavedMission(title) {
  if (!missionDetails[title]) return;
  if (state.savedMissions.has(title)) state.savedMissions.delete(title);
  else state.savedMissions.add(title);
  applyMissionState(title);
  persistState();
  showToast(state.savedMissions.has(title) ? 'Mission saved to your list' : 'Mission removed from saved list');
  if (state.activeMission === title) renderMissionDetail(title);
}

function renderMissionTimeline(status) {
  const timeline = $('#mission-timeline');
  if (!timeline) return;
  const currentIndex = Math.max(0, statusOrder.indexOf(status));
  timeline.innerHTML = missionStatuses.map((item, index) => {
    const className = index < currentIndex ? 'done' : index === currentIndex ? 'current' : '';
    return `<div class="mission-timeline-step ${className}"><i class="mission-timeline-dot"></i><span>${item.shortLabel}</span></div>`;
  }).join('');
}

function missionActionLabel(status) {
  return {
    open: 'Accept mission',
    accepted: 'Start mission',
    'in-progress': 'Submit evidence',
    'evidence-submitted': 'Verify activity',
    verified: 'Complete mission',
    completed: 'Mission completed',
  }[status] || 'View mission';
}

function renderMissionDetail(title) {
  const details = missionDetails[title];
  if (!details) return;
  const status = missionStatus(title);
  state.activeMission = title;
  const category = $('#mission-detail-category');
  const statusPill = $('#mission-detail-status');
  const titleEl = $('#mission-detail-title');
  const kicker = $('#mission-detail-kicker');
  const icon = $('#mission-detail-icon');
  const description = $('#mission-detail-description');
  const location = $('#mission-detail-location');
  const date = $('#mission-detail-date');
  const participants = $('#mission-detail-participants');
  const impact = $('#mission-detail-impact');
  const evidence = $('#mission-detail-evidence');
  const credits = $('#mission-detail-credits');
  const secondary = $('#mission-detail-secondary');
  const action = $('#mission-detail-action');
  const evidenceNote = $('#mission-evidence-note');
  if (category) { category.textContent = details.categoryLabel; category.className = `mission-detail-category ${details.category}`; }
  if (statusPill) { statusPill.textContent = missionStatuses.find((item) => item.key === status)?.label || status; statusPill.className = `mission-status-pill ${status}`; }
  if (titleEl) titleEl.textContent = title;
  if (kicker) kicker.textContent = `GREEN MISSION · ${details.distance.toUpperCase()}`;
  if (icon) icon.innerHTML = iconMarkup(details.icon);
  if (description) description.textContent = details.description;
  if (location) location.textContent = details.location;
  if (date) date.textContent = details.date;
  if (participants) participants.textContent = `${details.participants} participants`;
  if (impact) impact.textContent = details.impact;
  if (evidence) evidence.textContent = `Evidence: ${details.evidence}`;
  if (credits) credits.textContent = `+${details.credits}`;
  if (secondary) {
    const saved = state.savedMissions.has(title);
    secondary.textContent = saved ? 'Saved to list' : 'Save mission';
    secondary.classList.toggle('joined-button', saved);
  }
  if (action) {
    action.innerHTML = `${missionActionLabel(status)} ${status === 'completed' ? '' : iconMarkup('arrow')}`;
    action.disabled = status === 'completed';
    action.classList.toggle('joined-button', status === 'completed');
  }
  if (evidenceNote) {
    evidenceNote.textContent = status === 'in-progress'
      ? 'Choose a photo, video, or field note when you are ready to submit evidence.'
      : status === 'evidence-submitted'
        ? 'Evidence is queued for a mission leader or organization to review.'
        : 'You can submit photos, a short video, or a field note as verification evidence.';
  }
  renderMissionTimeline(status);
}

function openMissionDetail(title) {
  if (!missionDetails[title]) return;
  renderMissionDetail(title);
  const backdrop = $('#mission-detail-backdrop');
  backdrop?.classList.add('open');
  backdrop?.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => $('#mission-detail-action')?.focus(), 80);
}

function closeMissionDetail() {
  const backdrop = $('#mission-detail-backdrop');
  backdrop?.classList.remove('open');
  backdrop?.setAttribute('aria-hidden', 'true');
  state.activeMission = null;
}

function bindMissionDetailModal() {
  $('#mission-detail-close')?.addEventListener('click', closeMissionDetail);
  $('#mission-detail-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeMissionDetail();
  });
  $('#mission-detail-secondary')?.addEventListener('click', () => {
    if (state.activeMission) toggleSavedMission(state.activeMission);
  });
  $('#mission-detail-action')?.addEventListener('click', () => {
    if (!state.activeMission) return;
    if (missionStatus(state.activeMission) === 'in-progress') {
      $('#mission-evidence-input')?.click();
      return;
    }
    advanceMission(state.activeMission);
  });
  $('#mission-evidence-input')?.addEventListener('change', (event) => {
    if (!state.activeMission || !event.target.files?.length) return;
    const title = state.activeMission;
    setMissionStatus(title, 'evidence-submitted');
    showToast(`Evidence uploaded for “${title}” · review started`);
    renderMissionDetail(title);
    event.target.value = '';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMissionDetail();
  });
}

function bindMissions() {
  $$('#mission-filters [data-mission-filter]').forEach((button) => button.addEventListener('click', () => {
    $$('#mission-filters [data-mission-filter]').forEach((item) => item.classList.toggle('active', item === button));
    filterMissions(button.dataset.missionFilter);
  }));
  $('#clear-mission-filter')?.addEventListener('click', () => {
    $$('#mission-filters [data-mission-filter]').forEach((item) => item.classList.toggle('active', item.dataset.missionFilter === 'all'));
    filterMissions('all');
  });
  $$('.mission-card').forEach((card) => {
    const title = card.dataset.mission;
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      openMissionDetail(title);
    });
    $('.join-mission', card)?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!state.authUser) {
        showToast('Sign in to accept a Green Mission', 'warning');
        openAuthModal();
        return;
      }
      if (missionStatus(title) === 'open') {
        setMissionStatus(title, 'accepted');
        showToast(`You joined “${title}” · start when you are ready`);
      } else {
        openMissionDetail(title);
      }
    });
    $('.save-mission', card)?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleSavedMission(title);
    });
    applyMissionState(title);
  });
  $$('.mission-mini').forEach((item) => item.addEventListener('click', () => openMissionDetail(item.dataset.mission)));
  $('#propose-mission')?.addEventListener('click', openMissionModal);
}

function openMissionModal() {
  if (!state.authUser) {
    showToast('Sign in to propose a Green Mission', 'warning');
    openAuthModal();
    return;
  }
  const backdrop = $('#modal-backdrop');
  backdrop?.classList.add('open');
  backdrop?.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => $('#mission-name-input')?.focus(), 80);
}

function closeMissionModal() {
  const backdrop = $('#modal-backdrop');
  backdrop?.classList.remove('open');
  backdrop?.setAttribute('aria-hidden', 'true');
}

function bindMissionModal() {
  $('#modal-close')?.addEventListener('click', closeMissionModal);
  $('#modal-cancel')?.addEventListener('click', closeMissionModal);
  $('#modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeMissionModal();
  });
  $('#mission-submit')?.addEventListener('click', () => {
    const name = $('#mission-name-input')?.value.trim();
    if (!name) {
      showToast('Add a mission name first', 'warning');
      $('#mission-name-input')?.focus();
      return;
    }
    closeMissionModal();
    $('#mission-name-input').value = '';
    $('#mission-description-input').value = '';
    showToast(`“${name}” was sent for local review`);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMissionModal();
  });
}

function updateBuilderScore() {
  const { greenery, water, air, density } = state.builder;
  const score = Math.round(54 + (greenery * .28) + (water * .1) + (air * .08) - (density * .12));
  const safeScore = Math.max(0, Math.min(100, score));
  const scoreEl = $('#builder-score');
  if (scoreEl) scoreEl.textContent = safeScore;
  const ring = $('#score-ring');
  if (ring) ring.style.background = `conic-gradient(var(--lime) 0 ${safeScore}%, #e8eee4 ${safeScore}% 100%)`;
  const values = { greenery, water, air, density };
  Object.entries(values).forEach(([key, value]) => {
    const valueEl = $(`#${key}-value`);
    const barEl = $(`#${key}-bar`);
    if (valueEl) valueEl.textContent = `${value}%`;
    if (barEl) barEl.style.width = `${value}%`;
  });
  const label = $('#score-label');
  const description = $('#score-description');
  if (label) label.textContent = safeScore >= 80 ? 'Thriving balance' : safeScore >= 65 ? 'Good direction' : 'Needs a little care';
  if (description) description.textContent = safeScore >= 80 ? 'This scenario protects natural capital as it grows.' : 'A little more green space could make this city thrive.';
}

const builderEffects = {
  tree: { greenery: 4, air: 2, balance: 1 },
  park: { greenery: 12, air: 3, balance: 2 },
  lake: { water: 8, air: 1, balance: 1 },
  building: { density: 8, greenery: -1, balance: -1 },
  road: { density: 5, greenery: -1, balance: -1 },
  factory: { air: -12, density: 6, balance: -3 },
};

function recalculateBuilderMetrics() {
  state.builder = { ...initialBuilder };
  state.builderObjects.forEach((object) => {
    const effect = builderEffects[object.tool] || {};
    Object.entries(effect).forEach(([key, delta]) => {
      if (key === 'balance') return;
      state.builder[key] = Math.max(0, Math.min(100, state.builder[key] + delta));
    });
  });
  updateBuilderScore();
}

function removeBuilderObject(item) {
  const specIndex = state.builderObjects.findIndex((object) => object.tool === item.dataset.object && object.transform === item.style.transform);
  if (specIndex >= 0) state.builderObjects.splice(specIndex, 1);
  item.remove();
  state.generatedObjects = Math.max(0, state.generatedObjects - 1);
  recalculateBuilderMetrics();
  persistState();
  showToast('Element removed from this scenario');
}

function addBuilderObject(tool, x = 50, y = 50, announce = true, applyEffects = true, recordObject = true) {
  if (!tool || !$('#placed-items')) return;
  const item = document.createElement('button');
  const labels = { tree: 'Tree', park: 'Park', lake: 'Water body', building: 'Building', road: 'Road', factory: 'Factory' };
  const transform = `scale(${0.72 + Math.random() * .18}) rotate(${Math.random() * 12 - 6}deg)`;
  item.className = `placed-object placed-${tool} generated-object`;
  item.dataset.object = tool;
  item.setAttribute('aria-label', labels[tool] || tool);
  item.innerHTML = iconMarkup(tool === 'road' ? 'road' : tool);
  item.style.left = `${Math.max(3, Math.min(92, x))}%`;
  item.style.top = `${Math.max(38, Math.min(90, y))}%`;
  item.style.transform = transform;
  $('#placed-items').appendChild(item);
  state.generatedObjects += 1;
  if (recordObject) state.builderObjects.push({ tool, x: Number(item.style.left.replace('%', '')), y: Number(item.style.top.replace('%', '')), transform });
  const effect = builderEffects[tool] || {};
  if (applyEffects) {
    Object.entries(effect).forEach(([key, delta]) => {
      if (key === 'balance') return;
      state.builder[key] = Math.max(0, Math.min(100, state.builder[key] + delta));
    });
  }
  updateBuilderScore();
  persistState();
  if (announce) showToast(`${labels[tool]} added · indicators updated`);
}

function resetBuilder() {
  $$('.generated-object').forEach((item) => item.remove());
  state.builder = { ...initialBuilder };
  state.generatedObjects = 0;
  state.builderObjects = [];
  updateBuilderScore();
  persistState();
  showToast('City reset to the starting scenario');
}

function bindBuilder() {
  $$('.palette-item').forEach((item) => item.addEventListener('click', () => {
    state.selectedBuilderTool = item.dataset.place;
    $$('.palette-item').forEach((paletteItem) => paletteItem.classList.toggle('selected', paletteItem === item));
    showToast(`${item.querySelector('strong')?.textContent || 'Element'} selected · click the city to place it`);
  }));
  $('#builder-canvas')?.addEventListener('click', (event) => {
    if (event.target.closest('.placed-object')) return;
    if (!state.selectedBuilderTool) {
      showToast('Choose an element from your toolkit first', 'warning');
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    addBuilderObject(state.selectedBuilderTool, ((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100);
  });
  $('#builder-canvas')?.addEventListener('dblclick', (event) => {
    const object = event.target.closest('.generated-object');
    if (!object) return;
    removeBuilderObject(object);
  });
  $$('.builder-mode button').forEach((button) => button.addEventListener('click', () => {
    state.builderMode = button.dataset.builderMode;
    $$('.builder-mode button').forEach((item) => item.classList.toggle('active', item === button));
    if (state.builderMode === 'compare') {
      state.compareVisible = true;
      $('#compare-panel')?.classList.add('visible');
    } else {
      state.compareVisible = false;
      $('#compare-panel')?.classList.remove('visible');
    }
  }));
  $('#compare-builder')?.addEventListener('click', () => {
    state.compareVisible = !state.compareVisible;
    $('#compare-panel')?.classList.toggle('visible', state.compareVisible);
    showView('builder');
    showToast(state.compareVisible ? 'Scenario comparison is visible below' : 'Scenario comparison hidden');
  });
  $('#reset-builder')?.addEventListener('click', resetBuilder);
  updateBuilderScore();
}

function bindReports() {
  $('#download-report')?.addEventListener('click', () => {
    showToast('Opening print-ready report · choose “Save as PDF”');
    window.setTimeout(() => window.print(), 220);
  });
  $('#generate-report')?.addEventListener('click', () => {
    showToast('Report refreshed with the latest demo signals');
    const reportTitle = $('.report-paper-title h2');
    if (reportTitle) reportTitle.innerHTML = 'A healthier city is<br /><em>still being built.</em>';
  });
  $('#share-card')?.addEventListener('click', async () => {
    const text = 'My Green City AI environmental participation record';
    try {
      await navigator.clipboard?.writeText(text);
      showToast('Profile summary copied to your clipboard');
    } catch {
      showToast('Your Green Card is ready to share');
    }
  });
  $$('.report-row').forEach((row) => row.addEventListener('click', () => {
    $$('.report-row').forEach((item) => item.classList.toggle('active', item === row));
    showToast(`${row.querySelector('strong')?.textContent || 'Report'} selected`);
  }));
}

function bindLiveData() {
  $('#refresh-live-data')?.addEventListener('click', () => loadLiveRegionData(state.region, { notify: true, refresh: true }));
  const dateLabel = $('#overview-date-label');
  if (dateLabel) dateLabel.textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date()).toUpperCase();
}

function bindInitialInteractions() {
  $$('.metric-card').forEach((card) => card.addEventListener('click', () => {
    const metric = card.querySelector('.metric-kicker')?.textContent?.toLowerCase();
    if (metric?.includes('water')) showView('map');
    else if (metric?.includes('mission')) showView('missions');
    else if (metric?.includes('impact')) showView('green-card');
  }));
  $('#top-region')?.parentElement?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') openRegionMenu(event.currentTarget);
  });
}

function restoreLocalState() {
  selectRegion(state.region, true);
  const storedObjects = [...state.builderObjects];
  storedObjects.forEach((object) => {
    addBuilderObject(object.tool, object.x, object.y, false, false, false);
  });
  $$('.generated-object').forEach((item, index) => {
    if (storedObjects[index]?.transform) item.style.transform = storedObjects[index].transform;
  });
  Object.keys(state.missionStatuses).forEach(applyMissionState);
  updateMissionProfileStats();
  updateBuilderScore();
}

function init() {
  bindNavigation();
  bindLanding();
  bindNotifications();
  bindAuth();
  bindGlobalSearch();
  bindRegionSelectors();
  bindMapLayers();
  bindRealMap();
  bindTimeControls();
  bindAlerts();
  bindMissions();
  bindMissionDetailModal();
  bindMissionModal();
  bindBuilder();
  bindReports();
  bindLiveData();
  bindInitialInteractions();
  filterMissions('all');
  restoreLocalState();
  updateBuilderScore();
}

init();
