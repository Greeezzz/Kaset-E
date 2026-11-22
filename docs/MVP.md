# MVP — Kaset

Tujuan MVP: **bisa cari lagu, putar tanpa iklan, kelola queue, di desktop dulu.** Android menyusul di fase berikutnya, tapi arsitektur dari awal harus siap.

## Prinsip

1. Desktop dulu, Android kemudian.
2. Tanpa server, tanpa akun, tanpa sync.
3. Kalau ragu, potong fitur.
4. Setiap fase harus menghasilkan sesuatu yang bisa dijalankan.

## Fase 0 — Fondasi — SELESAI

- [x] Inisialisasi project Tauri 2 + React + TypeScript + Vite
- [x] Setup linting/format: `clippy`, `rustfmt`, ESLint, Prettier
- [x] Setup SQLite + migrasi awal
- [x] Definisikan trait `StreamResolver` dan `MusicCatalog` (belum ada implementasi nyata, cukup mock)
- [x] CI sederhana: build + lint di setiap push
- [x] Skema tabel `settings` + helper akses

Verifikasi Fase 0 (semua lulus lokal): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` (5 tes), `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, `npx tauri build --no-bundle`.

Catatan implementasi yang menyimpang dari dokumen asli:

- Migrasi ada dua (`0001_init`, `0002_covers`) karena cover art ditambahkan sebagai kebutuhan offline-first, bukan backlog — lihat `THUMBNAILS.md`.
- `src/lib/tauri.ts` punya fallback mock supaya `npm run dev` jalan di browser tanpa Rust. Ini keputusan sengaja: mempercepat kerja UI tanpa menunggu kompilasi.
- Pelajaran build Windows dan jebakan Tauri 2 ada di `SETUP.md`.


## Fase 1 — Desktop MVP (target `v0.1.0`)

**Search**
- [x] Kotak pencarian (UI) + state loading/empty
- [x] Koneksi ke `MusicCatalog` mock, hasil lagu tampil di list
- [x] `MusicCatalog` nyata: hanya endpoint pencarian lagu (bukan album/artis)
- [x] Saran pencarian (suggestions) — riwayat lokal tampil lebih dulu, lalu saran katalog dengan debounce 250 ms; jawaban basi dibuang, keyboard (panah/Enter/Escape) didukung
- [x] History pencarian lokal — tabel `search_history` (migrasi `0003`), normalisasi `query_norm` supaya tidak ada duplikat, hitungan `hits`, hapus per entri / semua, dipangkas ke 100
- [x] Empty state + pesan error saat pencarian gagal

Catatan Fase 1 Search: katalog di-upgrade di background saat app start, jadi
aplikasi tidak pernah menunggu jaringan untuk membuka jendela. Kalau offline,
mock tetap dipakai dan Settings menampilkan "Mock (contoh)".

**Playback**
- [x] Kontrak `StreamResolver` + mock yang bisa disuruh gagal (untuk tes backoff)
- [x] `StreamResolver` nyata: resolve satu `video_id` → URL audio + `expires_at`
- [x] Engine audio desktop: `load` + `play` + `seek` + `setVolume` (API engine lengkap)
- [x] Pause
- [x] Event posisi berkala ke UI
- [x] Auto-lanjut ke item queue berikutnya saat `Ended` (repeat off/one/all ikut dihormati)
- [x] Resolve ulang otomatis saat URL kedaluwarsa / error 403
- [x] Backoff + klasifikasi error + circuit breaker (lihat `RESILIENCE.md`)
- [x] Handle tombol Next/Prev dengan coalescing request — coalescing per `video_id` di `streamCache` (dua klik lagu sama = satu resolve) + throttle 1,5 detik di resolver
- [x] Slider seek & volume di UI — bar seek bisa diklik/drag/keyboard (panah 5 detik, Shift+panah 30 detik, Home/End), volume slider + tombol bisu, dan volume tersimpan lintas restart

Catatan Fase 1 Playback — keputusan yang diambil dari uji nyata:

- **Extractor: `yt-dlp` eksternal, bukan crate.** `rusty_ytdl` 0.7.4 diuji langsung dan mengembalikan 22 format tanpa satu pun URL (`url_len=0`) — crate itu sudah kalah oleh perubahan YouTube. yt-dlp berhasil. Binary TIDAK dibundel (AGENTS.md); aplikasi mencari `yt-dlp` di PATH atau lewat env `KASET_YTDLP_PATH`. Kalau tidak ada, resolver jatuh ke mock dan pemutaran dinonaktifkan dengan pesan jelas.
- **Engine audio: `<audio>` di webview**, bukan `rodio`. Ini opsi yang ARCHITECTURE.md §10 izinkan sebagai "yang lebih cepat jadi". Terbukti memutar webm/opus dari googlevideo.
- **Dua bug yang ditemukan lewat uji end-to-end** dan sudah diperbaiki + dikunci test: (1) `crossOrigin="anonymous"` membuat Chromium menolak audio karena googlevideo tidak mengirim CORS; (2) CSP tidak punya `media-src` sehingga `default-src 'self'` memblokir domain audio. Detail di `SETUP.md`.
- **Klasifikasi error permanen** harus toleran kata sisipan: yt-dlp menulis "This video is unavailable", bukan "Video unavailable". Salah klasifikasi = satu video rusak membuka circuit breaker dan mematikan semua pemutaran. Ada test regresi untuk ini.
- **Tiga bug pemulihan stream** yang hanya muncul saat aplikasi dijalankan, bukan saat membaca kode: (1) posisi pemulihan selalu 0 karena elemen memicu `timeupdate` 0 ketika sumber gagal — pencatatan posisi dipindah ke engine dengan syarat `readyState>=2 && !error && !paused`; (2) pemulihan tidak pernah jalan karena `play()` menangkap penolakan dan mengirim kode `null`, sehingga MediaError 4 yang asli tertutupi; (3) pemulihan tanpa batas percobaan bisa jadi loop resolve — sekarang satu percobaan per kegagalan per lagu.
- **Jendela konsol Windows**: tanpa `CREATE_NO_WINDOW`, setiap resolve yt-dlp memunculkan jendela cmd sekejap karena proses anak dibuat sebagai proses konsol baru. Diverifikasi: hitungan `cmd.exe` tetap sama sebelum dan sesudah memutar lagu.

**Cover Art**
- [x] Skema tabel `covers` (migrasi `0002_covers.sql`)
- [x] Command `cover_get` + placeholder generatif deterministik (FNV-1a, `CoverArt.tsx`)
- [x] Job unduh background dengan tangga kualitas (lihat `THUMBNAILS.md`)
- [x] Crop tengah 1:1 komponen `CoverArt` (object-fit: cover)
- [x] Event `cover://ready` menggantikan placeholder tanpa reload
- [x] Eviction LRU + batas ukuran

Catatan Fase 1 Cover Art — dua bug yang hanya ketemu saat dijalankan:

- **Titik dua di nama file.** Kunci cover berbentuk `v:<video_id>`, dan `:` ilegal di Windows. `fs::write` selalu gagal tapi kegagalannya ditelan `continue` — akibatnya keempat tangga kualitas dicoba, gambar 190 KB sebenarnya sudah terunduh lalu dibuang, dan hasil akhirnya `error`. Sekarang kunci dipetakan ke nama aman (`v-<video_id>.jpg`) dan ada unit test regresi.
- **Kegagalan tanpa log.** Setiap cabang gagal kini mencatat url, status, ukuran, dan magic bytes; sebelumnya penyebabnya tidak terlihat sama sekali sehingga diagnosis butuh tebak-tebakan.

**Queue**
- [x] Model `QueueItem` (+ kolom `original_order` di skema)
- [x] Add to queue, play next, remove, clear
- [x] Drag-reorder di UI (HTML5 drag, tanpa dependensi)
- [x] Shuffle non-destruktif (kolom `original_order`) + unit test
- [x] Repeat off/one/all + unit test
- [x] Simpan dan pulihkan queue saat app dibuka

**Library minimal**
- [x] CRUD playlist lokal (buat, ganti nama, hapus)
- [x] Tambah/hapus lagu dari playlist
- [x] Favorit (toggle)
- [x] History (catat + tampilkan daftar)

**Desktop polish**
- [x] Media key lewat plugin `tauri-plugin-global-shortcut` (`MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious`, khusus `#[cfg(desktop)]`)
- [x] Tray icon (monokrom) + menu dasar (`Buka Kaset`, `Putar / Jeda`, `Berikutnya`, `Sebelumnya`, `Keluar`, klik kiri fokus jendela)
- [x] Export/import JSON library (`export_library`, `import_library` non-destruktif + UI di Pengaturan)

**Kriteria selesai Fase 1:** bisa dipakai seharian di desktop tanpa iklan, queue dan playlist tersimpan setelah app ditutup.

**Status Fase 1: 35/35 item (100% — SELESAI).** Target `v0.1.0` siap ditandai.

**Desain Endfield sudah jalan** — dua tema (Terminal Kertas / Terminal Malam), font self-host, grid halus, chamfer, kontras terverifikasi (aktif = blok kuning + teks hitam). Ini tidak masuk checklist di atas karena `DESIGN-ENDFIELD.md` menggantikan arah visual lama; dicatat di sini supaya tidak dikira belum dikerjakan.

### Redesign Layout (`DESIGN-LAYOUT.md`) — 8 dari 10 langkah

Pekerjaan terpisah dari checklist Fase 1 di atas, tapi memakai komponen dan
database yang sama. Satu langkah = satu commit yang bisa dijalankan.

- [x] **Langkah 1** — bug layout yang diketahui: status `idle` tidak bocor ke layar, lagu aktif tidak dobel di daftar BERIKUTNYA, satu ikon hati + satu menu `⋯` per baris, label UI pindah ke `strings.ts`. Commit `d3dea86`.
- [x] **Langkah 2** — kerangka grid tiga kolom dengan tiga area scroll independen; player bar tiga zona. Halaman tidak scroll sama sekali. Commit `97962f4`.
- [x] **Langkah 3** — sidebar library: daftar playlist + Lagu Disukai + `+ BARU`, item aktif blok kuning. Commit `25e5545`.
- [x] **Langkah 4** — halaman playlist: header, baris aksi, tabel lagu bervirtualisasi (hover, menu `⋯`, lagu aktif). Commit `8c475f5`.
- [x] **Langkah 5** — panel kanan dua tab, `SEDANG DIPUTAR` dan `ANTREAN`. Commit `6b7338b`.
- [x] **Langkah 6** — player bar control deck: tombol play blok kuning 52px, progress bersegmen 10 bagian + tick tiap 10%. Commit `2cbc50a`.
- [x] **Langkah 7** — dialog Nama & Detail + cover kustom. Migrasi `0004` (kolom `description`, `cover_mode`, `cover_path`), service gambar di Rust (validasi magic bytes, batas 10 MB, batas dimensi 8192, crop tengah 1:1 → 512×512 JPEG), 4 command Tauri, dialog dengan pemilih tiga mode (otomatis/upload/generatif) + pratinjau + penghitung karakter. Diverifikasi: PNG 800×600 → JPEG 512×512 10,7 KB, tampil di sidebar dan header. Commit `2dd1ad7`.
- [x] **Langkah 8** — set ikon garis 1.5px di `src/components/icons.tsx` menggantikan semua glyph teks (`▶ ❙❙ ✕ ⏮ ⏭ 🔊 ⋯ ♥ ↺`). viewBox 24, stroke 1.5, `currentColor`, `aria-hidden`. Terverifikasi: ikon play/pause tetap 18×18 dan tombol 48×44 di kedua keadaan — glyph lama berubah ukuran saat dijeda. Commit `5c7d35a`.
- [ ] **Langkah 9** — responsif sesuai breakpoint §8.
- [ ] **Langkah 10** — pembersihan string dan penyeragaman bahasa.

Terverifikasi di aplikasi (1100×720): sidebar 268px, panel kanan 336px, main
496 ↔ 832 saat panel dibuka/ditutup, tombol play 52×52 `rgb(255,230,0)`, seek
bar 10 segmen, panel `SEDANG DIPUTAR` menampilkan lagu yang sama dengan player
bar. Tidak ada scroll horizontal.

## Fase 2 — Android (target `v0.2.0`)

- [ ] Tauri Android build jalan
- [ ] Plugin Kotlin: ExoPlayer/Media3 + foreground service
- [ ] MediaSession: notifikasi, lock screen, headset button
- [ ] Layout responsif untuk layar sempit (mini-player + full player)
- [ ] Audio focus (berhenti saat ada telepon, ducking saat notifikasi)
- [ ] Signing APK + keystore di GitHub Secrets

**Kriteria selesai Fase 2:** 1 jam putar dengan layar mati tanpa berhenti; kontrol dari notifikasi berfungsi.

## Fase 3 — Rilis (target `v0.3.0`)

- [ ] GitHub Actions: build otomatis semua platform saat push tag
- [ ] GitHub Releases berisi `.msi/.exe`, `.AppImage/.deb`, `.dmg`, `.apk`
- [ ] README lengkap + disclaimer
- [ ] Cek versi baru (updater desktop; Android via GitHub Releases API)

## Fase 4 — Listen Stats + Smart Shuffle (target `v0.4.0`)

> Detail di `FEATURES-V2.md` §1 dan §2. Mulai hanya setelah Fase 1 (queue, auto-next, re-resolve) selesai.

**Prasyarat keras (blocker, sudah diuji):**

- [x] **Upsert lagu ke tabel `tracks` saat diputar/disimpan.** Terverifikasi pada database nyata: setelah satu pencarian, `tracks` naik 0 → 20 lagu, dan `favorites`/`history`/`queue_items`/`playlist_tracks`/`listen_events` semua lolos FK. Implementasi di `db::tracks::ensure_track*`, dipanggil dari command `search` dan `resolve_stream`.
- [x] **Keputusan timezone.** `started_at` disimpan sebagai epoch ms (UTC); heatmap 24 jam dan streak dihitung dalam zona waktu perangkat. WIB UTC+7: mendengar 06:00 tetap masuk hari yang benar. Lihat `REVIEW-V2.md` §2.

- [ ] Migrasi `0003_listen_events` + repository
- [ ] Pencatat listen (akumulasi delta, bukan selesai-mulai) + tes
- [ ] Layar Stats (total waktu, top lagu/artis, play count, streak, heatmap jam)
- [ ] Pengaturan: hapus data statistik, matikan pencatatan
- [ ] Smart shuffle lokal berbobot (modul murni + tes dengan seed)
- [ ] Toggle Shuffle biasa / Shuffle pintar

## Fase 5 — Import Playlist (target `v0.5.0`)

> Detail di `FEATURES-V2.md` §3.

- [ ] Parser CSV/JSON + tes
- [ ] Normalisasi + skor kecocokan + tes
- [ ] Import dari link playlist YouTube Music (publik)
- [ ] Layar review + ringkasan + ekspor daftar "tidak ditemukan"
- [ ] Batalkan/lanjutkan job, patuhi `RESILIENCE.md`

## Fase 6 — Login + Sync (opsional, `v0.6.0`+)

> Detail di `FEATURES-V2.md` §4. Boleh tidak pernah dikerjakan.

- [ ] Keputusan arsitektur sync (file / Syncthing / backend kecil)
- [ ] Ganti kunci AUTOINCREMENT dengan UUID pada tabel yang disinkronkan
- [ ] Penyimpanan token di keychain OS (jika ada login)

## Backlog (di luar MVP)

- Halaman artis/album penuh
- Sleep timer
- Pilihan kualitas audio
- Crossfade / gapless
- Lirik
- Download offline
- Smart shuffle Tingkat B (sisipan rekomendasi)
- Tema kustom lanjutan, visualizer

## Definition of Done (per fitur)

- Jalan di desktop (dan Android untuk fitur Fase 2+)
- Tidak ada warning `clippy` dan error lint
- Error ditangani dengan pesan jelas, tidak crash
- Perubahan database punya migrasi
- Dokumen terkait (README/ARCHITECTURE) diperbarui kalau perlu
