import { fetchJSON, getAirQuality, getWeather, getCurrentAqiMany, searchPlaces } from './api.js';
import { getStation, distanceKm } from './waqi.js';
import { reversePlace } from './geo.js';
import { loadNowcast, alertsFor, activeAlerts, sameDistrict, districtLabel, SEVERITY, BMKG_PORTAL, STALE_AFTER_MS } from './bmkg.js';
import {
  LEVELS, levelFor, scalePosition, POLLUTANTS, POLLUTANT_ORDER, IQAIR_MAIN, TIPS,
  dominantPollutant, iqairWeather, wmoWeather, compass, uvLabel,
} from './aqi.js';
import { forecastChart, historyChart } from './charts.js';
import { icon } from './icons.js';
import * as f from './format.js';

const HOUR = 3600e3;
const STATION_STALE_MS = 3 * HOUR; // data stasiun lebih tua dari ini tidak dipakai sebagai angka utama
const REFRESH_MS = 10 * 60e3;
const esc = f.esc;
const $ = (sel) => document.querySelector(sel);

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* penyimpanan tidak tersedia */ } },
};

const state = {
  config: null,
  latest: null, // IQAir opsional (GitHub Actions)
  history: null,
  location: null,
  snap: null,
  place: null, // Nominatim
  nowcast: null, // BMKG
  nowcastError: null,
  league: [],
  loadedAt: 0,
};

let requestId = 0;
const charts = new Map();

function setChart(key, dispose) {
  charts.get(key)?.();
  if (dispose) charts.set(key, dispose); else charts.delete(key);
}

const placeKey = (loc) => `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//.test(u) ? esc(u) : null);
const km = (d) => `±${f.num(d, d < 10 ? 1 : 0)} km`;
const waqiToken = () => String(state.config?.waqi?.token ?? '').trim();
const maxStationKm = () => Number(state.config?.waqi?.maxDistanceKm) || 15;
const tzOf = () => state.snap?.tz ?? state.config?.site?.timezone ?? 'Asia/Jakarta';
const cardHead = (ic, title, src = '') => `<div class="card__head"><h2 class="card__title">${icon(ic, 18)}${title}</h2>${src ? `<span class="card__src">${src}</span>` : ''}</div>`;
const emptyState = (message, ic = 'info') => `<div class="empty">${icon(ic, 22)}<p>${message}</p></div>`;

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

async function loadStationData() {
  const [latest, history] = await Promise.allSettled([
    fetchJSON('data/latest.json', { bust: true }),
    fetchJSON('data/history.json', { bust: true }),
  ]);
  state.latest = latest.status === 'fulfilled' ? latest.value : state.latest;
  state.history = history.status === 'fulfilled' ? history.value : state.history;
}

// Open-Meteo mengembalikan waktu lokal tanpa offset ("2026-09-15T10:00").
function localToEpoch(str, offsetSec) {
  const [date, clock = '00:00'] = str.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = clock.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - offsetSec * 1000;
}

function lastAtOrBefore(points, ts) {
  let found = null;
  for (const p of points) { if (p.ts <= ts) found = p; else break; }
  return found;
}

function iqairFreshness(iq) {
  const ts = iq?.pollution?.ts ? Date.parse(iq.pollution.ts) : null;
  return { ts, fresh: ts != null && Date.now() - ts < STATION_STALE_MS && iq.pollution.aqius != null };
}

/** Apakah stasiun WAQI layak dipakai sebagai angka utama? */
function judgeStation(st) {
  if (!st) return { ok: false, reason: null };
  if (st.aqi == null) return { ok: false, reason: `Stasiun terdekat (${st.name}) sedang tidak mengirim data.` };
  if (st.distanceKm != null && st.distanceKm > maxStationKm()) {
    return { ok: false, reason: `Stasiun terdekat (${st.name}) berjarak ${km(st.distanceKm)} — terlalu jauh untuk mewakili lokasi ini.` };
  }
  if (st.ts == null || Date.now() - st.ts > STATION_STALE_MS) {
    return { ok: false, reason: `Data stasiun terdekat (${st.name}) terakhir masuk ${st.ts ? f.ago(st.ts) : 'pada waktu yang tidak diketahui'}.` };
  }
  return { ok: true, reason: null };
}

function buildSnapshot(loc, aq, wx, iq, station, stationError) {
  const now = Date.now();
  const tz = aq?.timezone ?? wx?.timezone ?? state.config.site.timezone;
  const offset = aq?.utc_offset_seconds ?? 0;

  const hourly = aq?.hourly
    ? aq.hourly.time
      .map((t, i) => ({ ts: localToEpoch(t, offset), aqi: aq.hourly.us_aqi[i], pm25: aq.hourly.pm2_5[i], pm10: aq.hourly.pm10[i] }))
      .filter((p) => p.aqi != null)
    : [];
  const c = aq?.current ?? null;
  const pollutants = c
    ? Object.fromEntries(POLLUTANT_ORDER.map((k) => [k, { value: c[k] ?? null, aqi: c[`us_aqi_${k}`] ?? null }]))
    : null;
  const nowPoint = lastAtOrBefore(hourly, now);
  const modelAqi = c?.us_aqi ?? nowPoint?.aqi ?? null;
  const modelMain = dominantPollutant(c) ?? 'pm2_5';

  const notes = [];
  let primary = null;

  // 1) Stasiun WAQI terdekat
  const verdict = judgeStation(station);
  if (verdict.ok) {
    primary = {
      source: 'waqi', aqi: station.aqi, main: station.main ?? modelMain, ts: station.ts,
      station: { name: station.name, distanceKm: station.distanceKm, url: station.url, attributions: station.attributions, iaqi: station.iaqi },
    };
  } else if (verdict.reason) notes.push(verdict.reason);
  else if (stationError) notes.push(stationError);

  // 2) Stasiun IQAir (opsional, lewat GitHub Actions)
  const { ts: iqTs, fresh: iqFresh } = iqairFreshness(iq);
  if (!primary && iqFresh) {
    const [slon, slat] = iq.station?.coordinates ?? [];
    primary = {
      source: 'iqair', aqi: iq.pollution.aqius, main: IQAIR_MAIN[iq.pollution.mainus] ?? modelMain, ts: iqTs,
      station: {
        name: iq.station?.city ?? loc.name,
        distanceKm: Number.isFinite(slat) ? distanceKm(loc.lat, loc.lon, slat, slon) : null,
        url: 'https://www.iqair.com/', attributions: [], iaqi: null,
      },
    };
  }

  // 3) Model Open-Meteo
  if (!primary && modelAqi != null) {
    primary = { source: 'model', aqi: modelAqi, main: modelMain, ts: c ? localToEpoch(c.time, offset) : nowPoint.ts, station: null };
  }
  if (!primary) throw new Error('Data kualitas udara untuk lokasi ini belum tersedia.');

  let weather = null;
  if (wx?.current) {
    const w = wx.current;
    weather = {
      temp: w.temperature_2m, feels: w.apparent_temperature, hum: w.relative_humidity_2m,
      wind: w.wind_speed_10m, windDir: w.wind_direction_10m, pressure: w.surface_pressure,
      label: wmoWeather(w.weather_code), isDay: w.is_day,
    };
  } else if (iqFresh && iq.weather) {
    const w = iq.weather;
    weather = {
      temp: w.tp, feels: null, hum: w.hu, wind: w.ws != null ? w.ws * 3.6 : null,
      windDir: w.wd, pressure: w.pr, label: iqairWeather(w.ic), isDay: null,
    };
  }

  return { loc, tz, now, hourly, nowPoint, pollutants, primary, notes, weather, uv: c?.uv_index ?? null };
}

async function selectLocation(loc, { save = true, quiet = false } = {}) {
  const id = ++requestId;
  state.location = loc;
  if (save) {
    store.set('wu:location', loc.id
      ? { id: loc.id }
      : { name: loc.name, region: loc.region, province: loc.province ?? null, lat: loc.lat, lon: loc.lon });
  }
  renderPills();
  renderPlaceLine();
  setLoading(!quiet);
  if (!quiet) renderWarnings();

  const context = loadContext(loc, id);
  const token = waqiToken();
  const iq = loc.id ? state.latest?.locations?.[loc.id] ?? null : null;
  const [aq, wx, st] = await Promise.all([
    getAirQuality(loc.lat, loc.lon).catch((err) => { console.warn('Open-Meteo AQ:', err); return null; }),
    getWeather(loc.lat, loc.lon).catch(() => null),
    token ? getStation(loc.lat, loc.lon, token).then((v) => ({ v }), (e) => ({ e })) : Promise.resolve({}),
  ]);
  if (id !== requestId) return;
  if (st.e) console.warn('WAQI:', st.e);

  try {
    const snap = buildSnapshot(loc, aq, wx, iq, st.v ?? null, st.e?.message ?? null);
    state.snap = snap;
    state.loadedAt = Date.now();
    renderAll(snap, { animate: !quiet });
  } catch (err) {
    renderError(aq ? err : new Error('Tidak dapat terhubung ke layanan data. Periksa koneksi internet Anda.'));
  } finally {
    setLoading(false);
  }
  await context;
}

/** Nominatim (wilayah) + BMKG (peringatan) dimuat paralel tanpa menahan data udara. */
async function loadContext(loc, id) {
  const [place, nowcast] = await Promise.allSettled([reversePlace(loc.lat, loc.lon), loadNowcast()]);
  if (id !== requestId) return;
  state.place = {
    key: placeKey(loc),
    geocoded: place.status === 'fulfilled',
    ...(place.status === 'fulfilled' ? place.value : { desa: null, kecamatan: null, kabupaten: null, provinsi: null }),
  };
  if (place.status === 'rejected') console.warn('Nominatim:', place.reason);
  if (nowcast.status === 'fulfilled') {
    state.nowcast = nowcast.value;
    state.nowcastError = null;
  } else {
    state.nowcastError = nowcast.reason;
    console.warn('BMKG:', nowcast.reason);
  }
  renderPlaceLine();
  renderWarnings();
}

async function loadLeague() {
  const locs = state.config.locations;
  const token = waqiToken();
  const [model, stations] = await Promise.all([
    getCurrentAqiMany(locs).catch(() => []),
    token ? Promise.all(locs.map((l) => getStation(l.lat, l.lon, token).catch(() => null))) : Promise.resolve([]),
  ]);
  state.league = locs.map((loc, i) => {
    const st = stations[i];
    if (judgeStation(st).ok) return { loc, aqi: st.aqi, main: st.main, source: 'Stasiun', detail: st.name };
    const iq = state.latest?.locations?.[loc.id];
    if (iqairFreshness(iq).fresh) return { loc, aqi: iq.pollution.aqius, main: IQAIR_MAIN[iq.pollution.mainus], source: 'Stasiun', detail: 'IQAir' };
    const c = model[i]?.current;
    if (c?.us_aqi != null) return { loc, aqi: c.us_aqi, main: dominantPollutant(c), source: 'Model', detail: 'Open-Meteo' };
    return { loc, aqi: null, main: null, source: '—', detail: '' };
  });
  renderLeague();
}

async function refresh() {
  await loadStationData();
  if (state.location) await selectLocation(state.location, { save: false, quiet: true });
  loadLeague();
}

/* ------------------------------------------------------------------ */
/* Peringatan dini: pencocokan untuk lokasi aktif                       */
/* ------------------------------------------------------------------ */

function currentWarnings() {
  const loc = state.location;
  if (!loc || !state.nowcast || state.place?.key !== placeKey(loc)) return null;
  const p = state.place;
  const provinsi = p.provinsi ?? loc.province ?? (loc.id ? loc.region : null);
  const matches = alertsFor(state.nowcast, { lat: loc.lat, lon: loc.lon, kecamatan: p.kecamatan, kabupaten: p.kabupaten, provinsi });
  const local = matches.filter((m) => m.match.level !== 'province');
  const covering = local.filter((m) => m.match.level === 'inside' || m.match.level === 'district').length;
  const checkedAt = state.nowcast.fetchedAt;
  return {
    place: p,
    provinsi,
    local,
    regional: matches.filter((m) => m.match.level === 'province'),
    covering,
    top: local[0] ?? null,
    status: covering ? 'alert' : local.length ? 'near' : 'clear',
    where: p.kecamatan ? `Kec. ${p.kecamatan}` : loc.name,
    checkedAt,
    stale: Date.now() - checkedAt > STALE_AFTER_MS,
  };
}

function placeLabel(loc, p) {
  if (!p) return loc.region ? `${loc.name}, ${loc.region}` : loc.name;
  const parts = [p.kecamatan && `Kec. ${p.kecamatan}`, p.kabupaten ?? loc.name, p.provinsi ?? loc.province ?? (loc.id ? loc.region : null)];
  return [...new Set(parts.filter(Boolean))].join(', ');
}

/* ------------------------------------------------------------------ */
/* Render: ringkasan                                                    */
/* ------------------------------------------------------------------ */

function setLoading(on) {
  $('#konten').classList.toggle('is-loading', on);
  $('#progress').hidden = !on;
}

function renderAll(s, { animate }) {
  const lvl = levelFor(s.primary.aqi);
  document.body.dataset.level = lvl.n;
  document.title = `AQI ${s.primary.aqi} · ${s.loc.name} — Warta Udara`;
  const chip = $('#topAqi');
  chip.hidden = false;
  chip.className = `chip top-aqi lv-${lvl.n}`;
  chip.textContent = `AQI ${s.primary.aqi}`;

  renderPlaceLine();
  renderAqiCard(s, lvl, animate);
  renderWeatherCard(s);
  renderTipsCard(lvl);
  render24h(s);
  renderPollutants(s);
  renderWarnings();
  renderForecast(s);
  renderHealth(s, lvl);
  renderArchive(s);
  renderLeague();
  renderAbout();
}

function renderPills() {
  const cur = state.location;
  const pills = state.config.locations.map((l) => {
    const active = cur?.id === l.id;
    return `<button type="button" class="pill${active ? ' is-active' : ''}" data-id="${esc(l.id)}" aria-pressed="${active}">${esc(l.name)}</button>`;
  });
  if (cur && !cur.id) pills.push(`<button type="button" class="pill is-active" aria-pressed="true">${icon('pin', 15)}${esc(cur.name)}</button>`);
  $('#pills').innerHTML = pills.join('');
}

function renderPlaceLine() {
  const loc = state.location;
  if (!loc) return;
  const p = state.place?.key === placeKey(loc) ? state.place : null;
  const tz = tzOf();
  const meta = [placeLabel(loc, p)];
  if (state.snap?.loc === loc) meta.push(`Diperbarui ${f.time(state.loadedAt, tz)} ${f.tzName(state.loadedAt, tz)}`);
  $('#placeTitle').textContent = loc.name;
  $('#placeMeta').innerHTML = `${icon('pin', 15)}<span>${esc(meta.join(' · '))}</span>`;
}

function sourceInfo(p) {
  if (p.source === 'waqi') {
    return {
      kind: 'station', ic: 'radio',
      title: `Stasiun ${p.station.name}`,
      sub: `${p.station.distanceKm != null ? `${km(p.station.distanceKm)} dari titik pantau · ` : ''}WAQI`,
      url: p.station.url,
    };
  }
  if (p.source === 'iqair') {
    return {
      kind: 'station', ic: 'radio',
      title: `Stasiun IQAir ${p.station.name}`,
      sub: `${p.station.distanceKm != null ? `${km(p.station.distanceKm)} dari titik pantau · ` : ''}IQAir`,
      url: p.station.url,
    };
  }
  return {
    kind: 'model', ic: 'layers',
    title: 'Estimasi model atmosfer',
    sub: 'Open-Meteo · Copernicus CAMS (±40 km)',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
  };
}

function animateCount(el, to) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / 800);
    el.textContent = Math.round(to * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderAqiCard(s, lvl, animate) {
  const { primary: p, tz } = s;
  const src = sourceInfo(p);
  const card = $('#aqiCard');
  card.className = `card b-aqi lv-${lvl.n}`;
  card.innerHTML = `
    <div class="aqi__head">
      <div class="aqi__row">
        <span class="eyebrow">Indeks kualitas udara</span>
        <span class="live">${p.source === 'model' ? `${icon('layers', 12)}Estimasi` : '<i></i>Terukur'}</span>
      </div>
      <div class="aqi__value"><span class="aqi__num" id="aqiNum">${p.aqi}</span><span class="aqi__unit">AQI<br>US</span></div>
      <p class="aqi__label">${lvl.label}</p>
    </div>
    <div class="aqi__body">
      <p class="aqi__advice">${lvl.advice}</p>
      <div>
        <div class="scale" aria-hidden="true">
          ${LEVELS.map((l) => `<span class="lv-${l.n}"></span>`).join('')}
          <i class="scale__marker" style="left:${(scalePosition(p.aqi) * 100).toFixed(2)}%"></i>
        </div>
        <div class="scale__ticks" aria-hidden="true"><span>0</span><span>50</span><span>100</span><span>150</span><span>200</span><span>300</span><span>500</span></div>
      </div>
      <dl class="facts">
        <div><dt>Polutan utama</dt><dd>${POLLUTANTS[p.main].html}</dd></div>
        <div><dt>Waktu data</dt><dd>${f.time(p.ts, tz)} ${f.tzName(p.ts, tz)}</dd></div>
      </dl>
      <a class="source source--${src.kind}" href="${safeUrl(src.url) ?? '#tentang'}" target="_blank" rel="noopener">
        ${icon(src.ic, 20)}
        <span class="source__text"><b>${esc(src.title)}</b><small>${esc(src.sub)}</small></span>
        ${icon('external', 14)}
      </a>
      ${s.notes.length ? `<p class="note-line">${icon('info', 14)}<span>${esc(s.notes[0])}${p.source === 'model' ? ' Angka di atas memakai estimasi model.' : ''}</span></p>` : ''}
    </div>`;
  if (animate) animateCount($('#aqiNum'), p.aqi);
}

function renderWeatherCard(s) {
  const el = $('#wxCard');
  const w = s.weather;
  if (!w) { el.innerHTML = `${cardHead('cloud', 'Cuaca sekarang')}<p class="muted">Data cuaca tidak tersedia.</p>`; return; }
  el.innerHTML = `
    ${cardHead(w.isDay === 0 ? 'moon' : 'sun', 'Cuaca sekarang', 'Open-Meteo')}
    <div class="wx__main">
      <span class="wx__temp">${f.num(w.temp)}°</span>
      <div><p class="wx__label">${esc(w.label)}</p><p class="wx__feels">${w.feels != null ? `Terasa ${f.num(w.feels)}°C` : '&nbsp;'}</p></div>
    </div>
    <dl class="wx__grid">
      <div><dt>${icon('droplet', 13)}Kelembapan</dt><dd>${f.num(w.hum)}%</dd></div>
      <div><dt>${icon('wind', 13)}Angin</dt><dd>${f.num(w.wind)} <small>km/j</small>${w.windDir != null ? `<span class="wind-dir" style="--deg:${w.windDir}deg" title="Angin dari ${compass(w.windDir)}">${icon('arrowUp', 13)}</span>` : ''}</dd></div>
      <div><dt>${icon('sun', 13)}Indeks UV</dt><dd>${f.num(s.uv, 1)} <small>${uvLabel(s.uv)}</small></dd></div>
      <div><dt>${icon('gauge', 13)}Tekanan</dt><dd>${f.num(w.pressure)} <small>hPa</small></dd></div>
    </dl>`;
}

function renderTipsCard(lvl) {
  const i = lvl.n - 1;
  const el = $('#tipsCard');
  el.className = `card b-tips lv-${lvl.n}`;
  el.innerHTML = `
    ${cardHead('heart', 'Yang perlu dilakukan')}
    <ul class="todos">${TIPS.map((t) => `
      <li class="todo tone-${t.tones[i]}">
        <span class="todo__icon">${icon(t.icon, 20)}</span>
        <span class="todo__text"><small>${t.title}</small>${t.texts[i]}</span>
      </li>`).join('')}
    </ul>`;
}

function render24h(s) {
  const el = $('#dayCard');
  if (!s.hourly.length || !s.nowPoint) {
    setChart('day');
    el.innerHTML = `${cardHead('chart', '24 jam ke depan')}${emptyState('Prakiraan per jam tidak tersedia saat ini.')}`;
    return;
  }
  const { tz } = s;
  const nowTs = s.nowPoint.ts;
  const points = s.hourly.filter((p) => p.ts >= nowTs - 6 * HOUR && p.ts <= nowTs + 24 * HOUR);
  const future = points.filter((p) => p.ts >= nowTs);
  const peak = future.reduce((a, b) => (b.aqi > a.aqi ? b : a), future[0]);
  const low = future.reduce((a, b) => (b.aqi < a.aqi ? b : a), future[0]);

  el.innerHTML = `
    ${cardHead('chart', '24 jam ke depan', 'Prakiraan model Open-Meteo')}
    <div class="chart" id="dayChart"></div>
    <div class="day24__foot">
      <span>Puncak <span class="chip lv-${levelFor(peak.aqi).n}">${peak.aqi}</span> pukul ${f.time(peak.ts, tz)}</span>
      <span>Terendah <span class="chip lv-${levelFor(low.aqi).n}">${low.aqi}</span> pukul ${f.time(low.ts, tz)}</span>
      <a class="card__link" href="#prakiraan">Prakiraan 5 hari ${icon('arrow', 14)}</a>
    </div>`;
  setChart('day', forecastChart($('#dayChart'), { points, nowTs, tz, compact: true }));
}

function renderPollutants(s) {
  const el = $('#polutan');
  if (!s.pollutants) { el.innerHTML = `${cardHead('layers', 'Polutan')}${emptyState('Rincian polutan tidak tersedia saat ini.')}`; return; }
  const stationIaqi = s.primary.source === 'waqi' ? s.primary.station.iaqi : null;

  const tile = (key) => {
    const P = POLLUTANTS[key];
    const d = s.pollutants[key];
    const has = d.value != null;
    const lvl = d.aqi != null ? levelFor(d.aqi) : null;
    const ratio = has ? d.value / P.who : null;
    const scaleMax = Math.max(P.who * 2, (d.value ?? 0) * 1.15);
    const isMain = key === s.primary.main;
    const stationSub = stationIaqi?.[key];
    return `
      <div class="pol lv-${lvl?.n ?? 0}${isMain ? ' is-main' : ''}" title="${esc(P.name)}">
        <div class="pol__top"><span class="pol__sym">${P.html}</span>${isMain ? '<span class="tag">Utama</span>' : ''}</div>
        <p class="pol__val"><b>${f.num(d.value, has && d.value < 10 ? 1 : 0)}</b><small>${P.unit}</small></p>
        <div class="meter" role="img" aria-label="${has ? `${f.num(d.value, 1)} ${P.unit}; pedoman WHO ${P.who} ${P.unit}` : 'Tidak ada data'}">
          <span class="meter__fill" style="width:${has ? Math.min(100, (d.value / scaleMax) * 100).toFixed(1) : 0}%"></span>
          <i class="meter__who" style="left:${((P.who / scaleMax) * 100).toFixed(1)}%" title="Pedoman WHO"></i>
        </div>
        <p class="pol__meta">
          <span>${ratio == null ? '—' : ratio >= 1 ? `${f.num(ratio, 1)}× WHO` : `${f.num(ratio * 100)}% WHO`}</span>
          ${lvl ? `<span class="chip lv-${lvl.n}">AQI ${d.aqi}</span>` : ''}
        </p>
        ${stationSub != null ? `<p class="pol__station">Stasiun: AQI ${Math.round(stationSub)}</p>` : ''}
      </div>`;
  };

  el.innerHTML = `
    ${cardHead('layers', 'Polutan', `Konsentrasi: model Open-Meteo${stationIaqi ? ' · AQI stasiun: WAQI' : ''}`)}
    <div class="pol-grid">${POLLUTANT_ORDER.map(tile).join('')}</div>
    <details class="more">
      <summary>Tentang polutan &amp; pedoman WHO</summary>
      <dl class="pol-desc">${POLLUTANT_ORDER.map((k) => {
        const P = POLLUTANTS[k];
        return `<div><dt>${P.html} · ${P.name}</dt><dd>${P.desc} Pedoman WHO 2021: ${f.num(P.who)} ${P.unit} (rata-rata ${P.whoPeriod}).</dd></div>`;
      }).join('')}</dl>
      <p class="footnote">Konsentrasi berasal dari model Copernicus CAMS (resolusi ±40 km) dan merupakan nilai per jam, sehingga perbandingan dengan pedoman WHO (rata-rata 8–24 jam) bersifat indikatif. Sub-indeks AQI model dihitung Open-Meteo sesuai metode US EPA.</p>
    </details>`;
}

/* ------------------------------------------------------------------ */
/* Render: peringatan dini                                              */
/* ------------------------------------------------------------------ */

function alertCard(alert, match, tz, kecamatan = null) {
  const hitName = match.district ?? kecamatan;
  const now = Date.now();
  const level = {
    inside: 'Tepat di lokasi',
    district: `Kecamatan ${districtLabel(match.district ?? '')}`,
    near: `${match.distanceKm != null ? km(match.distanceKm) : 'Dekat'} dari lokasi`,
    province: match.distanceKm != null ? `${km(match.distanceKm)} · provinsi sama` : 'Provinsi sama',
  }[match.level];
  const upcoming = alert.effective != null && alert.effective > now;
  const span = [alert.effective, alert.expires].filter((t) => t != null).map((t) => f.time(t, tz)).join('–');
  const districts = [...alert.districts.primary, ...alert.districts.extended];
  const hitIdx = districts.findIndex((d) => sameDistrict(d, hitName));
  if (hitIdx > 0) districts.unshift(...districts.splice(hitIdx, 1));
  const shown = districts.slice(0, 12);
  const info = safeUrl(alert.infographic);
  const cap = safeUrl(alert.link);

  return `<article class="card alert-card alert-card--${match.level}">
    <header class="alert-card__head"><span>${icon(match.level === 'province' ? 'pin' : 'alert', 14)}${esc(level)}</span>${alert.severity ? `<span>Tingkat ${esc(SEVERITY[alert.severity] ?? alert.severity)}</span>` : ''}</header>
    <div class="alert-card__body">
      <h4>${esc(alert.headline)}</h4>
      ${span ? `<p class="alert-card__time">${icon('clock', 15)}<span>${upcoming ? 'Mulai' : 'Berlaku'} ${span} ${f.tzName(now, tz)}${alert.expires ? ` · ${upcoming ? `dimulai ${f.until(alert.effective)}` : `berakhir ${f.until(alert.expires)}`}` : ''}</span></p>` : ''}
      ${alert.impact ? `<p class="alert-card__impact"><b>Potensi dampak:</b> ${esc(alert.impact)}.</p>` : ''}
      ${districts.length ? `<ul class="chips" aria-label="Kecamatan terdampak">${shown.map((d) => `<li${sameDistrict(d, hitName) ? ' class="is-hit"' : ''}>${esc(districtLabel(d))}</li>`).join('')}${districts.length > shown.length ? `<li class="chips__more">+${districts.length - shown.length} lainnya</li>` : ''}</ul>` : ''}
      ${info || cap ? `<p class="alert-card__links">${info ? `<a href="${info}" target="_blank" rel="noopener">Infografis BMKG ${icon('external', 13)}</a>` : ''}${cap ? `<a href="${cap}" target="_blank" rel="noopener">Dokumen CAP ${icon('external', 13)}</a>` : ''}</p>` : ''}
    </div>
  </article>`;
}

function renderWarnings() {
  const loc = state.location;
  if (!loc) return;
  const w = currentWarnings();
  renderWarnCard(w);
  renderAlertBanner(w);

  const body = $('#warnBody');
  const tz = tzOf();
  if (!w) {
    body.innerHTML = state.place?.key === placeKey(loc) && !state.nowcast && state.nowcastError
      ? emptyState(`Data peringatan dini BMKG belum tersedia. Pastikan workflow GitHub Actions <b>Perbarui Data</b> sudah aktif (lihat README), atau periksa langsung di <a href="${BMKG_PORTAL}" target="_blank" rel="noopener">nowcasting.bmkg.go.id</a>.`, 'alert')
      : '<div class="warn"><div class="card skel skel--card"></div><div class="card skel skel--card"></div></div>';
    return;
  }

  const { place: p, local, regional, top, status, where, covering, checkedAt, stale } = w;
  const totalActive = activeAlerts(state.nowcast).length;
  const title = {
    alert: `${top?.alert.event ?? 'Cuaca ekstrem'} berlaku di ${where}`,
    near: `Ada peringatan ${km(top?.match.distanceKm ?? 0)} dari ${where}`,
    clear: `Tidak ada peringatan untuk ${where}`,
  }[status];
  const text = {
    alert: `BMKG menerbitkan ${covering > 1 ? `${covering} peringatan dini` : 'peringatan dini'} yang mencakup lokasi ini${local.length > covering ? `, ditambah ${local.length - covering} di sekitarnya` : ''}. Kurangi aktivitas di luar ruangan dan pantau perkembangan cuaca.`,
    near: 'Lokasi ini belum termasuk wilayah peringatan, tetapi cuaca ekstrem terjadi di sekitarnya dan dapat meluas. Tetap waspada.',
    clear: `Tidak ada peringatan dini cuaca BMKG yang mencakup lokasi ini maupun radius 25 km di sekitarnya. ${totalActive ? `Ada ${totalActive} peringatan aktif di wilayah lain Indonesia.` : 'Tidak ada peringatan aktif di seluruh Indonesia.'}`,
  }[status];
  const method = p.kecamatan ? 'Poligon wilayah BMKG + nama kecamatan' : `Poligon wilayah BMKG${p.geocoded ? ' (kecamatan tidak tersedia di OSM)' : ''}`;

  body.innerHTML = `
    <div class="warn">
      <article class="card warn-status warn-status--${status}">
        <p class="eyebrow warn-status__eyebrow">${icon(status === 'clear' ? 'check' : 'alert', 15)} Status peringatan</p>
        <h3 class="warn-status__title">${esc(title)}</h3>
        <p class="warn-status__text">${esc(text)}</p>
        <dl class="warn-place">
          <div><dt>Titik pantau</dt><dd>${esc([p.desa && `Kel./Desa ${p.desa}`, placeLabel(loc, p)].filter(Boolean).join(', '))}</dd></div>
          <div><dt>Koordinat</dt><dd>${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</dd></div>
          <div><dt>Metode pencocokan</dt><dd>${esc(method)}</dd></div>
        </dl>
        ${loc.id ? '<p class="warn-status__hint">Titik pantau kota berada di pusat kota. Tekan <b>Lokasi Saya</b> untuk mencocokkan dengan posisi Anda.</p>' : ''}
        ${stale ? `<p class="caveat">${icon('info', 15)}<span>Data peringatan terakhir diperbarui ${esc(f.ago(checkedAt))}, sehingga status di atas mungkin sudah berubah. Periksa kanal resmi BMKG.</span></p>` : ''}
      </article>
      <div class="warn-list">
        ${local.length
          ? local.map((m) => alertCard(m.alert, m.match, tz, p.kecamatan)).join('')
          : emptyState('<b>Langit relatif aman.</b> Tidak ada peringatan di lokasi dan radius 25 km. Peringatan nowcast BMKG biasanya berlaku 1–3 jam; data diperiksa ulang setiap 15 menit.', 'check')}
      </div>
    </div>
    ${regional.length ? `
      <details class="more warn-regional">
        <summary>${regional.length} peringatan lain di ${esc(w.provinsi ?? 'provinsi yang sama')}</summary>
        <div class="warn-grid">${regional.map((m) => alertCard(m.alert, m.match, tz, p.kecamatan)).join('')}</div>
      </details>` : ''}
    <p class="footnote">Sumber: <b>BMKG</b> — Peringatan Dini Cuaca (RSS nowcast, format CAP), disalin otomatis setiap 15 menit; terakhir diperbarui ${f.time(checkedAt, tz)} ${f.tzName(checkedAt, tz)} (${esc(f.ago(checkedAt))}). Wilayah administratif: <b>OpenStreetMap Nominatim</b> © kontributor OpenStreetMap. Untuk keputusan keselamatan, rujuk selalu <a href="${BMKG_PORTAL}" target="_blank" rel="noopener">kanal resmi BMKG</a>.</p>`;
}

function renderWarnCard(w) {
  const el = $('#warnCard');
  const loc = state.location;
  if (!w) {
    el.className = 'card b-warn';
    el.innerHTML = state.place?.key === placeKey(loc) && !state.nowcast && state.nowcastError
      ? `${cardHead('alert', 'Peringatan dini BMKG')}<p class="warnc__text">Data peringatan belum tersedia.</p><a class="card__link" href="#peringatan">Lihat detail ${icon('arrow', 14)}</a>`
      : '<div class="skel skel--fill"></div>';
    return;
  }
  const tz = tzOf();
  const { status, top, where, local, stale, checkedAt } = w;
  const until = top?.alert.expires ? ` hingga ${f.time(top.alert.expires, tz)} ${f.tzName(top.alert.expires, tz)}` : '';
  el.className = `card b-warn warn--${status}`;
  el.innerHTML = `
    ${cardHead('alert', 'Peringatan dini BMKG', `diperiksa ${esc(f.ago(checkedAt))}`)}
    <div>
      <p class="warnc__title">${status === 'clear' ? `${icon('check', 24)}Tidak ada peringatan` : esc(top.alert.headline)}</p>
      <p class="warnc__text">${{
        clear: `Aman untuk ${esc(where)} dan radius 25 km di sekitarnya.`,
        alert: `Berlaku di ${esc(where)}${until}.`,
        near: `Terjadi ${km(top?.match.distanceKm ?? 0)} dari ${esc(where)}${until}.`,
      }[status]}</p>
      ${local.length > 1 ? `<p class="warnc__more">+${local.length - 1} peringatan lain di sekitar lokasi</p>` : ''}
      ${stale ? `<p class="caveat">${icon('info', 15)}<span>Data terakhir diperbarui ${esc(f.ago(checkedAt))}.</span></p>` : ''}
    </div>
    <a class="card__link" href="#peringatan">Lihat detail ${icon('arrow', 14)}</a>`;
}

function renderAlertBanner(w) {
  const el = $('#alertBanner');
  if (!w || w.status !== 'alert') { el.hidden = true; el.innerHTML = ''; return; }
  const tz = tzOf();
  const top = w.local.find((m) => m.match.level === 'inside' || m.match.level === 'district');
  el.hidden = false;
  el.innerHTML = `
    <a class="hazard" href="#peringatan">
      <span class="hazard__tag">${icon('alert', 15)} Peringatan BMKG</span>
      <span class="hazard__text"><b>${esc(top.alert.headline)}</b> — berlaku di ${esc(w.where)}${top.alert.expires ? ` hingga ${f.time(top.alert.expires, tz)} ${f.tzName(top.alert.expires, tz)}` : ''}</span>
      <span class="hazard__cta">Detail ${icon('arrow', 15)}</span>
    </a>`;
}

/* ------------------------------------------------------------------ */
/* Render: bagian lanjutan                                              */
/* ------------------------------------------------------------------ */

function renderForecast(s) {
  const body = $('#fcBody');
  if (!s.hourly.length) { setChart('forecast'); body.innerHTML = emptyState('Prakiraan tidak tersedia saat ini.'); return; }
  const { tz } = s;
  const nowTs = s.nowPoint?.ts ?? s.hourly[0].ts;
  const points = s.hourly.filter((p) => p.ts >= nowTs - 48 * HOUR);

  const todayKey = f.parts(s.now, tz).key;
  const groups = new Map();
  for (const p of points) {
    const { key } = f.parts(p.ts, tz);
    if (key < todayKey) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const days = [...groups.values()]
    .filter((pts, i) => i === 0 || pts.length >= 12)
    .slice(0, 5)
    .map((pts, i) => {
      const values = pts.map((p) => p.aqi);
      return { ts: pts[0].ts, label: i === 0 ? 'Hari ini' : i === 1 ? 'Besok' : f.weekday(pts[0].ts, tz), max: Math.max(...values), min: Math.min(...values) };
    });
  const future = points.filter((p) => p.ts >= nowTs).filter((_, i) => i % 3 === 0);

  body.innerHTML = `
    <div class="card card--pad">
      <div class="card__head">
        <h3 class="card__title">${icon('chart', 18)}AQI US per jam</h3>
        <div class="legend">
          ${LEVELS.map((l) => `<span class="lv-${l.n}"><i></i>${l.short}</span>`).join('')}
          <span class="legend__hatch"><i></i>Lampau</span>
        </div>
      </div>
      <div class="chart" id="fcChart" style="margin-top:.6rem"></div>
    </div>
    <div class="days">${days.map((d) => {
      const lvl = levelFor(d.max);
      return `<article class="card day lv-${lvl.n}">
        <p class="day__name">${d.label}</p>
        <p class="day__date">${f.dayMonth(d.ts, tz)}</p>
        <p class="day__aqi"><i></i>${d.max}</p>
        <p class="day__label">Puncak · ${lvl.short}</p>
        <p class="day__range">Rentang ${d.min}–${d.max}</p>
      </article>`;
    }).join('')}</div>
    <p class="footnote">Sumber: Open-Meteo Air Quality API (model Copernicus CAMS). Prakiraan model bisa berbeda dari angka stasiun di ringkasan.</p>
    <details class="more">
      <summary>Lihat prakiraan sebagai tabel</summary>
      <div class="table-scroll">
        <table class="data">
          <thead><tr><th>Waktu</th><th>AQI</th><th>Kategori</th><th>PM2.5 (µg/m³)</th><th>PM10 (µg/m³)</th></tr></thead>
          <tbody>${future.map((p) => `<tr><td class="nowrap">${f.dateTime(p.ts, tz)}</td><td><b>${p.aqi}</b></td><td>${levelFor(p.aqi).label}</td><td>${f.num(p.pm25, 1)}</td><td>${f.num(p.pm10, 1)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    </details>`;

  setChart('forecast', forecastChart($('#fcChart'), { points, nowTs, tz }));
}

function renderHealth(s, lvl) {
  $('#healthBody').innerHTML = `
    <div class="health">
      <article class="card card--pad health__lead lv-${lvl.n}">
        <p class="eyebrow">Status saat ini · AQI ${s.primary.aqi}</p>
        <h3 class="health__big">${lvl.label}</h3>
        <p>${lvl.summary}</p>
      </article>
      <article class="card card--pad">
        <h3>${icon('users')} Masyarakat umum</h3>
        <p>${lvl.general}</p>
      </article>
      <article class="card card--pad">
        <h3>${icon('heart')} Kelompok sensitif</h3>
        <p>${lvl.sensitive}</p>
        <p class="muted" style="font-size:.82rem">Anak-anak, lansia, ibu hamil, penderita asma, penyakit paru &amp; jantung.</p>
      </article>
    </div>`;
}

function archiveSeries(s) {
  const cutoff = Date.now() - 7 * 24 * HOUR;
  const rows = s.loc.id ? state.history?.series?.[s.loc.id] : null;
  const station = (rows ?? [])
    .map((r) => ({ ts: Date.parse(r[0]), aqi: r[1] }))
    .filter((p) => p.aqi != null && p.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts);
  if (station.length >= 24) return { points: station, label: 'Stasiun IQAir' };
  return { points: s.hourly.filter((p) => p.ts >= cutoff && p.ts <= s.now), label: 'Model Open-Meteo' };
}

function renderArchive(s) {
  const body = $('#archiveBody');
  const { points, label } = archiveSeries(s);
  if (points.length < 2) { setChart('history'); body.innerHTML = emptyState('Arsip tujuh hari belum tersedia untuk lokasi ini.', 'archive'); return; }

  const values = points.map((p) => p.aqi);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const maxP = points.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const minP = points.reduce((a, b) => (b.aqi < a.aqi ? b : a));
  const counts = LEVELS.map((l) => values.filter((v) => levelFor(v).n === l.n).length);
  const tz = s.tz;
  const stat = (title, v, sub) => `<div class="card stat lv-${levelFor(v).n}"><p class="stat__label">${title}</p><p class="stat__value"><i></i>${v}</p><p class="stat__sub">${sub}</p></div>`;

  body.innerHTML = `
    <div class="stats">
      ${stat('Rata-rata', avg, levelFor(avg).short)}
      ${stat('Tertinggi', maxP.aqi, f.dateTime(maxP.ts, tz))}
      ${stat('Terendah', minP.aqi, f.dateTime(minP.ts, tz))}
    </div>
    <div class="card card--pad">
      <div class="card__head"><h3 class="card__title">${icon('chart', 18)}AQI US per jam</h3><span class="card__src">${label} · ${points.length} jam</span></div>
      <div class="chart" id="histChart" style="margin-top:.6rem"></div>
      <p class="card__src" style="margin-top:1rem">Komposisi jam per kategori</p>
      <div class="compo" role="img" aria-label="${LEVELS.map((l, i) => `${l.label}: ${counts[i]} jam`).join(', ')}">
        ${LEVELS.map((l, i) => (counts[i] ? `<span class="lv-${l.n}" style="flex:${counts[i]}"></span>` : '')).join('')}
      </div>
      <ul class="compo__legend">${LEVELS.map((l, i) => (counts[i] ? `<li class="lv-${l.n}"><i></i>${l.short} <b>${Math.round((counts[i] / values.length) * 100)}%</b></li>` : '')).join('')}</ul>
    </div>`;

  setChart('history', historyChart($('#histChart'), { points, tz }));
}

function renderLeague() {
  const body = $('#leagueBody');
  if (!state.league.length) return;
  const rows = [...state.league].sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));
  body.innerHTML = `
    <div class="card table-card">
      <div class="table-x">
        <table class="data league">
          <thead><tr><th>#</th><th>Kota</th><th>AQI</th><th class="hide-sm">Polutan</th><th>Sumber</th></tr></thead>
          <tbody>${rows.map((r, i) => {
            const lvl = r.aqi != null ? levelFor(r.aqi) : null;
            return `<tr class="${state.location?.id === r.loc.id ? 'is-current' : ''}">
              <td class="league__rank">${i + 1}</td>
              <td><button type="button" class="linklike" data-id="${esc(r.loc.id)}">${esc(r.loc.name)}</button><small>${esc(r.loc.region ?? '')}</small></td>
              <td>${lvl ? `<span class="chip lv-${lvl.n}">${r.aqi}</span><small>${lvl.short}</small>` : '—'}</td>
              <td class="hide-sm">${r.main ? POLLUTANTS[r.main].html : '—'}</td>
              <td><span class="nowrap">${icon(r.source === 'Stasiun' ? 'radio' : 'layers', 14)}</span> ${r.source}<small>${esc(r.detail)}</small></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>
    <p class="footnote">Klik nama kota untuk membuka ringkasannya.</p>`;
}

function renderAbout() {
  const token = Boolean(waqiToken());
  const iqairOn = Boolean(state.latest?.generatedAt);
  const p = state.snap?.primary;
  const attributions = p?.source === 'waqi' && p.station.attributions.length
    ? `<p class="footnote">Data stasiun saat ini: ${p.station.attributions.map((a) => (safeUrl(a.url) ? `<a href="${safeUrl(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name))).join(' · ')}.</p>`
    : '';
  const sources = [
    ['Pengukuran stasiun', 'WAQI · aqicn.org', 'AQI terkini dari stasiun pemerintah, Kedubes AS, dan jaringan pemantau lain di dekat lokasi.', 'https://aqicn.org/'],
    ['Model Copernicus CAMS', 'Open-Meteo Air Quality', 'Konsentrasi 6 polutan, indeks UV, prakiraan per jam 5 hari, dan arsip 7 hari.', 'https://open-meteo.com/en/docs/air-quality-api'],
    ['Resmi · nowcast', 'BMKG Peringatan Dini', 'Peringatan cuaca ekstrem, dicocokkan dengan poligon wilayah dan kecamatan.', BMKG_PORTAL],
    ['Wilayah administratif', 'OpenStreetMap Nominatim', 'Desa, kecamatan, kota, dan provinsi dari koordinat lokasi.', 'https://nominatim.org/'],
  ];

  $('#aboutBody').innerHTML = `
    <div class="about">
      <div class="card table-card">
        <div class="card__head" style="padding:1rem 1.2rem .8rem"><h3 class="card__title">Skala AQI US (EPA)</h3></div>
        <div class="table-x">
          <table class="data">
            <thead><tr><th>AQI</th><th>Kategori</th><th>Artinya bagi kesehatan</th></tr></thead>
            <tbody>${LEVELS.map((l) => `<tr><td class="nowrap"><span class="chip lv-${l.n}">${l.min}–${l.max}</span></td><td><b>${l.label}</b></td><td>${l.summary}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="about__side">
        <div class="card card--pad">
          <h3 class="card__title">Urutan sumber angka AQI</h3>
          <ol class="order">
            <li><b>Stasiun WAQI terdekat</b> — dipakai bila jaraknya ≤ ${maxStationKm()} km dan datanya ≤ 3 jam. <span class="chip chip--ok">${token ? 'Aktif' : 'Token belum diatur'}</span></li>
            <li><b>Stasiun IQAir</b> — opsional, lewat GitHub Actions. <span class="chip chip--ok">${iqairOn ? 'Aktif' : 'Tidak aktif'}</span></li>
            <li><b>Model Open-Meteo</b> — cadangan terakhir, selalu tersedia.</li>
          </ol>
        </div>
        <div class="sources">${sources.map(([tag, title, desc, url]) => `
          <a class="card src-card" href="${url}" target="_blank" rel="noopener">
            <span class="src-card__tag">${tag}</span>
            <h3>${title} ${icon('external', 13)}</h3>
            <p>${desc}</p>
          </a>`).join('')}
        </div>
      </div>
    </div>
    ${attributions}`;
}

function renderError(err) {
  ['day', 'forecast', 'history'].forEach((k) => setChart(k));
  const aqi = $('#aqiCard');
  aqi.className = 'card b-aqi';
  aqi.innerHTML = `
    <div class="alert">
      <span class="eyebrow">Gagal memuat</span>
      <h2>Data belum bisa ditampilkan.</h2>
      <p>${esc(err.message)}</p>
      <button class="btn btn--primary" type="button" id="retryBtn">${icon('refresh')} Coba lagi</button>
    </div>`;
  ['#wxCard', '#tipsCard', '#dayCard', '#polutan'].forEach((sel) => { $(sel).innerHTML = `<p class="muted">—</p>`; });
  ['#fcBody', '#healthBody', '#archiveBody'].forEach((sel) => { $(sel).innerHTML = ''; });
  $('#retryBtn').addEventListener('click', () => {
    if (state.location) selectLocation(state.location, { save: false });
    else window.location.reload();
  });
}

/* ------------------------------------------------------------------ */
/* Interaksi                                                            */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

async function share() {
  const s = state.snap;
  if (!s) return;
  const lvl = levelFor(s.primary.aqi);
  const top = currentWarnings()?.top;
  const text = `Kualitas udara ${s.loc.name}: AQI ${s.primary.aqi} (${lvl.label}).${top ? ` Peringatan BMKG: ${top.alert.headline}.` : ''} Pantau di Warta Udara:`;
  const url = location.href.split('#')[0];
  if (navigator.share) {
    try { await navigator.share({ title: document.title, text, url }); } catch { /* dibatalkan */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Ringkasan & tautan disalin.');
  } catch {
    toast('Gagal menyalin tautan.');
  }
}

function initTheme() {
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    $('#themeIcon').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 18);
    $('#themeToggle').setAttribute('aria-label', theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0F1012' : '#F5F3EE';
  };
  apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('wu:theme', next); } catch { /* abaikan */ }
  });
}

function bindLocationControls() {
  const pickById = (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const loc = state.config.locations.find((l) => l.id === btn.dataset.id);
    if (!loc) return;
    if (loc !== state.location) selectLocation(loc);
    if (e.currentTarget.id === 'leagueBody') $('#konten').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('#pills').addEventListener('click', pickById);
  $('#leagueBody').addEventListener('click', pickById);

  // Pencarian kota (Open-Meteo Geocoding)
  const form = $('#searchForm');
  const input = $('#searchInput');
  const list = $('#searchResults');
  let items = [];
  let active = -1;
  let timer = 0;
  let seq = 0;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (i) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `opt-${i}`);
  };
  const choose = (i) => {
    const r = items[i];
    if (!r) return;
    close();
    input.value = '';
    input.blur();
    selectLocation({
      name: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(', '),
      province: r.country_code === 'ID' ? r.admin1 ?? null : null,
      lat: r.latitude,
      lon: r.longitude,
    });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { seq++; close(); return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      list.hidden = false;
      list.innerHTML = '<li class="search__msg">Mencari…</li>';
      let results = null;
      try { results = await searchPlaces(q); } catch { /* ditangani di bawah */ }
      if (mine !== seq) return;
      items = results ?? [];
      active = -1;
      if (!results) { list.innerHTML = '<li class="search__msg">Gagal mencari. Coba lagi.</li>'; return; }
      if (!items.length) { list.innerHTML = '<li class="search__msg">Kota tidak ditemukan.</li>'; return; }
      list.innerHTML = items.map((r, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="false" class="search__opt">
        <b>${esc(r.name)}</b><span>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span></li>`).join('');
      input.setAttribute('aria-expanded', 'true');
    }, 280);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) { if (e.key === 'Escape') close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight((active - 1 + items.length) % items.length); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (items.length && !list.hidden) choose(Math.max(0, active));
  });

  // Geolokasi browser + reverse geocoding Nominatim
  const geoBtn = $('#geoBtn');
  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { toast('Browser Anda tidak mendukung geolokasi.'); return; }
    geoBtn.disabled = true;
    const done = () => { geoBtn.disabled = false; };
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      const place = await reversePlace(lat, lon).catch(() => null);
      done();
      selectLocation({
        name: place?.kabupaten ?? place?.kecamatan ?? 'Lokasi Anda',
        region: [place?.kecamatan && `Kec. ${place.kecamatan}`, place?.provinsi].filter(Boolean).join(', ') || `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
        province: place?.provinsi ?? null,
        lat,
        lon,
      });
    }, (err) => {
      done();
      toast(err.code === 1 ? 'Izin lokasi ditolak oleh browser.' : 'Tidak dapat menentukan lokasi Anda.');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60e3 });
  });
}

/* ------------------------------------------------------------------ */
/* Mulai                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 18); });
  $('#year').textContent = new Date().getFullYear();
  initTheme();
  $('#shareBtn').addEventListener('click', share);

  try {
    state.config = await fetchJSON('config.json', { bust: true });
    if (!state.config?.locations?.length) throw new Error('config.json tidak memiliki daftar lokasi.');
  } catch (err) {
    renderError(new Error(`Gagal membaca config.json — ${err.message}`));
    return;
  }

  bindLocationControls();
  await loadStationData();
  renderAbout();

  const saved = store.get('wu:location');
  const restored = saved?.id
    ? state.config.locations.find((l) => l.id === saved.id)
    : saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon) ? saved : null;

  loadLeague();
  await selectLocation(restored ?? state.config.locations[0], { save: false });

  setInterval(refresh, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.loadedAt > REFRESH_MS) refresh();
  });
}

init();
