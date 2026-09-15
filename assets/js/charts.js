// Grafik SVG buatan sendiri (tanpa library): batang prakiraan & garis arsip.
// Digambar ulang pada lebar piksel sebenarnya agar teks tetap tajam di semua ukuran layar.

import { LEVELS, levelFor } from './aqi.js';
import * as f from './format.js';

const HOUR = 3600e3;
const THRESHOLDS = [50, 100, 150, 200, 300, 400];
let uid = 0;

function niceMax(v) {
  for (const m of [100, 150, 200, 300, 400, 500]) if (v * 1.12 <= m) return m;
  return Math.ceil((v * 1.12) / 100) * 100;
}

const fx = (n) => n.toFixed(1);

/** Menggambar ulang saat lebar wadah berubah. Mengembalikan fungsi pembersih. */
function mount(el, draw) {
  let lastW = 0;
  let raf = 0;
  const ro = new ResizeObserver(() => {
    const w = Math.floor(el.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => draw(w));
  });
  ro.observe(el);
  return () => { ro.disconnect(); cancelAnimationFrame(raf); };
}

/** Lapisan tooltip + navigasi keyboard yang dipakai kedua grafik. */
function attachHover(el, { W, count, indexAt, point, onFocus, initial }) {
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  let current = -1;

  const hide = () => {
    current = -1;
    tip.hidden = true;
    onFocus(-1);
  };
  const show = (i) => {
    if (i < 0 || i >= count) return hide();
    current = i;
    onFocus(i);
    const { x, y, html } = point(i);
    tip.innerHTML = html;
    tip.hidden = false;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(W - half - 2, Math.max(half + 2, x))}px`;
    tip.style.top = `${Math.max(tip.offsetHeight + 14, y)}px`;
  };

  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    show(indexAt(((e.clientX - r.left) * W) / r.width));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, PageDown: 12, PageUp: -12 }[e.key];
    if (step == null) return;
    e.preventDefault();
    show(Math.min(count - 1, Math.max(0, current < 0 ? initial : current + step)));
  });
}

function gridLayer(yMax, y, x0, x1) {
  return `<g class="grid">${THRESHOLDS.filter((t) => t <= yMax).map((t) =>
    `<line x1="${x0}" x2="${x1}" y1="${fx(y(t))}" y2="${fx(y(t))}"/><text x="${x0 - 8}" y="${fx(y(t))}" dy="0.32em" text-anchor="end">${t}</text>`).join('')}</g>`;
}

/**
 * Grafik batang AQI per jam. Batang sebelum "sekarang" diberi arsir (data lampau),
 * sesudahnya prakiraan. Warna batang = kategori AQI.
 */
export function forecastChart(el, { points, nowTs, tz, compact = false }) {
  return mount(el, (W) => {
    const narrow = W < 640;
    const data = narrow && !compact ? points.filter((p) => p.ts >= nowTs - 12 * HOUR && p.ts <= nowTs + 72 * HOUR) : points;
    if (!data.length) { el.innerHTML = ''; return; }

    const H = compact ? (narrow ? 170 : 190) : narrow ? 240 : 300;
    const m = { t: compact ? 26 : 34, r: 6, b: 30, l: 34 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const yMax = niceMax(Math.max(...data.map((p) => p.aqi)));
    const y = (v) => m.t + ih - (v / yMax) * ih;
    const step = iw / data.length;
    const gap = step >= 6 ? 2 : step >= 3 ? 1 : 0;
    let nowIdx = data.findIndex((p) => p.ts >= nowTs);
    if (nowIdx < 0) nowIdx = data.length - 1;
    const xNow = m.l + nowIdx * step;
    const id = `hatch-${++uid}`;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Grafik indeks AQI per jam: data lampau dan prakiraan. Gunakan tombol panah untuk menjelajah.">`;
    s += `<defs><pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="hatch"/></pattern></defs>`;
    if (nowIdx > 0) s += `<rect x="${m.l}" y="${m.t}" width="${fx(xNow - m.l)}" height="${ih}" fill="url(#${id})"/>`;
    s += gridLayer(yMax, y, m.l, W - m.r);

    // Pemisah hari & label sumbu X
    let axis = '<g class="axis">';
    let lastLabelX = -Infinity;
    data.forEach((p, i) => {
      const { hour } = f.parts(p.ts, tz);
      const x = m.l + i * step;
      if (hour === 0) {
        axis += `<line class="daysep" x1="${fx(x)}" x2="${fx(x)}" y1="${m.t}" y2="${m.t + ih + 6}"/>`;
        if (x - lastLabelX > 44) { axis += `<text class="axis-day" x="${fx(x + 4)}" y="${H - 12}">${f.shortWeekday(p.ts, tz)}</text>`; lastLabelX = x; }
      } else if (compact ? hour % 6 === 0 && step * 6 > 40 : hour === 12 && !narrow && step * 12 > 70) {
        axis += `<text x="${fx(x)}" y="${H - 12}" text-anchor="middle">${String(hour).padStart(2, '0')}.00</text>`;
      }
    });
    s += `${axis}</g>`;

    s += '<g class="bars">';
    data.forEach((p, i) => {
      const h = Math.max(1.5, (p.aqi / yMax) * ih);
      s += `<rect class="bar lv-${levelFor(p.aqi).n}${i < nowIdx ? ' is-past' : ''}" data-i="${i}" x="${fx(m.l + i * step + gap / 2)}" y="${fx(m.t + ih - h)}" width="${fx(Math.max(0.6, step - gap))}" height="${fx(h)}"/>`;
    });
    s += `</g><line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;

    const nowAnchor = xNow > W - 110 ? 'end' : 'start';
    const nowTextX = nowAnchor === 'end' ? xNow - 6 : xNow + 6;
    s += `<g class="now"><line x1="${fx(xNow)}" x2="${fx(xNow)}" y1="${m.t - 18}" y2="${m.t + ih}"/><text x="${fx(nowTextX)}" y="${m.t - 22}" text-anchor="${nowAnchor}">SEKARANG</text></g>`;
    if (!compact && nowIdx > 0 && xNow - m.l > 120) s += `<text class="zone" x="${m.l}" y="${m.t - 22}">← LAMPAU</text>`;
    if (!compact && W - m.r - xNow > 200) s += `<text class="zone" x="${W - m.r}" y="${m.t - 22}" text-anchor="end">PRAKIRAAN →</text>`;
    s += `</svg><div class="tip" hidden></div>`;
    el.innerHTML = s;

    const bars = el.querySelectorAll('.bar');
    let hot = null;
    attachHover(el, {
      W,
      count: data.length,
      initial: nowIdx,
      indexAt: (x) => Math.floor((x - m.l) / step),
      onFocus: (i) => {
        hot?.classList.remove('is-hot');
        hot = i >= 0 ? bars[i] : null;
        hot?.classList.add('is-hot');
      },
      point: (i) => {
        const p = data[i];
        const lvl = levelFor(p.aqi);
        return {
          x: m.l + (i + 0.5) * step,
          y: y(p.aqi) - 4,
          html: `<span class="tip__when">${f.dateTime(p.ts, tz)} · ${i < nowIdx ? 'lampau' : i === nowIdx ? 'sekarang' : 'prakiraan'}</span>
            <span class="tip__row"><i class="tip__sw lv-${lvl.n}"></i><b>AQI ${p.aqi}</b> ${lvl.short}</span>
            ${p.pm25 != null ? `<span class="tip__sub">PM2.5 ${f.num(p.pm25, 1)} µg/m³</span>` : ''}`,
        };
      },
    });
  });
}

/** Grafik garis arsip stasiun IQAir, dengan pita kategori di latar belakang. */
export function historyChart(el, { points, tz }) {
  return mount(el, (W) => {
    const H = W < 640 ? 220 : 270;
    const m = { t: 14, r: 14, b: 34, l: 38 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const t0 = points[0].ts;
    const span = Math.max(points.at(-1).ts - t0, HOUR);
    const yMax = niceMax(Math.max(...points.map((p) => p.aqi)));
    const x = (ts) => m.l + ((ts - t0) / span) * iw;
    const y = (v) => m.t + ih - (Math.min(v, yMax) / yMax) * ih;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="Grafik arsip indeks AQI dari stasiun IQAir. Gunakan tombol panah untuk menjelajah.">`;
    s += '<g class="bands">';
    for (const l of LEVELS) {
      const lo = l.n === 1 ? 0 : LEVELS[l.n - 2].max;
      if (lo >= yMax) break;
      s += `<rect class="band lv-${l.n}" x="${m.l}" width="${iw}" y="${fx(y(Math.min(l.max, yMax)))}" height="${fx(y(lo) - y(Math.min(l.max, yMax)))}"/>`;
    }
    s += '</g>';
    s += gridLayer(yMax, y, m.l, W - m.r);

    let axis = '<g class="axis">';
    let prevKey = null;
    let lastLabelX = -Infinity;
    for (const p of points) {
      const { key } = f.parts(p.ts, tz);
      if (key !== prevKey) {
        const px = x(p.ts);
        if (prevKey !== null && px - lastLabelX > 48) {
          axis += `<line class="daysep" x1="${fx(px)}" x2="${fx(px)}" y1="${m.t}" y2="${m.t + ih + 6}"/><text class="axis-day" x="${fx(px + 4)}" y="${H - 12}">${f.shortWeekday(p.ts, tz)}</text>`;
          lastLabelX = px;
        }
        prevKey = key;
      }
    }
    s += `${axis}</g>`;

    // Garis terputus bila ada jeda data > 2,5 jam.
    let d = '';
    points.forEach((p, i) => {
      const cmd = i === 0 || p.ts - points[i - 1].ts > 2.5 * HOUR ? 'M' : 'L';
      d += `${cmd}${fx(x(p.ts))} ${fx(y(p.aqi))}`;
    });
    const last = points.at(-1);
    s += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
    s += `<path class="line" d="${d}"/>`;
    s += `<circle class="dot lv-${levelFor(last.aqi).n}" cx="${fx(x(last.ts))}" cy="${fx(y(last.aqi))}" r="6"/>`;
    s += `<g class="cursor" hidden><line y1="${m.t}" y2="${m.t + ih}"/><circle r="6"/></g>`;
    s += `</svg><div class="tip" hidden></div>`;
    el.innerHTML = s;

    const cursor = el.querySelector('.cursor');
    const cLine = cursor.querySelector('line');
    const cDot = cursor.querySelector('circle');
    attachHover(el, {
      W,
      count: points.length,
      initial: points.length - 1,
      indexAt: (px) => {
        const ts = t0 + ((px - m.l) / iw) * span;
        let lo = 0;
        let hi = points.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].ts < ts) lo = mid; else hi = mid; }
        return Math.abs(points[lo].ts - ts) <= Math.abs(points[hi].ts - ts) ? lo : hi;
      },
      onFocus: (i) => {
        cursor.toggleAttribute('hidden', i < 0);
        if (i < 0) return;
        const p = points[i];
        const px = fx(x(p.ts));
        cLine.setAttribute('x1', px);
        cLine.setAttribute('x2', px);
        cDot.setAttribute('cx', px);
        cDot.setAttribute('cy', fx(y(p.aqi)));
        cDot.setAttribute('class', `lv-${levelFor(p.aqi).n}`);
      },
      point: (i) => {
        const p = points[i];
        const lvl = levelFor(p.aqi);
        return {
          x: x(p.ts),
          y: y(p.aqi) - 10,
          html: `<span class="tip__when">${f.dateTime(p.ts, tz)}</span>
            <span class="tip__row"><i class="tip__sw lv-${lvl.n}"></i><b>AQI ${p.aqi}</b> ${lvl.short}</span>`,
        };
      },
    });
  });
}
