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
- [ ] Kotak pencarian (UI) + state loading/empty
- [ ] Koneksi ke `MusicCatalog` mock, hasil lagu tampil di list
- [ ] `MusicCatalog` nyata: hanya endpoint pencarian lagu (bukan album/artis)
- [ ] Saran pencarian (suggestions) + history pencarian lokal
- [ ] Empty state + pesan offline saat pencarian gagal

**Playback**
- [ ] Kontrak `StreamResolver` + mock yang bisa disuruh gagal (untuk tes backoff)
- [ ] `StreamResolver` nyata: resolve satu `video_id` → URL audio + `expires_at`
- [ ] Engine audio desktop: `load` + `play` (belum seek/volume)
- [ ] Pause, seek, volume
- [ ] Event `player://position` berkala ke UI
- [ ] Auto-lanjut ke item queue berikutnya saat `Ended`
- [ ] Resolve ulang otomatis saat URL kedaluwarsa / error 403
- [ ] Backoff + klasifikasi error + circuit breaker (lihat `RESILIENCE.md`)
- [ ] Handle tombol Next/Prev dengan coalescing request (skip cepat tidak membanjiri resolver)

**Cover Art**
- [ ] Skema tabel `covers` (migrasi `0002_covers.sql`)
- [ ] Command `cover_get` + placeholder generatif deterministik
- [ ] Job unduh background dengan tangga kualitas (lihat `THUMBNAILS.md`)
- [ ] Crop tengah 1:1 komponen `CoverArt`
- [ ] Event `cover://ready` menggantikan placeholder tanpa reload
- [ ] Eviction LRU + batas ukuran

**Queue**
- [ ] Model `QueueItem` + persistensi ke SQLite
- [ ] Add to queue, play next, remove, clear
- [ ] Drag-reorder di UI
- [ ] Shuffle non-destruktif (kolom `original_order`) + unit test
- [ ] Repeat off/one/all + unit test
- [ ] Simpan dan pulihkan queue saat app dibuka

**Library minimal**
- [ ] CRUD playlist lokal (buat, ganti nama, hapus)
- [ ] Tambah/hapus lagu dari playlist
- [ ] Favorit (toggle)
- [ ] History (catat + tampilkan daftar)

**Desktop polish**
- [ ] Media key lewat plugin global-shortcut
- [ ] Tray icon (monokrom) + menu dasar
- [ ] Export/import JSON library

**Kriteria selesai Fase 1:** bisa dipakai seharian di desktop tanpa iklan, queue dan playlist tersimpan setelah app ditutup.

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

## Backlog (di luar MVP)

- Halaman artis/album penuh
- Sleep timer
- Pilihan kualitas audio
- Crossfade / gapless
- Lirik
- Download offline
- Sync antar device (Turso / Supabase / Syncthing)
- Rekomendasi / radio dari lagu
- Tema kustom
- Visualizer

## Definition of Done (per fitur)

- Jalan di desktop (dan Android untuk fitur Fase 2+)
- Tidak ada warning `clippy` dan error lint
- Error ditangani dengan pesan jelas, tidak crash
- Perubahan database punya migrasi
- Dokumen terkait (README/ARCHITECTURE) diperbarui kalau perlu
