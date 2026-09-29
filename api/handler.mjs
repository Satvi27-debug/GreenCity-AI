const REGIONS = {
  coimbatore: {
    id: 'coimbatore',
    name: 'Coimbatore',
    area: 'Tamil Nadu, India',
    latitude: 11.0168,
    longitude: 76.9558,
    bbox: [76.72, 10.82, 77.2, 11.24],
  },
  chennai: {
    id: 'chennai',
    name: 'Chennai',
    area: 'Tamil Nadu, India',
    latitude: 13.0827,
    longitude: 80.2707,
    bbox: [80.04, 12.84, 80.48, 13.3],
  },
  bengaluru: {
    id: 'bengaluru',
    name: 'Bengaluru',
    area: 'Karnataka, India',
    latitude: 12.9716,
    longitude: 77.5946,
    bbox: [77.35, 12.75, 77.82, 13.18],
  },
  ooty: {
    id: 'ooty',
    name: 'Ooty',
    area: 'Nilgiris, India',
    latitude: 11.4102,
    longitude: 76.695,
    bbox: [76.52, 11.22, 76.9, 11.58],
  },
};

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12_000);
const cache = new Map();

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, maxBytes = 32_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Request body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendOptions(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end();
}

function getRegion(id) {
  return REGIONS[String(id || '').toLowerCase()];
}

function regionSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function monthlySeries(parameter) {
  if (!parameter || typeof parameter !== 'object') return [];
  return Object.entries(parameter)
    .filter(([key, value]) => /^\d{4}(0[1-9]|1[0-2])$/.test(key) && Number.isFinite(value) && value !== -999)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ month: key, value }));
}

function summarizeClimate(payload) {
  const parameters = payload?.properties?.parameter || {};
  const temperature = monthlySeries(parameters.T2M);
  const precipitation = monthlySeries(parameters.PRECTOTCORR);
  const recentTemperature = temperature.slice(-12);
  const previousTemperature = temperature.slice(-24, -12);
  const recentPrecipitation = precipitation.slice(-12);
  const previousPrecipitation = precipitation.slice(-24, -12);
  const temperatureAverage = average(recentTemperature.map((item) => item.value));
  const previousTemperatureAverage = average(previousTemperature.map((item) => item.value));
  const precipitationAverage = average(recentPrecipitation.map((item) => item.value));
  const previousPrecipitationAverage = average(previousPrecipitation.map((item) => item.value));
  const temperatureDelta = temperatureAverage !== null && previousTemperatureAverage !== null ? temperatureAverage - previousTemperatureAverage : null;
  const precipitationDelta = precipitationAverage !== null && previousPrecipitationAverage !== null ? precipitationAverage - previousPrecipitationAverage : null;
  const trend = temperatureDelta === null ? 'unknown' : temperatureDelta > 0.35 ? 'warming' : temperatureDelta < -0.35 ? 'cooling' : 'stable';
  const precipitationByMonth = new Map(precipitation.map((item) => [item.month, item.value]));
  const series = temperature.slice(-24).map((item) => ({ month: item.month, temperature: item.value, precipitation: precipitationByMonth.get(item.month) ?? null }));
  return {
    source: 'NASA POWER / MERRA-2',
    series,
    period: recentTemperature.length ? (recentTemperature[0].month.slice(0, 4) === recentTemperature.at(-1).month.slice(0, 4) ? recentTemperature.at(-1).month.slice(0, 4) : `${recentTemperature[0].month.slice(0, 4)}–${recentTemperature.at(-1).month.slice(0, 4)}`) : null,
    temperatureAverageC: temperatureAverage === null ? null : Number(temperatureAverage.toFixed(1)),
    temperatureDeltaC: temperatureDelta === null ? null : Number(temperatureDelta.toFixed(1)),
    precipitationAverageMmPerDay: precipitationAverage === null ? null : Number(precipitationAverage.toFixed(2)),
    precipitationDeltaMmPerDay: precipitationDelta === null ? null : Number(precipitationDelta.toFixed(2)),
    trend,
    sampleMonths: recentTemperature.length,
  };
}

async function getCurrentWeather(region) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: region.latitude,
    longitude: region.longitude,
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    timezone: 'auto',
  });
  const payload = await fetchJson(url);
  return {
    source: 'Open-Meteo',
    observedAt: payload.current?.time || null,
    temperatureC: payload.current?.temperature_2m ?? null,
    relativeHumidity: payload.current?.relative_humidity_2m ?? null,
    precipitationMm: payload.current?.precipitation ?? null,
    windSpeedKmh: payload.current?.wind_speed_10m ?? null,
    elevationM: payload.elevation ?? null,
  };
}

async function getClimateHistory(region) {
  const endYear = Math.max(2024, new Date().getFullYear() - 1);
  const url = new URL('https://power.larc.nasa.gov/api/temporal/monthly/point');
  url.search = new URLSearchParams({
    parameters: 'T2M,PRECTOTCORR',
    community: 'AG',
    longitude: region.longitude,
    latitude: region.latitude,
    start: '2020',
    end: String(endYear),
    format: 'JSON',
  });
  return summarizeClimate(await fetchJson(url));
}

async function getSatelliteObservation(region) {
  const now = new Date();
  const start = new Date(now.getFullYear() - 2, 0, 1).toISOString();
  const end = now.toISOString();
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox: region.bbox,
    datetime: `${start}/${end}`,
    limit: 2,
    query: { 'eo:cloud_cover': { lt: 20 } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  };
  const payload = await fetchJson('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const feature = payload.features?.[0];
  if (!feature) throw new Error('No Sentinel-2 observation returned');
  const previousFeature = payload.features?.[1] || null;
  const preview = feature.assets?.rendered_preview?.href || feature.assets?.thumbnail?.href || null;
  return {
    source: 'Sentinel-2 L2A / Microsoft Planetary Computer',
    collection: 'sentinel-2-l2a',
    observationId: feature.id,
    observedAt: feature.properties?.datetime || null,
    previousObservationId: previousFeature?.id || null,
    previousObservedAt: previousFeature?.properties?.datetime || null,
    observationCount: payload.features?.length || 1,
    cloudCover: feature.properties?.['eo:cloud_cover'] ?? null,
    platform: feature.properties?.platform || 'Sentinel-2',
    previewUrl: preview,
    bands: {
      red: feature.assets?.B04?.href || null,
      green: feature.assets?.B03?.href || null,
      nir: feature.assets?.B08?.href || null,
    },
    bbox: feature.bbox || region.bbox,
  };
}

function makeSource(id, label, result, url) {
  const ok = result.status === 'fulfilled';
  return {
    id,
    label,
    status: ok ? 'ok' : 'error',
    url,
    error: ok ? undefined : result.reason?.message || 'Source unavailable',
  };
}

async function loadOverview(region, forceRefresh = false) {
  const cacheKey = `overview:${region.id}`;
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return cached.payload;

  const weatherPromise = getCurrentWeather(region);
  const climatePromise = getClimateHistory(region);
  const imageryPromise = getSatelliteObservation(region);
  const [weatherResult, climateResult, imageryResult] = await Promise.allSettled([weatherPromise, climatePromise, imageryPromise]);
  const current = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
  const climate = climateResult.status === 'fulfilled' ? climateResult.value : null;
  const imagery = imageryResult.status === 'fulfilled' ? imageryResult.value : null;
  const sources = [
    makeSource('open-meteo', 'Open-Meteo current conditions', weatherResult, 'https://open-meteo.com/'),
    makeSource('nasa-power', 'NASA POWER climate history', climateResult, 'https://power.larc.nasa.gov/'),
    makeSource('sentinel-2', 'Sentinel-2 observation', imageryResult, 'https://planetarycomputer.microsoft.com/'),
  ];
  const payload = {
    ok: sources.some((source) => source.status === 'ok'),
    fetchedAt: new Date().toISOString(),
    region: { ...region, slug: regionSlug(region.name) },
    current,
    climate,
    imagery,
    landCover: imagery ? {
      status: 'processing_required',
      source: 'Sentinel-2 L2A',
      availableBands: imagery.bands,
      note: 'NDVI/NDWI and change metrics are intentionally not inferred in the client.',
    } : null,
    sources,
    caveats: [
      'Climate values are point observations or modeled point values, not land-cover measurements.',
      'Satellite links expose the latest low-cloud Sentinel-2 observation; vegetation and water indices require a processing pipeline such as Google Earth Engine.',
    ],
  };
  cache.set(cacheKey, { timestamp: Date.now(), payload });
  return payload;
}

export async function handleApi(req, res, next) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (!requestUrl.pathname.startsWith('/api')) {
    if (typeof next === 'function') return next();
    return;
  }
  if (req.method === 'OPTIONS') return sendOptions(res);

  try {
    if (requestUrl.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'green-city-ai-data', timestamp: new Date().toISOString() });
    }
    if (requestUrl.pathname === '/api/auth/google') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Use POST for Google verification' });
      const body = await readJsonBody(req);
      if (!body.credential) return sendJson(res, 400, { ok: false, error: 'credential is required' });
      const tokenInfo = await fetchJson(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(body.credential)}`);
      const expectedClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
      if (expectedClientId && tokenInfo.aud !== expectedClientId) return sendJson(res, 401, { ok: false, error: 'Google audience does not match this application' });
      if (!tokenInfo.sub || !tokenInfo.email_verified || tokenInfo.email_verified === 'false') return sendJson(res, 401, { ok: false, error: 'Google email is not verified' });
      return sendJson(res, 200, { ok: true, user: { id: tokenInfo.sub, name: tokenInfo.name || 'Green City learner', email: tokenInfo.email, picture: tokenInfo.picture || '', provider: 'google' } });
    }
    if (requestUrl.pathname === '/api/regions') {
      return sendJson(res, 200, { ok: true, regions: Object.values(REGIONS).map(({ id, name, area, latitude, longitude }) => ({ id, name, area, latitude, longitude })) });
    }
    const match = requestUrl.pathname.match(/^\/api\/regions\/([^/]+)\/(overview|timeseries)$/);
    if (!match) return sendJson(res, 404, { ok: false, error: 'Route not found' });
    const region = getRegion(match[1]);
    if (!region) return sendJson(res, 404, { ok: false, error: 'Region not found' });
    const payload = await loadOverview(region, requestUrl.searchParams.get('refresh') === '1');
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendJson(res, 502, { ok: false, error: 'Environmental data service unavailable', detail: error.message });
  }
}

export { REGIONS };
