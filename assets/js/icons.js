// Ikon garis sederhana (24×24), mewarisi warna teks.

const PATHS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.6-4.6"/>',
  pin: '<path d="M20 10c0 6.5-8 12-8 12s-8-5.5-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v6M12 7.5v.01"/>',
  refresh: '<path d="M21 4v6h-6"/><path d="M20.5 15a8.5 8.5 0 1 1-2-8.8L21 10"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12H4M20 12h2.5M4.2 19.8L6 18M18 6l1.8-1.8"/>',
  moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.8 6.8 0 0 0 10 10z"/>',
  cloud: '<path d="M17.5 19H8a5.5 5.5 0 1 1 1.2-10.9A6 6 0 0 1 20.8 10 4.5 4.5 0 0 1 17.5 19z"/>',
  thermo: '<path d="M14 14.8V4.5a2 2 0 0 0-4 0v10.3a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>',
  droplet: '<path d="M12 2.8l5.7 5.8a8 8 0 1 1-11.4 0z"/>',
  wind: '<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5M3 16h7"/>',
  gauge: '<path d="M3.5 18a9.5 9.5 0 1 1 17 0"/><path d="M12 14l4.5-4.5"/><circle cx="12" cy="14" r="1.2"/>',
  activity: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  mask: '<path d="M4 8.5c3 0 5-2 8-2s5 2 8 2V12c0 4-4 6.5-8 6.5S4 16 4 12z"/><path d="M8 11h8M9 14h6M4 9.5H2M20 9.5h2"/>',
  window: '<rect x="3.5" y="3.5" width="17" height="17"/><path d="M12 3.5v17M3.5 12h17"/>',
  purifier: '<rect x="6" y="2.5" width="12" height="19"/><circle cx="12" cy="10" r="3.5"/><path d="M9.5 17.5h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.6a5 5 0 0 1 3 4.6v1.3"/>',
  heart: '<path d="M20.4 5.1a5 5 0 0 0-7.1 0L12 6.4l-1.3-1.3a5 5 0 0 0-7.1 7.1L12 20.6l8.4-8.4a5 5 0 0 0 0-7.1z"/>',
  archive: '<rect x="2.5" y="3.5" width="19" height="5"/><path d="M4.5 8.5v12h15v-12M10 12.5h4"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2.2"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>',
  layers: '<path d="M12 2.8l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 12.2l9.5 5 9.5-5M2.5 16.6l9.5 5 9.5-5"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="M8 16v-4M12.5 16V8M17 16v-6"/>',
  alert: '<path d="M12 2.8L1.8 20.5h20.4z"/><path d="M12 9.5v5M12 17.4v.01"/>',
  check: '<circle cx="12" cy="12" r="9.5"/><path d="M7.5 12.3l3 3 6-6.3"/>',
  external: '<path d="M14 3.5h6.5V10M20.5 3.5L11 13M18 14v6.5H3.5V6H10"/>',
};

export function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${PATHS[name] ?? ''}</svg>`;
}
