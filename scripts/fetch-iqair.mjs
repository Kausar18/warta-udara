#!/usr/bin/env node
/**
 * Mengambil data kualitas udara dari IQAir AirVisual API untuk setiap lokasi di config.json,
 * lalu menulis data/latest.json dan menambahkan catatan ke data/history.json.
 *
 * Dijalankan setiap jam oleh GitHub Actions (.github/workflows/update-air-quality.yml).
 * Lokal:  IQAIR_API_KEY=xxxx node scripts/fetch-iqair.mjs   (atau `npm run fetch` dengan berkas .env)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const API = 'https://api.airvisual.com/v2';
const KEY = process.env.IQAIR_API_KEY?.trim();

const RETENTION_DAYS = 30;
const MIN_GAP_MS = 12_500; // Paket Community: maks. 5 panggilan per menit
const FIELDS = ['ts', 'aqius', 'mainus', 'tp', 'hu'];
const FATAL = new Set(['incorrect_api_key', 'api_key_expired', 'permission_denied', 'feature_not_available', 'Forbidden', 'http_401', 'http_403']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

class IQAirError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function iqair(endpoint, params, attempt = 1) {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();

  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) url.searchParams.set(k, String(v));

  let res;
  let body = null;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    body = await res.json().catch(() => null);
  } catch (err) {
    if (attempt < 3) {
      console.warn(`  jaringan bermasalah (${err.message}), mencoba lagi…`);
      await sleep(5_000 * attempt);
      return iqair(endpoint, params, attempt + 1);
    }
    throw new IQAirError(`${endpoint}: ${err.message}`, 'network');
  }

  if (res.ok && body?.status === 'success') return body.data;

  const code = body?.data?.message ?? `http_${res.status}`;
  if ((res.status === 429 || code === 'call_limit_reached' || code === 'too_many_requests') && attempt < 3) {
    console.warn('  batas panggilan tercapai, menunggu 65 detik…');
    await sleep(65_000);
    return iqair(endpoint, params, attempt + 1);
  }
  throw new IQAirError(`${endpoint}: ${code}`, code);
}

async function fetchLocation(loc) {
  const q = loc.iqair;
  if (q?.city && q?.state && q?.country) {
    try {
      return { data: await iqair('city', { city: q.city, state: q.state, country: q.country }), endpoint: 'city' };
    } catch (err) {
      if (FATAL.has(err.code)) throw err;
      console.warn(`  ${err.message} → beralih ke stasiun terdekat (nearest_city)`);
    }
  }
  return { data: await iqair('nearest_city', { lat: loc.lat, lon: loc.lon }), endpoint: 'nearest_city' };
}

function normalize(loc, data, endpoint, fetchedAt) {
  const p = data.current?.pollution;
  const w = data.current?.weather;
  if (!p || p.aqius == null) throw new IQAirError('respons tanpa data polusi', 'no_pollution');
  return {
    id: loc.id,
    name: loc.name,
    endpoint,
    station: {
      city: data.city,
      state: data.state,
      country: data.country,
      coordinates: data.location?.coordinates ?? null, // [lon, lat]
    },
    pollution: { ts: p.ts, aqius: p.aqius, mainus: p.mainus, aqicn: p.aqicn, maincn: p.maincn },
    weather: w ? { ts: w.ts, tp: w.tp, pr: w.pr, hu: w.hu, ws: w.ws, wd: w.wd, ic: w.ic } : null,
    fetchedAt,
  };
}

async function readJSON(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function appendHistory(history, entry) {
  const rows = history.series[entry.id] ?? [];
  const row = [entry.pollution.ts, entry.pollution.aqius, entry.pollution.mainus, entry.weather?.tp ?? null, entry.weather?.hu ?? null];
  const i = rows.findIndex((r) => r[0] === row[0]);
  if (i >= 0) rows[i] = row; else rows.push(row);

  const cutoff = Date.now() - RETENTION_DAYS * 864e5;
  history.series[entry.id] = rows
    .filter((r) => Date.parse(r[0]) >= cutoff)
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]));
}

// Satu baris per catatan agar diff git tetap ringkas.
function serializeHistory(h) {
  const series = Object.entries(h.series)
    .map(([id, rows]) => `    ${JSON.stringify(id)}: [${rows.length ? `\n${rows.map((r) => `      ${JSON.stringify(r)}`).join(',\n')}\n    ` : ''}]`)
    .join(',\n');
  return `{\n  "generatedAt": ${JSON.stringify(h.generatedAt)},\n  "retentionDays": ${RETENTION_DAYS},\n  "fields": ${JSON.stringify(FIELDS)},\n  "series": {${series ? `\n${series}\n  ` : ''}}\n}\n`;
}

async function main() {
  if (!KEY) {
    console.error('✗ IQAIR_API_KEY belum diatur. Tambahkan sebagai repository secret (lihat README).');
    process.exit(1);
  }

  const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
  const latest = await readJSON('latest.json', {});
  const history = await readJSON('history.json', {});
  latest.locations ??= {};
  history.series ??= {};

  const now = new Date().toISOString();
  const errors = [];
  let ok = 0;

  for (const loc of config.locations) {
    console.log(`→ ${loc.name}`);
    try {
      const { data, endpoint } = await fetchLocation(loc);
      const entry = normalize(loc, data, endpoint, now);
      latest.locations[loc.id] = entry;
      appendHistory(history, entry);
      ok++;
      console.log(`  AQI US ${entry.pollution.aqius} (${entry.pollution.mainus}) · stasiun ${data.city}, ${data.state} · ${entry.pollution.ts}`);
    } catch (err) {
      if (FATAL.has(err.code)) {
        console.error(`✗ Kunci API ditolak (${err.code}). Periksa secret IQAIR_API_KEY.`);
        process.exit(1);
      }
      console.error(`  ✗ ${err.message}`);
      errors.push({ id: loc.id, message: err.message, at: now });
    }
  }

  // Buang lokasi yang sudah dihapus dari config.json
  const ids = new Set(config.locations.map((l) => l.id));
  for (const id of Object.keys(latest.locations)) if (!ids.has(id)) delete latest.locations[id];
  for (const id of Object.keys(history.series)) if (!ids.has(id)) delete history.series[id];

  if (ok === 0) {
    console.error('✗ Tidak ada lokasi yang berhasil diambil; berkas data tidak diubah.');
    process.exit(1);
  }

  await mkdir(DATA_DIR, { recursive: true });
  const out = {
    source: 'IQAir AirVisual API',
    attribution: 'Data kualitas udara © IQAir (www.iqair.com)',
    generatedAt: now,
    locations: latest.locations,
    errors,
  };
  await writeFile(path.join(DATA_DIR, 'latest.json'), `${JSON.stringify(out, null, 2)}\n`);
  await writeFile(path.join(DATA_DIR, 'history.json'), serializeHistory({ generatedAt: now, series: history.series }));
  console.log(`✓ ${ok}/${config.locations.length} lokasi diperbarui.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
