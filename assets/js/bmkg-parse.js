// Parser & pencocokan Peringatan Dini Cuaca BMKG (RSS nowcast + CAP 1.2).
// Modul murni tanpa DOM — dipakai di browser dan di skrip Node (scripts/fetch-bmkg.mjs).

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const decode = (s) => s
  .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(lt|gt|quot|apos|amp);/g, (_, e) => ENTITIES[e]);

const blocks = (xml, name) => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);
const text = (xml, name) => { const b = blocks(xml, name)[0]; return b == null ? null : decode(b.trim()); };
const time = (v) => { const t = Date.parse(v ?? ''); return Number.isFinite(t) ? t : null; };

const MONTHS = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11 };
const ZONES = { WIB: 7, WITA: 8, WIT: 9 };

/** "12 September 2026, 05:00 WIB" → epoch ms */
export function parseIndoTime(str) {
  const m = String(str ?? '').match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(\d{1,2})[.:](\d{2})\s*(WITA|WIB|WIT)\b/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month == null) return null;
  return Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5])) - ZONES[m[6]] * 3600e3;
}

export function parseRss(xml) {
  return blocks(xml, 'item').map((item) => ({
    title: text(item, 'title'),
    link: text(item, 'link'),
    description: text(item, 'description'),
    guid: text(item, 'guid'),
    pubDate: time(text(item, 'pubDate')),
  })).filter((i) => i.link);
}

/** "lat,lon lat,lon …" → [[lat, lon], …] */
export function parsePolygon(str) {
  return str.trim().split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));
}

/** Daftar kecamatan dari kalimat "…khususnya di A, B, C." dan "…dapat meluas ke wilayah D, E." */
export function parseDistricts(description = '') {
  const list = (re) => {
    const m = description.match(re);
    return m ? m[1].split(',').map((s) => s.replace(/\s+/g, ' ').replace(/^dan\s+/i, '').trim()).filter(Boolean) : [];
  };
  return {
    primary: list(/khususnya di\s+([\s\S]+?)\.(?=\s*(?:\n|Kondisi|Dan\b|dan\b|Hal\b|$))/),
    extended: list(/meluas ke (?:wilayah\s+)?([\s\S]+?)\.(?=\s*(?:\n|Kondisi|Hal\b|$))/i),
  };
}

/** Membentuk objek peringatan dari CAP XML; bila CAP tidak tersedia (xml kosong), memakai data RSS. */
export function parseCap(xml, item = {}) {
  const info = blocks(xml, 'info')[0] ?? '';
  const headline = text(info, 'headline') ?? item.title ?? 'Peringatan Dini Cuaca';
  const description = text(info, 'description') ?? item.description ?? '';
  const areas = blocks(info, 'area').map((a) => ({
    desc: text(a, 'areaDesc'),
    polygons: blocks(a, 'polygon').map((p) => parsePolygon(decode(p))).filter((p) => p.length >= 3),
  }));
  return {
    id: text(xml, 'identifier') ?? item.guid ?? item.link,
    link: item.link ?? null,
    event: text(info, 'event') ?? headline.replace(/\s+di\s+.+$/, ''),
    headline,
    description,
    impact: description.match(/dampak berupa\s+([^.]+)\./i)?.[1]?.trim() ?? null,
    severity: text(info, 'severity'),
    urgency: text(info, 'urgency'),
    certainty: text(info, 'certainty'),
    sent: time(text(xml, 'sent')) ?? item.pubDate ?? null,
    effective: time(text(info, 'effective')) ?? parseIndoTime(description.match(/terjadi pada\s+([^\n]+)/i)?.[1]),
    expires: time(text(info, 'expires')) ?? parseIndoTime(description.match(/hingga\s+([^\n]+)/i)?.[1]),
    infographic: text(info, 'web'),
    province: areas.find((a) => a.desc)?.desc ?? headline.match(/\bdi\s+(.+)$/)?.[1] ?? null,
    districts: parseDistricts(description),
    polygons: areas.flatMap((a) => a.polygons),
    hasCap: Boolean(info),
  };
}

/* ---------------- Geometri ---------------- */

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Jarak (km) titik ke tepi poligon, proyeksi ekuirektangular lokal (akurat untuk jarak < ~200 km). */
export function distanceToPolygonKm(lat, lon, poly) {
  const kx = R * rad(1) * Math.cos(rad(lat));
  const ky = R * rad(1);
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = (poly[j][1] - lon) * kx; const ay = (poly[j][0] - lat) * ky;
    const bx = (poly[i][1] - lon) * kx; const by = (poly[i][0] - lat) * ky;
    const dx = bx - ax; const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/* ---------------- Pencocokan wilayah ---------------- */

export const normName = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const PROVINCE_NOISE = /\b(PROVINSI|DAERAH KHUSUS IBUKOTA|DAERAH KHUSUS|DAERAH ISTIMEWA|DKI|DI)\b/g;
const normProvince = (s) => normName(s).replace(PROVINCE_NOISE, ' ').replace(/\s+/g, ' ').trim();

export const sameProvince = (a, b) => Boolean(a && b) && normProvince(a) === normProvince(b);

export const MATCH_RANK = { inside: 0, district: 1, near: 2, province: 3 };

/**
 * Seberapa relevan sebuah peringatan untuk lokasi pengguna.
 * place: { lat, lon, kecamatan?, kabupaten?, provinsi? }
 * → { level: 'inside' | 'district' | 'near' | 'province', distanceKm, district? } atau null
 */
export function matchAlert(alert, place, { nearKm = 25 } = {}) {
  const { lat, lon } = place;
  let distanceKm = Infinity;
  for (const poly of alert.polygons) {
    if (pointInPolygon(lat, lon, poly)) return { level: 'inside', distanceKm: 0 };
    distanceKm = Math.min(distanceKm, distanceToPolygonKm(lat, lon, poly));
  }
  const dist = Number.isFinite(distanceKm) ? distanceKm : null;

  const provinceOk = sameProvince(alert.province, place.provinsi);
  // Nama kecamatan bisa kembar antarprovinsi, jadi wajib provinsi sama (atau berdekatan bila provinsi tak diketahui).
  if (place.kecamatan && (provinceOk || (!place.provinsi && dist != null && dist < 100))) {
    const target = normName(place.kecamatan);
    const hit = [...alert.districts.primary, ...alert.districts.extended].find((d) => normName(d) === target);
    if (hit) return { level: 'district', distanceKm: dist, district: hit };
  }

  if (dist != null && dist <= nearKm) return { level: 'near', distanceKm: dist };
  if (provinceOk) return { level: 'province', distanceKm: dist };
  return null;
}

export const isActive = (alert, now = Date.now()) => alert.expires == null || alert.expires > now;
