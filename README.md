# Warta Udara

Dashboard **kualitas udara & peringatan dini cuaca** bergaya *soft neubrutalism*. Angka AQI utama diambil dari **stasiun pemantau terdekat**, peringatan cuaca dari **BMKG**, dan semuanya di-host **gratis** di GitHub Pages.

## Sumber Data

| Sumber | Dipakai untuk | Cara akses |
|---|---|---|
| [WAQI / aqicn.org](https://aqicn.org/) | **Angka AQI utama** dari stasiun terdekat (pemerintah, Kedubes AS, dan jaringan lain) | Langsung dari browser, butuh token gratis |
| [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api) | Konsentrasi 6 polutan, indeks UV, prakiraan per jam 5 hari, arsip 7 hari, dan cadangan AQI | Langsung dari browser |
| [BMKG Peringatan Dini Cuaca](https://nowcasting.bmkg.go.id/) (RSS nowcast) | Peringatan cuaca ekstrem yang dicocokkan dengan kecamatan | Disalin GitHub Actions setiap 15 menit ke `data/bmkg-nowcast.json` |
| [OpenStreetMap Nominatim](https://nominatim.org/) | Desa, kecamatan, kota, dan provinsi dari koordinat | Langsung dari browser (di-cache, maks. 1 permintaan/detik) |
| [IQAir](https://www.iqair.com/) *(opsional)* | Cadangan data stasiun | GitHub Actions, butuh API key |

Pendukung: Open-Meteo Forecast (cuaca terkini) dan Open-Meteo Geocoding (pencarian kota).

### Urutan sumber angka AQI

1. **Stasiun WAQI terdekat**, bila jaraknya ≤ 15 km (`waqi.maxDistanceKm`) dan datanya berumur ≤ 3 jam.
2. **Stasiun IQAir**, bila diaktifkan dan datanya berumur ≤ 3 jam.
3. **Model Open-Meteo** (Copernicus CAMS, ±40 km) sebagai cadangan terakhir.

Kartu AQI selalu menampilkan sumber yang dipakai, termasuk nama stasiun dan jaraknya. Jika stasiun ditolak (terlalu jauh atau datanya basi), alasannya ikut ditampilkan.

## Cara Publikasi (±10 menit)

### 1. Dapatkan token WAQI (gratis, ±1 menit)
1. Buka <https://aqicn.org/data-platform/token>, isi email dan nama, lalu setujui ketentuannya.
2. Buka tautan konfirmasi di email Anda, dan token akan tampil.
3. Tempel token di [config.json](config.json):
   ```json
   "waqi": { "token": "TOKEN-ANDA", "maxDistanceKm": 15 }
   ```

> Token WAQI memang dirancang untuk dipakai langsung di halaman web, jadi aman berada di repositori publik. Tanpa token, halaman tetap berjalan dengan data model Open-Meteo.

### 2. Unggah proyek ke GitHub
```bash
git init
git add .
git commit -m "Warta Udara: rilis pertama"
git branch -M main
git remote add origin https://github.com/USERNAME/warta-udara.git
git push -u origin main
```

### 3. Aktifkan GitHub Pages
**Settings → Pages**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, lalu Save.
Situs tampil di `https://USERNAME.github.io/warta-udara/` dalam 1–2 menit.

### 4. Aktifkan pembaruan peringatan BMKG (wajib)
1. **Settings → Actions → General → Workflow permissions**, pilih **Read and write permissions**, lalu Save.
2. Buka tab **Actions**, pilih **Perbarui Data**, lalu klik **Run workflow**.

Setelah itu workflow berjalan otomatis setiap 15 menit. Server BMKG tidak mengizinkan akses langsung dari browser (CORS), jadi GitHub Actions menyalin datanya ke repositori.

## Cara Peringatan BMKG Dicocokkan

Setiap peringatan BMKG menautkan dokumen **CAP** yang berisi poligon wilayah, waktu berlaku, dan daftar kecamatan. Urutan pengecekannya:

1. **Tepat di lokasi**: koordinat berada di dalam poligon peringatan.
2. **Kecamatan Anda**: nama kecamatan (dari Nominatim) cocok dan provinsinya sama.
3. **Di sekitar**: tepi poligon berjarak ≤ 25 km.
4. **Provinsi sama**: ditampilkan terpisah sebagai informasi tambahan.

Peringatan yang sudah lewat waktu berlakunya disembunyikan otomatis.

## Mengganti Wilayah

Edit daftar `locations` di [config.json](config.json). Lokasi pertama menjadi lokasi utama.

```json
{ "id": "bandung", "name": "Bandung", "region": "Jawa Barat", "lat": -6.9175, "lon": 107.6191 }
```

- `lat`/`lon` bisa diambil dari Google Maps (klik kanan pada peta, lalu salin koordinat).
- `region` diisi **nama provinsi**, sebagai cadangan pencocokan BMKG.
- Blok `iqair` hanya diperlukan bila Anda memakai IQAir.

Pengunjung juga bisa mencari kota lain atau menekan **Lokasi Saya**.

## Opsional: IQAir

1. Buat API key gratis (paket Community) di <https://dashboard.iqair.com/>.
2. Simpan sebagai repository secret `IQAIR_API_KEY` (**Settings → Secrets and variables → Actions**).
3. Workflow akan mengambil data IQAir setiap jam. Tanpa secret ini, langkah IQAir otomatis dilewati.

## Menjalankan Secara Lokal

Dibutuhkan Node.js 22.9 atau lebih baru.

```bash
npm run bmkg     # ambil peringatan BMKG terbaru
npm run dev      # pratinjau di http://localhost:8080
npm run fetch    # (opsional) data IQAir, butuh IQAIR_API_KEY di berkas .env
```

## Struktur Proyek

```
├── index.html                  Kerangka dashboard
├── config.json                 Token WAQI & daftar lokasi
├── assets/
│   ├── css/style.css           Sistem desain
│   └── js/
│       ├── main.js             Alur data & render
│       ├── waqi.js             Data stasiun WAQI
│       ├── api.js              Klien Open-Meteo
│       ├── bmkg.js             Pemuat peringatan BMKG
│       ├── bmkg-parse.js       Parser RSS/CAP & pencocokan wilayah
│       ├── geo.js              Reverse geocoding Nominatim
│       ├── aqi.js              Skala AQI, polutan, teks saran
│       ├── charts.js           Grafik SVG (tanpa library)
│       ├── format.js           Format tanggal & angka id-ID
│       └── icons.js            Ikon
├── data/                       Ditulis GitHub Actions
├── scripts/                    fetch-bmkg, fetch-iqair, server lokal
└── .github/workflows/          Jadwal pembaruan data
```

## Catatan Akurasi

- **Stasiun vs model:** angka stasiun adalah hasil pengukuran alat, sedangkan model adalah perhitungan. Karena stasiun mengukur satu titik, jarak ke lokasi Anda juga berpengaruh, dan jarak itu selalu ditampilkan.
- **Perhitungan AQI:** WAQI menghitung AQI dari konsentrasi per jam dengan skala US EPA. Open-Meteo memakai rata-rata 24 jam untuk PM. Angka keduanya bisa sedikit berbeda.
- **Rincian polutan:** konsentrasi µg/m³ berasal dari model. Jika stasiun dipakai, sub-indeks AQI stasiun per polutan ikut ditampilkan.
- **Peringatan BMKG:** bisa tampil terlambat ±15–30 menit, karena disalin setiap 15 menit dan jadwal GitHub bisa tertunda.

## Atribusi

- Data stasiun: [World Air Quality Index Project](https://waqi.info/) beserta lembaga pemantau aslinya (ditampilkan di bagian *Tentang Data*)
- Data model: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), © [Copernicus Atmosphere Monitoring Service](https://atmosphere.copernicus.eu/)
- Peringatan cuaca: © [BMKG](https://www.bmkg.go.id/)
- Data wilayah: © kontributor [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL)
- Informasi bersifat indikatif dan tidak menggantikan peringatan resmi BMKG maupun instansi pemerintah.
