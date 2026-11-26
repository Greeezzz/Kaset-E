# FEATURES-V3 — Mode Kaset (Cassette) dan Lirik

> Dokumen tambahan. Melengkapi `DESIGN-ENDFIELD.md` (gaya, token), `DESIGN-LAYOUT.md` (struktur layar), dan `AGENTS.md` (aturan kerja).
> Status: **rencana**. Dikerjakan **bertahap**, satu tahap per kali, setelah desktop dinyatakan rapi oleh pemilik proyek.
> Cakupan: **dua fitur**: (1) **Cassette Mode**, (2) **Lyrics Mode** (lirik tersinkron, romanisasi, terjemahan opsional). Audio Visualizer **ditunda** (lihat §8).

## 0. Prinsip dan Batasan (WAJIB)

1. **Tidak menyentuh sistem playback.** `src/lib/audio.ts`, resolver, `streamCache`, dan `QueueManager` tidak diubah perilakunya. Satu-satunya tambahan yang diizinkan pada engine: **getter baca-saja** untuk posisi putar (kalau belum ada). Tombol di UI baru memakai **handler yang sama** dengan `PlayerBar`; jangan menduplikasi logika.
2. **Opsional dan modular.** Tiap fitur punya pengaturan sendiri, **default mati** atau netral, dan dimuat malas (`React.lazy`). Kalau dimatikan, tidak ada biaya CPU/RAM.
3. **Ringan.** Animasi hanya jalan saat terlihat dan sedang `playing`. Tidak ada polling konstan. Ukur dampak (CPU saat diam/main, RAM) sebelum dan sesudah tiap tahap, dan laporkan angkanya.
4. **Tanpa server, akun, atau telemetri milik proyek** (`AGENTS.md`). Layanan pihak ketiga hanya boleh **opt-in**, default mati, dengan teks jelas tentang data yang dikirim.
5. **Gaya Kaset.** Hitam-kuning, chamfer, label mono, token dari `tokens.css`; jangan hardcode warna. Semua string lewat `src/lib/strings.ts`. Dua tema (Kertas/Malam) tetap berlaku.
6. **Aset dan referensi (hukum/etika).** Lihat §1. Semua gambar dibuat sendiri (SVG/CSS). **Dilarang** memakai aset, karakter, logo, teks, atau tata letak persis dari gambar referensi.
7. **Nomor migrasi:** `0007` **dicadangkan** untuk perbaikan queue (kontributor lain). Fitur di dokumen ini mulai dari `0008`. Cek nomor terakhir di `src-tauri/migrations/` sebelum membuat migrasi. Jangan mengedit migrasi yang sudah ada.
8. **Verifikasi dependensi** (`AGENTS.md` aturan 4 dan 5): nama pustaka di dokumen ini hanya contoh. Cek versi, pemeliharaan, lisensi, dan ukuran; jangan mengarang API.

## 1. Referensi Visual

Pemilik proyek memberi dua gambar referensi. **Simpan hanya secara lokal** di `docs/ref/` dan tambahkan folder itu ke `.gitignore`: keduanya berhak cipta dan repo ini publik. **Jangan di-commit.**

### Referensi A — Mockup kaset retro (produk komersial pihak lain)
**Diambil (hanya prinsip umum):**
- Anatomi kaset: cangkang persegi panjang bersudut, sekrup di keempat sudut, panel label di bagian atas dengan **judul besar**, strip warna/garis, kode kecil ala "grade pita", penanda **SIDE A/B**.
- Jendela tengah berisi **dua hub reel bergigi** dan jendela pita; bagian bawah berbentuk trapesium dengan lubang.
- Ritme tipografi: judul tebal besar + metadata mono kecil.

**Tidak diambil:** desain label, palet, ilustrasi, tipografi, nama/logo studio, atau berkas PSD apa pun dari produk itu.

### Referensi B — Dek pemutar bergaya antarmuka game (karya berhak cipta)
**Diambil (hanya konsep umum):**
- Metafora **media masuk ke dek** pemutar.
- **Strip layar (LCD)** yang menampilkan satu baris teks, ini dipetakan ke **baris lirik aktif**.
- Tombol `PLAY` dengan segitiga, **LED indikator** kecil, tombol daya, label mono mungil, garis/tick bersegmen.

**Tidak diambil:** karakter, ilustrasi, logo, nama game, teks di dalam gambar, atau komposisi persis. Jangan menyebut Kaset terafiliasi dengan game mana pun (selaras `DESIGN-ENDFIELD.md` §0).

### Adaptasi Kaset
Satu bahasa visual sendiri: **cangkang hitam, label kertas/abu, strip kuning**, sudut chamfer, mono caps. **Label tiap lagu unik** dan dihasilkan deterministik dari `video_id` (pakai ulang pendekatan hash FNV-1a pada `CoverArt.tsx`), jadi tiap lagu punya "kaset" sendiri tanpa aset eksternal.

## 2. Konsep "Kaset Deck"

Layar **Now Playing penuh** (`FullPlayer.tsx`) mendapat mode tampilan. Mode `kaset` menampilkan dek perangkat keras bergaya Kaset:

```
┌─ 03 / SEDANG DIPUTAR ──────────────── SIDE A ─┐
│  ┌────────── KASET (SVG) ───────────────┐     │
│  │ [ JUDUL LAGU        ]   ▐▌ C-60      │     │
│  │ [ artis · durasi    ]                │     │
│  │   (◉)════ jendela pita ════(◉)       │     │
│  └──────────────────────────────────────┘     │
│  ┌ LCD ─────────────────────────────────┐ ● ● ○│
│  │ baris lirik aktif / judul bergulir   │      │
│  └──────────────────────────────────────┘      │
│  02:27  ▮▮▮▮▮▮▮▯▯▯  04:14      ⏮   ▶   ⏭      │
└────────────────────────────────────────────────┘
```

Pemetaan elemen:
| Elemen | Fungsi |
|---|---|
| Label kaset | Judul + artis + durasi (teks nyata, terbaca layar) |
| Dua reel | Berputar saat `playing`, berhenti saat `paused`/`loading`; radius gulungan pita mengikuti progress |
| LCD | Baris lirik aktif (tahap integrasi); tanpa lirik → judul bergulir atau status |
| LED | Kuning = play, redup = pause, berkedip = memuat, satu LED = shuffle |
| Counter mono | `02:27 / 04:14` |
| Tombol | Prev / Play-Pause / Next berbentuk blok chamfer; play paling besar dan kuning |

## 3. FITUR 1 — Cassette Mode (tahap K1–K4)

### K1 — Kerangka mode (belum ada gambar kaset)
- [x] Pengaturan `nowplaying.mode` = `standar` | `kaset` (disimpan di tabel `settings` lewat command yang sudah ada; cek `src/lib/tauri.ts`). Default `standar`.
- [x] Switcher mode di tampilan Now Playing (kontrol kecil, mono caps). Pastikan `FullPlayer` bisa dibuka dari desktop (klik cover di `PlayerBar` atau tombol khusus), bukan hanya di layar sempit.
- [x] Komponen mode dimuat malas. Mode `kaset` awalnya berisi placeholder.
- [x] Menu Pengaturan: bagian "Tampilan" dengan toggle mode.
- **Selesai bila:** mode bisa diganti, tersimpan setelah restart, mode `standar` identik dengan sebelumnya, tidak ada perubahan di `audio.ts`.

### K2 — Gambar kaset (SVG)
- [x] Komponen `KasetSvg`: cangkang, sekrup, panel label (judul/artis/durasi/side), jendela reel dengan dua hub bergigi, jendela pita, bagian bawah trapesium. **Buat sendiri**, tanpa raster.
- [x] **Label generatif deterministik** dari `video_id`: palet terbatas (hitam/kertas/kuning + satu aksen turunan tema), pola strip bervariasi, kode kecil mono. Teks panjang → ellipsis/penskalaan, jangan meluap.
- [x] Dua tema (Kertas/Malam) terbaca baik; kontras teks memenuhi aturan `DESIGN-ENDFIELD.md` §3.
- [x] Opsi `kaset.label` = `generatif` | `cover` (cover lagu mini di label, lewat `useCover`; **jangan** `<img src=ytimg>`).
- **Selesai bila:** kaset tampil rapi untuk judul pendek, sangat panjang, dan karakter non-ASCII (kanji/hangul), di kedua tema.

### K3 — Animasi reel
- [x] Reel berputar saat `status === "playing"`, berhenti saat `paused`/`loading`/`idle`. Gunakan CSS `transform` + `animation-play-state` (di GPU), **bukan** perhitungan JS per frame.
- [x] Radius gulungan pita mengikuti progress (kiri mengecil, kanan membesar). Perbarui **sekitar tiap 1 detik**, bukan tiap frame.
- [x] `prefers-reduced-motion`: tanpa putaran; hanya perubahan radius.
- [x] Hentikan semua animasi saat `document.visibilityState !== "visible"` atau jendela terminimalkan.
- **Selesai bila:** CPU saat memutar dengan mode kaset tidak lebih dari kenaikan kecil dibanding mode standar (laporkan angka), dan animasi berhenti saat disembunyikan.

### K4 — Dek penuh (LCD, LED, tombol)
- [x] Strip LCD (awalnya judul bergulir/status), LED indikator, counter mono, tombol chamfer.
- [x] **Prev/Play/Next memakai handler yang sama** dengan `PlayerBar`. `SeekBar` bersegmen yang ada dipakai ulang.
- [x] Responsif: lebar < 600 px susun vertikal; **target sentuh ≥ 44×44 px** (persiapan Android).
- [x] Aksesibilitas: SVG dekoratif `aria-hidden`; informasi lagu tetap teks yang terbaca pembaca layar; fokus keyboard jelas; kontrol berupa `<button>` asli.
- **Selesai bila:** semua kontrol berfungsi identik dengan mode standar; tidak ada scroll horizontal; keyboard lengkap.

## 4. FITUR 2 — Lyrics Mode (tahap L1–L7)

> Lagu Kaset berasal dari streaming; tidak ada berkas `.lrc` lokal otomatis. Jalur utama adalah **impor manual**; pengambilan otomatis hanya tambahan opt-in.

### L1 — Model data dan parser LRC (Rust, tanpa UI)
- [x] Migrasi baru (mulai `0008`): tabel `lyrics` (`video_id` FK `tracks`, `lrc` TEXT, `sumber` ('impor'|'lrclib'), `offset_ms` INTEGER default 0, `diambil_pada`).
- [x] Modul murni `lyrics/lrc.rs`: parse `[mm:ss.xx]` dan `[mm:ss.xxx]`; **banyak timestamp per baris**; tag `[offset:]`; baris kosong; metadata (`[ti:]`, `[ar:]`) diabaikan; urut menurut waktu; lirik **tanpa timestamp** → ditandai non-sinkron.
- [x] Fungsi cari baris aktif (pencarian biner, O(log n)) dengan memperhitungkan `offset_ms`.
- [x] Command: `lyrics_get`, `lyrics_set_from_text`, `lyrics_delete`, `lyrics_set_offset` (lewat `src/lib/tauri.ts` bertipe; command tipis).
- [x] Tes unit: parser (format valid/tidak valid, multi-timestamp, offset, kosong, BOM), pencarian baris, batas awal/akhir.
- **Selesai bila:** tes hijau; belum ada perubahan UI.

### L2 — Impor manual `.lrc`
- [x] Tombol `IMPOR .LRC` (dialog berkas native lewat `tauri-plugin-dialog` yang sudah ada) dan **drag-drop** ke tampilan lirik.
- [x] Validasi: ukuran maks ±1 MB, UTF-8 (BOM didukung; fallback aman bila bukan UTF-8), tolak berkas tanpa baris yang bisa dibaca dengan pesan ramah.
- [x] Simpan ke DB per `video_id`; tombol hapus lirik.
- **Selesai bila:** impor, hapus, dan pemulihan setelah restart bekerja; berkas rusak tidak membuat app crash.

### L3 — Tampilan lirik tersinkron
- [x] Komponen `LyricsView` (dimuat malas): baris aktif **disorot kuning** (aturan kontras: kuning hanya sebagai latar dengan teks hitam, atau di atas latar gelap), baris lain redup.
- [x] Auto-scroll halus ke baris aktif; berhenti saat pengguna scroll manual, dengan tombol `KEMBALI KE BARIS AKTIF`.
- [x] **Klik baris → seek** ke timestamp baris itu (pakai fungsi seek yang sudah ada, memperhitungkan offset).
- [x] Kontrol offset ±100 ms (tersimpan per lagu).
- [x] **Sinkronisasi hemat:** `requestAnimationFrame` hanya saat tampilan terlihat; baca posisi lewat getter baca-saja `audioEngine`; render ulang **hanya saat indeks baris berubah**.
- [x] Lirik non-sinkron tampil sebagai teks biasa yang bisa di-scroll.
- [x] Keadaan kosong: `LIRIK TIDAK ADA` + tombol impor.
- **Selesai bila:** sorotan tepat pada baris yang sedang dinyanyikan saat memutar, seek lewat klik akurat, dan CPU tidak naik berarti.

### L4 — Tampilan penuh (fullscreen) lirik
- [ ] Tampilan lirik layar penuh yang nyaman dibaca: tipografi besar, kontras tinggi, `Esc` untuk keluar, ukuran font dapat diatur (`lirik.ukuran_font`), mode redup.
- [ ] Kontrol minimal (play/pause, seek, tutup) tetap terjangkau.
- **Selesai bila:** nyaman dibaca dari jarak dekat maupun jauh di kedua tema; keyboard lengkap.

### L5 — LRCLIB (opsional, opt-in)
- [ ] Pengaturan `lirik.lrclib` **default mati**, dengan teks jelas: *judul dan artis lagu dikirim ke lrclib.net*. Tanpa telemetri lain.
- [ ] **Baca dokumentasi resmi LRCLIB** (parameter pencarian, pencocokan berdasarkan durasi, batas penggunaan) sebelum implementasi; jangan mengarang endpoint.
- [ ] Panggilan HTTP dari Rust, dengan throttle, backoff, timeout pendek (pola `RESILIENCE.md`), User-Agent jujur.
- [ ] **Validasi hasil dengan penskoran `import/cocok.rs`** (judul, artis, durasi, penanda versi). Hasil meragukan tidak dipakai otomatis; tawarkan pilihan manual. Lirik versi live/instrumental bukan lirik versi studio.
- [ ] Cache lokal + **cache negatif** ("tidak ada", kedaluwarsa beberapa hari). Ambil **hanya saat tampilan lirik dibuka** untuk lagu itu, bukan tiap lagu diputar.
- [ ] Semua kegagalan jinak: pesan ramah + jalur impor manual.
- **Selesai bila:** dengan opsi mati tidak ada permintaan jaringan sama sekali; dengan opsi nyala, lagu populer terisi dan lagu tidak dikenal gagal dengan jinak.

### L6 — Romanisasi lokal (latin untuk Mandarin, Jepang, Korea)
- [ ] **Deteksi skrip per lagu** (rentang Unicode): ada kana → Jepang; ada Hangul → Korea; hanya Han tanpa kana → Mandarin. Baris campur (Inggris + Asia) hanya segmen CJK yang dikonversi.
- [ ] Romanisasi dikerjakan **lokal di Rust** (deterministik, offline, tanpa AI) sebagai modul murni + tes. Urutan: **Korea** (aturan romanisasi, paling ringan) → **Mandarin** (pinyin, sadar konteks polifon) → **Jepang** (butuh analisis kata + kamus).
- [ ] **Jepang:** kamus berukuran besar tidak dibundel; **diunduh sekali saat fitur diaktifkan** (opt-in), diverifikasi hash, host resmi saja (pola yt-dlp). Cek lisensi dan ukuran pustaka/kamus sebelum dipilih.
- [ ] Hasil turunan disimpan **terpisah** dari LRC asli (tabel `lyrics_turunan`: `video_id`, `jenis`, `bahasa`, isi per baris, terkait indeks baris), sehingga timestamp dan offset tetap satu sumber kebenaran.
- [ ] Tampil sebagai baris kedua (redup, bukan mono kapital), dengan toggle `lirik.tampil_romanisasi`; sorotan kuning berlaku untuk seluruh grup baris.
- [ ] Bahasa lain (Thai, Rusia, Arab, dll.): transliterasi sederhana dengan label bahwa kualitasnya dasar.
- **Catatan akurasi (dokumentasikan di UI/README):** kanji punya banyak bacaan dan lirik sering memakai bacaan non-standar (ateji), jadi romaji otomatis bisa berbeda dari yang dinyanyikan.
- **Selesai bila:** tes per bahasa hijau; lagu Korea/Mandarin/Jepang nyata menampilkan romanisasi yang masuk akal; mematikan opsi menghapus semua beban.

### L7 — Terjemahan (opsional, paling akhir; **tanya pemilik proyek dulu**)
- [ ] Model **BYOK** (pengguna memakai kunci API sendiri), dipanggil langsung dari app, tanpa server proyek. **Keputusan penyimpanan kunci** (keychain OS atau lainnya) harus dikonfirmasi pemilik proyek sebelum implementasi.
- [ ] Default mati; teks jelas bahwa lirik dikirim ke penyedia yang dipilih; label **"terjemahan mesin"**.
- [ ] Cache per (`video_id`, bahasa target); batas kuota/biaya ditampilkan; kegagalan jinak.
- **Selesai bila:** tanpa kunci tidak ada permintaan; dengan kunci terjemahan tampil sebagai baris ketiga yang bisa dimatikan.

## 5. Integrasi Dua Fitur

- [x] **I1 — LCD kaset menampilkan baris lirik aktif** (dan romanisasi bila aktif). Dikerjakan **setelah L3 dan K4** selesai. Tanpa lirik, LCD kembali ke judul bergulir.
- [x] Mode `kaset` dan `lirik` tidak saling bergantung: masing-masing berfungsi sendiri; integrasi hanya menambah.

## 6. Urutan Pengerjaan yang Disarankan

Bergantian agar nilai terlihat cepat, tiap langkah bisa dijalankan dan dites:

```
K1 → K2 → K3        kaset tampil dan berputar (tanpa lirik)
L1 → L2 → L3        lirik: data, impor, tampilan
K4 → I1             dek penuh + lirik di LCD
L4                  lirik layar penuh
L5                  LRCLIB opt-in
L6                  romanisasi (Korea → Mandarin → Jepang)
L7                  terjemahan BYOK (opsional)
```

Berhenti dan laporkan setelah **setiap** tahap; jangan melompat.

## 7. Pengaturan (ringkasan kunci `settings`)

| Kunci | Nilai | Default |
|---|---|---|
| `nowplaying.mode` | `standar` / `kaset` | `standar` |
| `kaset.label` | `generatif` / `cover` | `generatif` |
| `lirik.lrclib` | `0` / `1` | `0` |
| `lirik.tampil_romanisasi` | `0` / `1` | `0` |
| `lirik.ukuran_font` | angka (skala) | sedang |
| `lirik.terjemahan` | `0` / `1` | `0` |

Semua tampil di Pengaturan, dikelompokkan "Tampilan" dan "Lirik", dengan teks privasi yang jelas pada opsi yang memakai jaringan.

## 8. Ditunda — Audio Visualizer

**Tidak dikerjakan** sampai ada keputusan pemilik proyek. Risiko teknis yang harus dibuktikan dulu lewat **spike kecil**:
- Audio diputar lewat `<audio>` dari URL lintas-origin (googlevideo). `createMediaElementSource` pada media lintas-origin tanpa izin CORS menghasilkan **data kosong dan bisa membisukan audio**. Harus dites apakah `crossOrigin` + analyser bekerja **sambil suara tetap terdengar**.
- Jika gagal: proxy stream lokal di Rust (header CORS + range), visualizer dekoratif yang dilabeli jujur, atau jalur lain, **semuanya menyentuh pipeline playback** sehingga butuh persetujuan terpisah.
- Di Android (ExoPlayer) mekanismenya berbeda; desain komponen harus menerima "sumber data frekuensi" abstrak dengan adaptor per platform.
- Syarat kinerja bila dilanjutkan: canvas ≤ 30–60 fps, berhenti saat tersembunyi, `fftSize` kecil, tanpa alokasi array per frame.

## 9. Kinerja, Aksesibilitas, dan Kualitas

- Dampak CPU/RAM diukur dan dilaporkan per tahap (mode mati vs hidup, saat memutar).
- Hormati `prefers-reduced-motion`. Dekorasi `aria-hidden`; informasi penting tidak hanya lewat warna.
- Teks yang dibaca pengguna minimal 14 px (label mono 11–12 px hanya untuk metadata).
- Lint, typecheck, format, dan tes (Rust + frontend) lulus; tes baru untuk parser LRC, pencarian baris, deteksi skrip, dan romanizer.
- Dokumen diperbarui: `MVP.md` (blok "Fase 7 — Mode Tampilan dan Lirik" sesuai tahap di sini), `PROGRESS.md`, README bila perlu.

## 10. Catatan untuk Agent

- Baca berurutan: `AGENTS.md` → `PROGRESS.md` → `MVP.md` → `DESIGN-ENDFIELD.md` → `DESIGN-LAYOUT.md` → dokumen ini.
- **Satu tahap per kali.** Setelah tiap tahap: lapor dengan format di `AGENTS.md` (Selesai / Perubahan / Cara tes / Catatan / Berikutnya), maksimal ±15 baris.
- Jangan mengedit area queue (`queue/mod.rs`, `db/queue.rs`, `commands/queue.rs`) selama kontributor lain mengerjakannya.
- Jangan commit data pribadi, gambar referensi, atau berkas lirik berhak cipta ke repo publik (lirik uji pakai teks buatan sendiri).
- Tanya pemilik proyek jika scope ambigu, terutama: L5 (jaringan), L6 (ukuran kamus), L7 (penyimpanan kunci), dan apa pun yang menyentuh playback.
