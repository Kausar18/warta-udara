// Reverse geocoding OpenStreetMap Nominatim → desa, kecamatan, kota/kabupaten, provinsi.
// Kebijakan Nominatim: maks. 1 permintaan/detik & hasil wajib di-cache — keduanya dipatuhi di sini.

import { fetchJSON } from './api.js';

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const CACHE_KEY = 'wu:geo:v1';
const CACHE_TTL = 30 * 864e5;
const MIN_GAP_MS = 1100;

// Kode ISO 3166-2 selalu ada di respons Nominatim, sedangkan field `state` kadang kosong (mis. Jakarta).
const ISO_PROVINCE = {
  'ID-AC': 'Aceh', 'ID-SU': 'Sumatera Utara', 'ID-SB': 'Sumatera Barat', 'ID-RI': 'Riau', 'ID-JA': 'Jambi',
  'ID-SS': 'Sumatera Selatan', 'ID-BE': 'Bengkulu', 'ID-LA': 'Lampung', 'ID-BB': 'Kepulauan Bangka Belitung',
  'ID-KR': 'Kepulauan Riau', 'ID-JK': 'DKI Jakarta', 'ID-JB': 'Jawa Barat', 'ID-JT': 'Jawa Tengah',
  'ID-YO': 'DI Yogyakarta', 'ID-JI': 'Jawa Timur', 'ID-BT': 'Banten', 'ID-BA': 'Bali',
  'ID-NB': 'Nusa Tenggara Barat', 'ID-NT': 'Nusa Tenggara Timur', 'ID-KB': 'Kalimantan Barat',
  'ID-KT': 'Kalimantan Tengah', 'ID-KS': 'Kalimantan Selatan', 'ID-KI': 'Kalimantan Timur',
  'ID-KU': 'Kalimantan Utara', 'ID-SA': 'Sulawesi Utara', 'ID-ST': 'Sulawesi Tengah',
  'ID-SN': 'Sulawesi Selatan', 'ID-SG': 'Sulawesi Tenggara', 'ID-GO': 'Gorontalo', 'ID-SR': 'Sulawesi Barat',
  'ID-MA': 'Maluku', 'ID-MU': 'Maluku Utara', 'ID-PA': 'Papua', 'ID-PB': 'Papua Barat',
  'ID-PD': 'Papua Barat Daya', 'ID-PT': 'Papua Tengah', 'ID-PS': 'Papua Selatan', 'ID-PE': 'Papua Pegunungan',
};

const memory = new Map();
let queue = Promise.resolve();
let lastCall = 0;

function readStore() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; } catch { return {}; }
}
function writeStore(key, value) {
  try {
    const all = readStore();
    all[key] = { at: Date.now(), value };
    const keys = Object.keys(all);
    if (keys.length > 60) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 60).forEach((k) => delete all[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* penyimpanan tidak tersedia */ }
}

function throttled(task) {
  const run = queue.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

function toPlace(r) {
  const a = r.address ?? {};
  const provinsi = ISO_PROVINCE[a['ISO3166-2-lvl4']] ?? a.state ?? null;
  const kabupaten = a.city ?? a.county ?? a.regency ?? a.town ?? a.municipality ?? null;
  const desa = a.village ?? a.neighbourhood ?? a.quarter ?? a.hamlet ?? null;
  let kecamatan = a.city_district ?? a.suburb ?? a.district ?? null;

  // Kadang kecamatan hanya muncul di display_name, tepat sebelum nama kota/kabupaten.
  if (!kecamatan && kabupaten && r.display_name) {
    const parts = r.display_name.split(',').map((s) => s.trim());
    const idx = parts.indexOf(kabupaten);
    const candidate = idx > 0 ? parts[idx - 1] : null;
    const known = new Set(Object.values(a));
    if (candidate && !known.has(candidate) && !/^\d+$/.test(candidate) && !/^(RT|RW)\b/i.test(candidate)) kecamatan = candidate;
  }
  if (kecamatan && kecamatan === kabupaten) kecamatan = null;

  return { desa, kecamatan, kabupaten, provinsi, displayName: r.display_name ?? null };
}

/** { desa, kecamatan, kabupaten, provinsi, displayName } — field bisa null bila tidak ada di OSM. */
export async function reversePlace(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (memory.has(key)) return memory.get(key);
  const stored = readStore()[key];
  if (stored && Date.now() - stored.at < CACHE_TTL) {
    memory.set(key, stored.value);
    return stored.value;
  }
  const params = new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: 14, addressdetails: 1, 'accept-language': 'id' });
  const r = await throttled(() => fetchJSON(`${NOMINATIM}?${params}`, { timeout: 10000 }));
  if (r.error) throw new Error(`Nominatim: ${r.error}`);
  const place = toPlace(r);
  memory.set(key, place);
  writeStore(key, place);
  return place;
}
