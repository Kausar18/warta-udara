// Skala AQI US (EPA), polutan, dan teks saran berbahasa Indonesia.

export const LEVELS = [
  {
    n: 1, min: 0, max: 50,
    label: 'Baik', short: 'Baik',
    advice: 'Udara bersih — waktu yang tepat untuk beraktivitas di luar ruangan.',
    summary: 'Kualitas udara memuaskan; polusi hanya sedikit atau tidak berisiko.',
    general: 'Waktu yang ideal untuk beraktivitas di luar ruangan.',
    sensitive: 'Tidak ada tindakan khusus yang diperlukan.',
  },
  {
    n: 2, min: 51, max: 100,
    label: 'Sedang', short: 'Sedang',
    advice: 'Aman bagi sebagian besar orang. Yang sangat sensitif sebaiknya tidak berolahraga berat terlalu lama.',
    summary: 'Kualitas udara dapat diterima, namun orang yang sangat sensitif mungkin terdampak.',
    general: 'Aktivitas luar ruangan tetap aman bagi sebagian besar orang.',
    sensitive: 'Bila Anda sangat sensitif, kurangi aktivitas berat yang lama di luar ruangan.',
  },
  {
    n: 3, min: 101, max: 150,
    label: 'Tidak Sehat bagi Kelompok Sensitif', short: 'Tak Sehat (Sensitif)',
    advice: 'Kelompok sensitif sebaiknya membatasi aktivitas berat di luar ruangan.',
    summary: 'Kelompok sensitif dapat mengalami gangguan kesehatan; masyarakat umum kemungkinan belum terdampak.',
    general: 'Masih boleh beraktivitas, tetapi waspadai gejala seperti batuk, mata perih, atau sesak.',
    sensitive: 'Anak-anak, lansia, ibu hamil, serta penderita asma dan penyakit jantung sebaiknya membatasi aktivitas berat di luar.',
  },
  {
    n: 4, min: 151, max: 200,
    label: 'Tidak Sehat', short: 'Tidak Sehat',
    advice: 'Kurangi aktivitas di luar ruangan dan kenakan masker saat bepergian.',
    summary: 'Setiap orang mulai merasakan dampak kesehatan; kelompok sensitif bisa mengalami efek lebih serius.',
    general: 'Kurangi aktivitas berat di luar ruangan dan kenakan masker saat bepergian.',
    sensitive: 'Hindari aktivitas di luar ruangan; tetap di dalam dengan jendela tertutup.',
  },
  {
    n: 5, min: 201, max: 300,
    label: 'Sangat Tidak Sehat', short: 'Sangat Tak Sehat',
    advice: 'Hindari aktivitas di luar ruangan. Gunakan masker N95/KN95 bila harus keluar.',
    summary: 'Peringatan kesehatan: risiko dampak kesehatan meningkat bagi semua orang.',
    general: 'Hindari aktivitas di luar ruangan; gunakan masker N95/KN95 bila terpaksa keluar.',
    sensitive: 'Tetap di dalam ruangan dan jalankan pemurni udara.',
  },
  {
    n: 6, min: 301, max: 500,
    label: 'Berbahaya', short: 'Berbahaya',
    advice: 'Tetap di dalam ruangan, tutup ventilasi, dan ikuti arahan otoritas setempat.',
    summary: 'Kondisi darurat kesehatan: seluruh populasi kemungkinan besar terdampak.',
    general: 'Tetap di dalam ruangan, tutup semua ventilasi, dan ikuti arahan otoritas setempat.',
    sensitive: 'Tetap di dalam ruangan dan segera cari bantuan medis bila muncul gejala.',
  },
];

export function levelFor(aqi) {
  const v = Math.max(0, Math.round(aqi ?? 0));
  return LEVELS.find((l) => v <= l.max) ?? LEVELS[LEVELS.length - 1];
}

/** Posisi 0..1 pada skala 6 segmen yang sama lebar. */
export function scalePosition(aqi) {
  const v = Math.min(500, Math.max(0, aqi ?? 0));
  const i = LEVELS.findIndex((l) => v <= l.max);
  const lo = i === 0 ? 0 : LEVELS[i - 1].max;
  return (i + (v - lo) / (LEVELS[i].max - lo)) / LEVELS.length;
}

// Pedoman kualitas udara WHO 2021 (µg/m³).
export const POLLUTANTS = {
  pm2_5: {
    label: 'PM2.5', html: 'PM<sub>2.5</sub>', name: 'Partikel halus', unit: 'µg/m³', who: 15, whoPeriod: '24 jam',
    desc: 'Partikel ≤2,5 mikrometer dari asap kendaraan, industri, dan pembakaran. Mampu menembus paru-paru hingga aliran darah.',
  },
  pm10: {
    label: 'PM10', html: 'PM<sub>10</sub>', name: 'Partikel kasar', unit: 'µg/m³', who: 45, whoPeriod: '24 jam',
    desc: 'Debu jalan, konstruksi, dan tanah. Mengiritasi mata, hidung, serta tenggorokan.',
  },
  ozone: {
    label: 'O₃', html: 'O<sub>3</sub>', name: 'Ozon permukaan', unit: 'µg/m³', who: 100, whoPeriod: '8 jam',
    desc: 'Terbentuk saat emisi kendaraan bereaksi dengan sinar matahari. Memicu sesak napas dan serangan asma.',
  },
  nitrogen_dioxide: {
    label: 'NO₂', html: 'NO<sub>2</sub>', name: 'Nitrogen dioksida', unit: 'µg/m³', who: 25, whoPeriod: '24 jam',
    desc: 'Gas dari knalpot dan pembangkit listrik. Menyebabkan peradangan pada saluran napas.',
  },
  sulphur_dioxide: {
    label: 'SO₂', html: 'SO<sub>2</sub>', name: 'Sulfur dioksida', unit: 'µg/m³', who: 40, whoPeriod: '24 jam',
    desc: 'Gas berbau tajam dari pembakaran batu bara dan minyak. Menyempitkan saluran napas penderita asma.',
  },
  carbon_monoxide: {
    label: 'CO', html: 'CO', name: 'Karbon monoksida', unit: 'µg/m³', who: 4000, whoPeriod: '24 jam',
    desc: 'Gas tak berwarna dan tak berbau dari pembakaran tidak sempurna. Menghambat darah mengangkut oksigen.',
  },
};

export const POLLUTANT_ORDER = ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide', 'sulphur_dioxide', 'carbon_monoxide'];

// Kode polutan utama dari IQAir → kunci internal.
export const IQAIR_MAIN = {
  p2: 'pm2_5', p1: 'pm10', o3: 'ozone', n2: 'nitrogen_dioxide', s2: 'sulphur_dioxide', co: 'carbon_monoxide',
};

/** Polutan dengan sub-indeks AQI tertinggi dari objek `current` Open-Meteo. */
export function dominantPollutant(current) {
  if (!current) return null;
  let best = null;
  for (const k of POLLUTANT_ORDER) {
    const v = current[`us_aqi_${k}`];
    if (v != null && (best == null || v > current[`us_aqi_${best}`])) best = k;
  }
  return best;
}

const TONE = { ok: 'ok', warn: 'warn', bad: 'bad' };

export const TIPS = [
  {
    icon: 'activity', title: 'Aktivitas luar',
    texts: ['Silakan berolahraga di luar', 'Aman berolahraga di luar', 'Kelompok sensitif kurangi olahraga di luar', 'Pindahkan olahraga ke dalam ruangan', 'Hindari olahraga di luar', 'Jangan beraktivitas di luar'],
    tones: [TONE.ok, TONE.ok, TONE.warn, TONE.bad, TONE.bad, TONE.bad],
  },
  {
    icon: 'mask', title: 'Masker',
    texts: ['Masker tidak diperlukan', 'Masker belum diperlukan', 'Kelompok sensitif pakai masker', 'Pakai masker saat di luar', 'Wajib masker N95/KN95', 'Wajib masker N95/KN95'],
    tones: [TONE.ok, TONE.ok, TONE.warn, TONE.bad, TONE.bad, TONE.bad],
  },
  {
    icon: 'window', title: 'Jendela',
    texts: ['Buka jendela, biarkan udara segar masuk', 'Buka jendela seperlunya', 'Tutup jendela untuk menahan polusi', 'Tutup jendela', 'Tutup jendela & ventilasi', 'Tutup rapat semua ventilasi'],
    tones: [TONE.ok, TONE.ok, TONE.warn, TONE.bad, TONE.bad, TONE.bad],
  },
  {
    icon: 'purifier', title: 'Pemurni udara',
    texts: ['Tidak diperlukan', 'Belum diperlukan', 'Nyalakan bila ada', 'Nyalakan pemurni udara', 'Nyalakan pemurni udara', 'Nyalakan pada setelan tinggi'],
    tones: [TONE.ok, TONE.ok, TONE.warn, TONE.bad, TONE.bad, TONE.bad],
  },
];

const IQAIR_ICON = {
  '01': 'Cerah', '02': 'Cerah berawan', '03': 'Berawan', '04': 'Mendung',
  '09': 'Gerimis', '10': 'Hujan', '11': 'Badai petir', '13': 'Salju', '50': 'Berkabut',
};
export const iqairWeather = (ic) => IQAIR_ICON[String(ic ?? '').slice(0, 2)] ?? '—';

export function wmoWeather(code) {
  if (code == null) return '—';
  if (code === 0) return 'Cerah';
  if (code === 1) return 'Cerah berawan';
  if (code === 2) return 'Berawan sebagian';
  if (code === 3) return 'Mendung';
  if (code === 45 || code === 48) return 'Berkabut';
  if (code >= 51 && code <= 57) return 'Gerimis';
  if (code >= 61 && code <= 67) return 'Hujan';
  if (code >= 71 && code <= 77) return 'Salju';
  if (code >= 80 && code <= 82) return 'Hujan lokal';
  if (code === 85 || code === 86) return 'Hujan salju';
  if (code >= 95) return 'Badai petir';
  return '—';
}

const COMPASS = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const compass = (deg) => (deg == null ? '—' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]);

export function uvLabel(uv) {
  if (uv == null) return '';
  if (uv < 3) return 'Rendah';
  if (uv < 6) return 'Sedang';
  if (uv < 8) return 'Tinggi';
  if (uv < 11) return 'Sangat tinggi';
  return 'Ekstrem';
}
