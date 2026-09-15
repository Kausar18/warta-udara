// Klien data: berkas JSON lokal dan API publik Open-Meteo (kualitas udara, cuaca, pencarian kota).

const TIMEOUT_MS = 15000;
const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WX_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

const SUB_INDICES = ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide'].map((k) => `us_aqi_${k}`);

export async function fetchJSON(url, { bust = false, timeout = TIMEOUT_MS } = {}) {
  const target = bust ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}` : url;
  const res = await fetch(target, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Permintaan gagal (HTTP ${res.status})`);
  return res.json();
}

const query = (params) => new URLSearchParams(params).toString();

/**
 * Open-Meteo Air Quality API (model Copernicus CAMS global).
 * AQI US dihitung Open-Meteo sesuai EPA: rata-rata 24 jam untuk PM, 8 jam untuk O₃ & CO.
 * Kondisi terkini + per jam 7 hari lalu (arsip) s.d. 5 hari ke depan (prakiraan).
 */
export function getAirQuality(lat, lon) {
  return fetchJSON(`${AQ_URL}?${query({
    latitude: lat,
    longitude: lon,
    current: ['us_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide', 'uv_index', ...SUB_INDICES].join(','),
    hourly: 'us_aqi,pm2_5,pm10',
    past_days: 7,
    forecast_days: 5,
    timezone: 'auto',
  })}`);
}

export function getWeather(lat, lon) {
  return fetchJSON(`${WX_URL}?${query({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day',
    timezone: 'auto',
  })}`);
}

/** AQI terkini untuk banyak koordinat sekaligus (satu permintaan). */
export async function getCurrentAqiMany(locations) {
  if (!locations.length) return [];
  const res = await fetchJSON(`${AQ_URL}?${query({
    latitude: locations.map((l) => l.lat).join(','),
    longitude: locations.map((l) => l.lon).join(','),
    current: ['us_aqi', ...SUB_INDICES].join(','),
    timezone: 'auto',
  })}`);
  return Array.isArray(res) ? res : [res];
}

/** Pencarian kota saat mengetik (Nominatim melarang autocomplete, jadi memakai Open-Meteo Geocoding). */
export async function searchPlaces(name) {
  const res = await fetchJSON(`${GEO_URL}?${query({ name, count: 6, language: 'id', format: 'json' })}`);
  return res.results ?? [];
}
