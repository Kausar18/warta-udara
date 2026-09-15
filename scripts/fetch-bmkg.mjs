#!/usr/bin/env node
/**
 * Menyalin Peringatan Dini Cuaca BMKG (RSS nowcast + dokumen CAP) → data/bmkg-nowcast.json.
 *
 * RSS BMKG tidak mengirim header CORS untuk permintaan dari browser, jadi halaman web
 * membaca salinan ini. Dijalankan GitHub Actions setiap 15 menit.
 * Berkas hanya ditulis ulang bila daftar peringatan berubah, atau sekali per jam sebagai
 * penanda bahwa pemeriksaan masih berjalan (agar tidak membuat commit berlebihan).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRss, parseCap, isActive } from '../assets/js/bmkg-parse.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'bmkg-nowcast.json');
const RSS_URL = 'https://www.bmkg.go.id/alerts/nowcast/id/rss.xml';
const UA = 'Mozilla/5.0 (compatible; WartaUdara/1.0; +https://github.com)';
const MAX_AGE_MS = 24 * 3600e3;
const HEARTBEAT_MS = 60 * 60e3;
const FORCE = process.argv.includes('--force');

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

const round = (poly) => poly.map(([lat, lon]) => [Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4]);
const signature = (alerts) => JSON.stringify(alerts.map((a) => [a.id, a.expires]).sort());

async function main() {
  const now = Date.now();
  const items = parseRss(await getText(RSS_URL)).filter((i) => i.pubDate == null || now - i.pubDate < MAX_AGE_MS);
  console.log(`RSS: ${items.length} peringatan dalam 24 jam terakhir`);

  const alerts = [];
  for (let i = 0; i < items.length; i += 4) {
    const batch = items.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map(async (item) => parseCap(await getText(item.link), item)));
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') return alerts.push(r.value);
      // CAP gagal → tetap simpan dari isi RSS (tanpa poligon; waktu berakhir dari teks).
      console.warn(`  ✗ CAP: ${r.reason.message} — memakai data RSS`);
      alerts.push(parseCap('', batch[j]));
    });
  }

  const active = alerts.filter((a) => isActive(a, now)).map((a) => ({ ...a, polygons: a.polygons.map(round) }));

  const prev = JSON.parse(await readFile(OUT, 'utf8').catch(() => 'null'));
  const prevAt = Date.parse(prev?.checkedAt ?? '');
  if (!FORCE && prev && signature(prev.alerts ?? []) === signature(active) && now - prevAt < HEARTBEAT_MS) {
    console.log(`Tidak ada perubahan (${active.length} peringatan aktif); berkas tidak ditulis ulang.`);
    return;
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify({
    source: 'BMKG — Peringatan Dini Cuaca (nowcast)',
    feed: RSS_URL,
    checkedAt: new Date(now).toISOString(),
    alerts: active,
  })}\n`);
  console.log(`✓ ${active.length} peringatan aktif disimpan.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
