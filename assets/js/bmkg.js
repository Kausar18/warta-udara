// Peringatan Dini Cuaca BMKG.
// RSS BMKG tidak mengirim header CORS untuk permintaan dari browser, sehingga GitHub Actions
// menyalinnya setiap 15 menit ke data/bmkg-nowcast.json (lihat scripts/fetch-bmkg.mjs).

import { fetchJSON } from './api.js';
import { matchAlert, isActive, normName, MATCH_RANK } from './bmkg-parse.js';

const FEED_URL = 'data/bmkg-nowcast.json';
const TTL_MS = 5 * 60e3;

export const BMKG_PORTAL = 'https://nowcasting.bmkg.go.id/';
export const STALE_AFTER_MS = 2 * 3600e3;
export const SEVERITY = { Minor: 'Ringan', Moderate: 'Sedang', Severe: 'Berat', Extreme: 'Ekstrem' };

let cache = null;
let inflight = null;

/** → { alerts, fetchedAt } — fetchedAt = waktu terakhir BMKG diperiksa oleh GitHub Actions. */
export function loadNowcast({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return Promise.resolve(cache);
  inflight ??= fetchJSON(FEED_URL, { bust: true })
    .then((feed) => {
      const fetchedAt = Date.parse(feed.checkedAt ?? feed.generatedAt ?? '');
      if (!Array.isArray(feed.alerts) || !Number.isFinite(fetchedAt)) throw new Error('Data peringatan BMKG belum tersedia.');
      cache = { alerts: feed.alerts, fetchedAt, loadedAt: Date.now() };
      return cache;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export const activeAlerts = (nowcast, now = Date.now()) => nowcast.alerts.filter((a) => isActive(a, now));

/** Peringatan aktif yang relevan untuk sebuah tempat, diurutkan dari yang paling dekat/tepat. */
export function alertsFor(nowcast, place) {
  return activeAlerts(nowcast)
    .map((alert) => ({ alert, match: matchAlert(alert, place) }))
    .filter((x) => x.match)
    .sort((a, b) => MATCH_RANK[a.match.level] - MATCH_RANK[b.match.level]
      || (a.match.distanceKm ?? 1e9) - (b.match.distanceKm ?? 1e9));
}

export const sameDistrict = (a, b) => Boolean(a && b) && normName(a) === normName(b);

/** "BANGKO  BARAT" → "Bangko Barat", angka Romawi tetap kapital ("XIII Koto Kampar"). */
export function districtLabel(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim()
    .split(' ')
    .map((w) => (/^[ivxlc]+$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
