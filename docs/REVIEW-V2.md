# REVIEW — Dokumen V2 (FEATURES-V2 & DESIGN-ENDFIELD)

Catatan review atas `FEATURES-V2.md` dan `DESIGN-ENDFIELD.md`. Ditulis setelah memverifikasi langsung ke kode, database nyata, dan dokumentasi resmi Spotify. Ini **bukan** pengganti dua dokumen itu — ini yang perlu diputuskan sebelum Fase 4 dikerjakan.

## 1. Blocker: tabel `tracks` kosong (dampak ke Fase 1, 4, dan 5)

**Terverifikasi pada database nyata**, bukan dugaan:

```
tables: [..., 'tracks', ...]
baris tracks: 0
CREATE TABLE listen_events (... REFERENCES tracks(video_id) ...)
INSERT ke listen_events: GAGAL -> FOREIGN KEY constraint failed
```

Hasil pencarian hidup di memori saja; tidak ada satu pun jalur kode yang menulis ke `tracks` (`grep "INSERT INTO tracks"` → 0 hasil). Padahal FK ke `tracks` dipakai oleh:

| Tabel | Dipakai oleh |
|-------|--------------|
| `listen_events` (Fase 4) | Stats |
| `favorites` (Fase 1) | Library |
| `history` (Fase 1) | Library |
| `queue_items` (Fase 1) | Simpan/pulihkan queue |
| `playlist_tracks` (Fase 1) | Playlist |

Artinya `FEATURES-V2.md` §0 ("jangan mulai sebelum Fase 1 selesai") sudah benar sebagai aturan, tapi **Fase 1 sendiri tidak akan selesai** tanpa upsert `tracks`. Ini harus dikerjakan lebih dulu, bukan sebagai bagian dari Fase 4.

Rekomendasi: satu fungsi `ensure_track(&Track)` yang melakukan `INSERT ... ON CONFLICT(video_id) DO UPDATE`, dipanggil sebelum menulis baris apa pun yang mereferensikan lagu (play, favorit, tambah ke queue, tambah ke playlist).

## 2. Timezone — KEPUTUSAN: ikut zona waktu perangkat

**Diputuskan: pakai zona waktu perangkat (bawaan OS). Tidak ada pengaturan manual di UI.**

Alasannya: aplikasi ini dipakai satu orang di satu perangkat, jadi zona waktu perangkat hampir selalu benar. Dropdown zona waktu hanya menambah beban tanpa manfaat nyata.

Yang terpengaruh kalau ini diabaikan: **heatmap 24 jam** (jam harus jam lokal) dan **streak harian** (batas "hari" harus tengah malam lokal, bukan UTC). Di WIB (UTC+7), mendengar jam 06:00 akan dihitung sebagai hari sebelumnya kalau pakai UTC.

Cara teknis:

- `started_at` tetap **epoch ms (UTC)**; database tetap UTC murni. Jangan simpan zona waktu di dalam baris event.
- Saat query, zona waktu dibaca dari perangkat **saat itu juga** (`new Date().getTimezoneOffset()` dikirim frontend, atau dihitung Rust dari proses).
- Heatmap: `strftime('%H', started_at/1000, 'unixepoch')` lalu digeser dengan offset perangkat. Modifier `'localtime'` SQLite juga bisa dipakai, tapi ia membaca zona waktu proses — untuk hasil yang konsisten, hitung agregat di Rust dengan offset yang dibaca sekali per query.
- Batas hari untuk streak memakai tengah malam lokal.

**Batasan yang diterima:** kalau pengguna berpindah zona waktu, statistik "hari" untuk data lama bisa terasa bergeser. Untuk proyek pribadi ini tidak sepadan dikomplekskan dengan menyimpan zona per event.

## 3. Aturan "delta > 2 detik = seek" berisiko mengorupsi metrik utama

§1.3 benar bahwa seek tidak boleh dihitung, tapi ambang tetap 2 detik berbahaya di webview: saat jendela tidak fokus atau (nanti di Android) layar mati, `timeupdate` bisa jarang — delta **normal** bisa 3–5 detik dan akan dibuang. Akibatnya `listened_ms` terlalu kecil, dan justru metrik "total waktu mendengar" yang rusak.

Saran: bandingkan tick dengan jam dinding (`Instant`/`performance.now()`), bukan ambang tetap. Delta dianggap seek hanya jika **posisi audio melompat lebih jauh daripada waktu nyata yang lewat** (mis. lompat 30 detik padahal baru 2 detik berlalu). Itu definisi seek yang benar dan tahan terhadap tick jarang.

Catatan tambahan: webview Tauri hanya mengekspos `timeupdate` (event berbasis DOM), jadi pengukuran harus dilakukan di sisi frontend lalu dikirim ke Rust — atau Rust menghitung delta dari event posisi yang sudah ada. Jangan berasumsi ada callback frame-level dari sisi Rust.

## 4. Timezone — KEPUTUSAN: ikut zona waktu perangkat

**Diputuskan: pakai zona waktu perangkat (bawaan OS), tidak ada pengaturan manual di UI.**

Alasannya: aplikasi ini dipakai satu orang di satu perangkat, jadi zona waktu perangkat hampir selalu benar. Menambah dropdown zona waktu hanya menambah beban tanpa manfaat nyata.

Cara teknis:

- `started_at` tetap disimpan sebagai **epoch ms (UTC)** — aman, stabil, dan bisa dibandingkan lintas perangkat.
- **Zona waktu tidak disimpan di database.** Database tetap UTC murni.
- Saat menulis event, frontend mengirim juga `tz_offset_min` (dari `new Date().getTimezoneOffset()`).
- Zona waktu untuk query diambil dari perangkat **saat query dijalankan**, bukan dari event. Jadi kalau pengguna pindah zona waktu lalu membuka Stats, semua angka langsung masuk akal untuk lokasi saat itu.
- Heatmap 24 jam dan streak harian memakai batas tengah malam **lokal**, bukan UTC.

**Satu batasan yang perlu disadari:** kalau pengguna sering berpindah zona waktu (mis. perjalanan), statistik "hari" bisa terasa bergeser untuk hari-hari lama. Ini diterima — proyek pribadi, dan alternatifnya (menyimpan zona per event) menambah kompleksitas yang tidak sepadan.

Implementasi di SQLite: `strftime('%H', started_at/1000, 'unixepoch', 'localtime')` untuk heatmap, dan tanggal lokal lewat modifier `'localtime'` yang sama. **Penting:** modifier `'localtime'` SQLite memakai zona waktu proses; untuk konsistensi, hitung agregat di Rust dengan zona waktu yang dibaca sekali saat query.

## 4. Import: pakai pihak ketiga (KEPUTUSAN)

**Diputuskan: import lewat pihak ketiga, tapi tetap lewat file — bukan API langsung.**

Alasannya sudah diverifikasi ke dokumentasi resmi Spotify (lihat §5): API-nya tidak bisa dipakai untuk proyek seperti ini. Jadi bentuk "pihak ketiga" yang benar adalah:

1. Pengguna memakai layanan pihak ketiga (mis. **TuneMyMusic**, **Soundiiz**, atau ekspor CSV dari aplikasi lain) untuk mengubah playlist Spotify/Apple Music/Deezer menjadi **file CSV atau JSON**.
2. Kaset membaca file itu lewat importer generik (`FEATURES-V2.md` §3.3) — tidak perlu tahu asalnya dari mana.

Keuntungan pendekatan ini: nol API key, nol token tersimpan, nol risiko akun, dan satu kode importer bisa menerima ekspor dari sumber mana pun. Ini juga yang membuat `AGENTS.md` aman ("jangan menyimpan token pihak ketiga di repo").

Yang **tidak** dilakukan: integrasi API langsung ke layanan musik lain. Itu akan melanggar batasan di `AGENTS.md` dan bergantung pada kebijakan API yang terus berubah.

Konsekuensi UX yang harus diterima: pengguna perlu satu langkah di luar aplikasi (ekspor di browser). Untuk mengurangi gesekan, sediakan tautan bantuan + penjelasan singkat di layar Import.

Satu pengecualian yang tetap diizinkan: **import dari link playlist YouTube Music publik**, karena itu katalog yang memang kita pakai sendiri (bukan layanan pihak ketiga).

## 5. Verifikasi Spotify: dokumen sudah benar

Dicek ke dokumentasi resmi:

- Development mode: owner **wajib Premium**; maksimum **5 user** per app; 1 Client ID.
- Extended quota: **hanya organisasi**, minimum **250k MAU**, tersedia di pasar utama.
- Juli 2026: batas Client ID naik ke 25 (batas **user tetap 5**).

Kesimpulan §3.2 ("tidak praktis") valid dan bahkan lebih kuat sekarang. Yang bagus: dokumen sudah menulis "verifikasi lagi aturan terbaru" — angka-angka ini memang bergerak. Jalur CSV/JSON sebagai default adalah keputusan yang tepat.

## 6. DESIGN-ENDFIELD: catatan penerapan

- **Kuning #FFE600 di elemen yang selalu terlihat melelahkan mata.** Aturan kontrasnya sudah benar (kuning hanya latar + teks hitam), tapi perhatikan: player bar dan item queue aktif *selalu* ada di layar. Saran: kuning penuh hanya untuk keadaan benar-benar aktif (lagu yang sedang diputar, tombol utama), dan aksen yang lebih redup untuk penanda pasif.
- **JANGAN memakai teks kuning di latar terang.** Ini bukan teori — sudah terjadi saat token Endfield pertama dipasang: Sidebar, BottomNav, dan Library memakai `color: var(--accent)` untuk item aktif, dan di tema terang "Terminal Kertas" teksnya nyaris tak terbaca (kuning di atas abu kertas). Pola yang benar sudah diterapkan: **item aktif = blok kuning + teks `--accent-ink` (hitam)**, dan item baris aktif di daftar ditandai garis kuning di tepi kiri (`box-shadow: inset 3px 0 0`), bukan warna teks.
- **Kontras tombol play**: di tema terang, tombol play di player bar sekarang blok kuning + teks hitam; di keadaan nonaktif pakai outline + `--ink-muted` (bukan `--accent` yang kontrasnya gagal).
- **`clip-path` memotong border di sudut chamfer** — dokumen sudah menangkap ini di §5.1. Tambahan praktis: untuk garis tegas di sudut potong, cara termurah adalah pseudo-element dengan `transform: skew()` atau SVG `polyline` kecil, bukan `clip-path` bersarang.
- **Font self-host, jangan CDN** — penting dan sudah ditulis. Barlow/Oswald/IBM Plex semuanya OFL, aman. Catatan: Barlow Condensed tidak punya varian italic lengkap, jadi jangan bergantung pada italic untuk `--font-display`.
- **Urutan penerapan §12 sudah benar.** Tambahan: kerjakan lewat `npm run dev` (mock) dulu — itu sebabnya `src/lib/tauri.ts` punya fallback mock.

## 6b. Status migrasi desain

Sudah dikerjakan:

- `src/styles/tokens.css` — token Endfield lengkap, dua tema via `data-theme`, plus **alias nama lama** (`--surface`, `--text`, `--border`, `--r-*`) supaya komponen yang belum dimigrasi tidak rusak. Hapus alias itu setelah semua komponen pindah.
- `src/styles/global.css` — latar grid halus, `.panel` (chamfer), `.bracketed` (corner brackets), `.hazard`, `.label` (mono teknis), `prefers-reduced-motion`.
- Font self-host lewat `@fontsource/barlow-condensed`, `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` (bukan CDN). Diimpor di `src/main.tsx`, hanya bobot yang dipakai.
- `src/lib/theme.ts` — toggle tema, tersimpan di `localStorage`, default ikut preferensi sistem; diterapkan sebelum render pertama supaya tidak kedip. Terverifikasi: light → `#e8e8e2`, dark → `#0f1011`, dua arah bekerja dan tersimpan.
- Kontras diperbaiki di Sidebar, BottomNav, Library, TrackRow, MiniPlayer, PlayerBar.

Belum dikerjakan: set ikon garis 1.5px (UI masih pakai glyph teks `▶ ❙❙ ✕ ⌄`), PlayerBar belum jadi "control deck" penuh dengan progress bersegmen, dan panel queue belum pakai kepala sistem (`02 / QUEUE — 12 ITEMS`).

## 7. Yang tidak bisa dikerjakan agent: `AGENTS.md`

Patch §4 menargetkan `docs/AGENTS.md`, dan file itu **dilindungi** oleh konfigurasi Hermes (agent tidak boleh menulis file instruksi agent). Tambahan untuk AGENTS.md harus kamu terapkan manual, atau dipindahkan ke dokumen lain. Isi yang disarankan:

```
## Batasan Penting (tambahan)
- Jangan mengerjakan fitur di FEATURES-V2.md sebelum item Fase 1 di MVP.md tercentang semua.
- Jangan memakai logo, nama, karakter, ikon, font berlisensi, atau aset apa pun dari
  game/produk yang menginspirasi DESIGN-ENDFIELD.md. Semua aset dibuat sendiri atau
  berlisensi terbuka.
- Jangan menyimpan token/kredensial pihak ketiga di repo atau di SQLite polos.
- Jangan menambahkan integrasi API langsung ke layanan musik lain tanpa persetujuan
  pemilik proyek; jalur default import adalah file CSV/JSON.

## Hal yang Perlu Ditanyakan ke Pemilik Proyek (tambahan)
- Tema default (terang atau gelap) dan apakah toggle tema dibutuhkan sejak awal
- Ambang pencocokan import (0.85 / 0.60) setelah uji dengan playlist nyata
- Apakah Smart Shuffle Tingkat B (sisipan rekomendasi) mau dikerjakan
```

## 8. Arah desain: Endfield menggantikan estetika Manga Mincho

**Diputuskan pemilik proyek: `DESIGN-ENDFIELD.md` sengaja menggantikan arah visual sebelumnya**, bukan digabung. Estetika Japanese Manga Mincho (Shippori Mincho, palet dusty blue/lavender) **tidak dipakai** untuk Kaset.

Konsekuensinya, yang harus diganti:

- `src/styles/tokens.css` — token warna dan font lama masih memakai palet manga. Ganti dengan token di `DESIGN-ENDFIELD.md` §3, termasuk dua tema (`light` default "Terminal Kertas", `dark` "Terminal Malam").
- `--font-display`, `--font-body`, `--font-mono` harus berpindah ke Barlow Condensed / IBM Plex Sans / IBM Plex Mono, dan font-nya **self-host** (jangan CDN).
- Ikon: perlu set ikon garis 1.5px bersudut tegas (belum ada — sekarang UI masih memakai glyph teks seperti `▶`, `❙❙`, `✕`, `⌄`). Ganti bertahap, mulai dari transport control di PlayerBar.
- `radius` lama (`--r-sm/md/lg`) diganti pendekatan **chamfer** (`--cut-sm/md/lg` + `clip-path`).
- Komponen dasar dulu (`Panel`, `Button`, `TrackRow`, `CoverArt`), lalu `PlayerBar` + progress bersegmen, terakhir Sidebar/BottomNav dan layar Stats/Import — sesuai urutan §12 dokumen itu.

Catatan yang sudah ditulis di §6: kuning `#FFE600` di elemen yang selalu terlihat (player bar, item aktif) cepat melelahkan mata. Pakai kuning penuh hanya untuk keadaan benar-benar aktif; turunkan ke aksen redup untuk penanda pasif.
