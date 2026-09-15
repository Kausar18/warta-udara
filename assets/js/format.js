// Utilitas format tanggal/angka (locale id-ID) dan escaping HTML.

const LOCALE = 'id-ID';
const cache = new Map();

function dtf(opts) {
  const key = JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(LOCALE, opts));
  return cache.get(key);
}

export const time = (ts, tz) => dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(ts);
export const longDate = (ts, tz) => dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(ts);
export const dayMonth = (ts, tz) => dtf({ day: 'numeric', month: 'short', timeZone: tz }).format(ts);
export const weekday = (ts, tz) => dtf({ weekday: 'long', timeZone: tz }).format(ts);
export const shortWeekday = (ts, tz) => dtf({ weekday: 'short', day: 'numeric', timeZone: tz }).format(ts);
export const dateTime = (ts, tz) => dtf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(ts);

export function tzName(ts, tz) {
  return dtf({ timeZoneName: 'short', timeZone: tz }).formatToParts(ts).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** Kunci tanggal lokal (YYYY-MM-DD) dan jam lokal untuk sebuah timestamp. */
export function parts(ts, tz) {
  const o = {};
  for (const p of dtf({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(ts)) o[p.type] = p.value;
  return { key: `${o.year}-${o.month}-${o.day}`, year: Number(o.year), hour: Number(o.hour) % 24 };
}

export function dayOfYear(ts, tz) {
  const [y, m, d] = parts(ts, tz).key.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5 + 1;
}

const numCache = new Map();
export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  if (!numCache.has(digits)) numCache.set(digits, new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return numCache.get(digits).format(v);
}

export function ago(ts) {
  const min = (Date.now() - ts) / 60000;
  if (min < 1) return 'baru saja';
  if (min < 60) return `${Math.round(min)} menit lalu`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

/** "dalam 1 jam 20 menit" / "5 menit lalu" */
export function until(ts) {
  if (ts == null) return '';
  const min = Math.round((ts - Date.now()) / 60000);
  if (min <= 0) return 'baru saja';
  if (min < 60) return `dalam ${min} menit`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `dalam ${h} jam${m ? ` ${m} menit` : ''}`;
}

export function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out || 'I';
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
