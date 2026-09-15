// World Air Quality Index Project (aqicn.org) — AQI hasil pengukuran stasiun terdekat.
// Token gratis: https://aqicn.org/data-platform/token — disimpan di config.json (waqi.token).

import { fetchJSON } from './api.js';

const FEED = 'https://api.waqi.info/feed';

// Kode polutan WAQI → kunci internal (sama dengan Open-Meteo).
const POLLUTANT = {
  pm25: 'pm2_5', pm10: 'pm10', o3: 'ozone', no2: 'nitrogen_dioxide', so2: 'sulphur_dioxide', co: 'carbon_monoxide',
};

export function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Stasiun terdekat dari koordinat.
 * → { aqi, main, name, url, lat, lon, distanceKm, ts, iaqi, attributions }
 * `iaqi` berisi sub-indeks AQI per polutan (bukan konsentrasi µg/m³).
 */
export async function getStation(lat, lon, token) {
  const res = await fetchJSON(`${FEED}/geo:${lat};${lon}/?token=${encodeURIComponent(token)}`, { timeout: 12000 });
  if (res.status !== 'ok') {
    const msg = String(res.data ?? 'kesalahan tidak diketahui');
    throw new Error(/invalid key/i.test(msg) ? 'Token WAQI tidak valid — periksa config.json.' : `WAQI: ${msg}`);
  }
  const d = res.data;
  const aqi = Number(d.aqi);
  const [slat, slon] = d.city?.geo ?? [];
  const iso = d.time?.iso ?? (d.time?.s ? `${d.time.s.replace(' ', 'T')}${d.time.tz ?? 'Z'}` : '');
  const ts = Date.parse(iso);
  return {
    aqi: Number.isFinite(aqi) ? Math.round(aqi) : null,
    main: POLLUTANT[d.dominentpol] ?? null,
    name: String(d.city?.name ?? 'Stasiun').trim(),
    url: d.city?.url ?? 'https://aqicn.org/',
    lat: slat,
    lon: slon,
    distanceKm: Number.isFinite(slat) && Number.isFinite(slon) ? distanceKm(lat, lon, slat, slon) : null,
    ts: Number.isFinite(ts) ? ts : null,
    iaqi: Object.fromEntries(Object.entries(POLLUTANT).map(([code, key]) => [key, d.iaqi?.[code]?.v ?? null])),
    attributions: (d.attributions ?? []).map((a) => ({ name: a.name, url: a.url })),
  };
}
