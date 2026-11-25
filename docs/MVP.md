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

### Redesign Layout (`DESIGN-LAYOUT.md`) — 10 dari 10 langkah — SELESAI

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
- [x] **Langkah 9** — responsif sesuai breakpoint §8 (4 tingkat lebar: ≥1200 tiga kolom, 900–1199 panel overlay, 600–899 sidebar rel ikon, <600 BottomNav + MiniPlayer + bottom sheet). Commit `865bf6e`.
- [x] **Langkah 10** — pembersihan string ke `src/lib/strings.ts` dan penyeragaman bahasa Indonesia. Commit `36af3de`.

Terverifikasi di aplikasi (1100×720): sidebar 268px, panel kanan 336px, main
496 ↔ 832 saat panel dibuka/ditutup, tombol play 52×52 `rgb(255,230,0)`, seek
bar 10 segmen, panel `SEDANG DIPUTAR` menampilkan lagu yang sama dengan player
bar. Tidak ada scroll horizontal.

## Fase 1.5 — Polish — SELESAI

- [x] Ukur delay: log durasi `resolve_stream` dan durasi klik→event `"playing"`. Terukur di aplikasi nyata: resolve 7,1 s / 10,0 s / 9,2 s untuk tiga lagu berbeda — cukup untuk membenarkan prefetch. Log Rust mencatat `catalog_ms`, `resolve_ms`, `total_ms`, `ok` per panggilan; UI mencatat `klik->playing` di console.
- [x] Prefetch resolve lagu berikutnya lewat `streamCache` + state `"MEMUAT…"` di `PlayerBar`. Diverifikasi: saat Kinetic baru berjalan 25 detik dari 299, lagu berikutnya (Let Down) sudah di-resolve — 9,2 detik selesai 274 detik sebelum dibutuhkan. Ambang 15 detik sebelum habis, satu kali per lagu.
- [x] Context menu custom gaya Endfield — satu komponen `AksiMenu` menggantikan empat implementasi terpisah (Sidebar, TrackRow, PlaylistTable, PlaylistPage). Empat listener tutup-menu yang menduplikasi juga dihapus. `position: fixed` supaya tidak terpotong `overflow` induk; buka ke atas kalau ruang bawah tidak cukup; area sentuh 44px.
- [x] Rasa native: `user-select: none` di UI dengan pengecualian `input`/`textarea`, blok drag gambar dan elemen UI, `overscroll-behavior: none`.

Catatan "Putar berikutnya" dihapus dari menu baris: aksinya nyaris sama dengan
"Tambah ke antrean", dan dua item yang hasilnya hampir identik hanya membuat
pengguna ragu. Command `queue_play_next` di Rust tetap ada (dipakai tes), tapi
tidak lagi diekspos sebagai aksi UI.

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

## Fase 1.6 — Penyempurnaan Desktop (SELESAI)

Dikerjakan setelah Fase 1.5, sebelum Android. Semua item lahir dari pemakaian
nyata sehari-hari, bukan dari daftar fitur.

### Tahap A — Delay klik lagu baru (7-10 detik) — SELESAI

Diagnosa dulu, tanpa mengubah kode. Hasil pengukuran: biner yt-dlp satu-file
adalah PyInstaller **onefile** yang mengekstrak 30 MB / 142 berkas ke `%TEMP%`
pada SETIAP pemanggilan. Start-up saja 2,1-4,4 detik; jaringan hanya 0,7-1,6
detik dari total. Jadi "batas jaringan" bukan penyebabnya.

- [x] **A1** Diagnosa + angka: startup, resolve 3 lagu x 2, perbandingan versi lama/baru.
- [x] **A2** Biner **onedir** (`yt-dlp_win.zip`) menggantikan satu-file. Resolve turun dari 5.540-5.670 ms ke 2.459-3.224 ms di aplikasi nyata. Platform lain tetap satu-file.
- [x] **A2.2** Pembaruan berkala di background, paling sering sekali per 3 hari, tukar atomik, simpan satu versi cadangan, aman offline.
- [x] **A2.3** Peringatan yt-dlp tidak lagi dibuang (`--no-warnings` dihapus), didedupe, dicatat level WARN. Ini yang akhirnya memunculkan deprecation runtime JS.
- [x] **A2.4** Verifikasi SHA-256 terhadap `SHA2-256SUMS` rilis resmi, HTTPS + host `github.com/yt-dlp/yt-dlp` saja. Hash tidak cocok = tolak, versi sekarang tetap dipakai.
- [x] **A2.5** Unduhan dimulai saat start (bukan saat klik play); cadangan versi lama dihapus otomatis setelah 7 hari.
- [x] **A3** Prefetch lagu berikutnya dipicu 4 detik setelah lagu mulai (dulu sisa <15 detik).
- [x] **A4** Prefetch saat hover baris (debounce 400 ms, satu berjalan, batal kalau pindah) + lagu pertama saat halaman playlist dibuka. Hasil pencarian sengaja TIDAK di-prefetch.

Hasil: lagu baru 2.394-3.429 ms, lagu yang di-prefetch ~0 ms.

### Tahap B — 23 lagu "tidak ketemu" saat impor — SELESAI

Klaim lama "batas katalog YouTube Music" **tidak terbukti**: katalog menemukan
lagu-lagu itu, penskoran yang menolak.

- [x] **B1** Ambil 23 lagu gagal + kandidat + skor dari impor 461 lagu nyata.
- [x] **B2** Uji 4 hipotesis. Terbukti: (c) kanji vs romaji — katalog menulis "メリッサ - Melissa", judul impor termuat utuh tapi Jaccard menghukum token romaji; (d) **spasi artis** — "PornoGraffitti" vs "Porno Graffitti" memberi skor 0.
- [x] **B3** Variasi kueri (gabungan/judul/artis) dengan throttle 1,6 detik.
- [x] **B4** Perbaikan: spasi diabaikan saat banding utuh; judul termuat utuh = 1,0 bila penanda versi sama; bonus durasi tidak diberikan bila versi beda; penalti versi 0,20 -> 0,35. Ambang 0,80 TIDAK diturunkan.

Hasil: 418 -> 432 otomatis, 23 -> 14 tidak ketemu (9 terselamatkan).

### Tahap C — Audit akurasi otomatis (ambang 0,80) — SELESAI

- [x] **C1** 20 lagu acak dari 432 otomatis, tabel judul/artis/durasi/skor + flag versi.
- [x] **C2** Dinilai manual pemilik proyek: **20/20 benar**. Tidak ada pola salah, jadi tidak ada penyesuaian bobot.
- [x] **C3** Sampel 20 tidak cukup (406 dari 432 skor 1,000), jadi seluruh 433 judul hasil dipindai. Ditemukan celah nyata: `Inst.` tidak dikenali sebagai instrumental, sehingga lagu instrumental lolos otomatis. Ditambah: `inst.`, `stripped`, `sing-along`, `reprise`, `extended`, `from the first take`, `off vocal`. Hasil: 432 -> 428 otomatis (4 lagu pindah ke review — penurunan yang disengaja).

### Tahap D — Dokumen dan item tersisa — SELESAI

- [x] **D1** Ekspor daftar "tidak ditemukan" + "perlu diperiksa" ke CSV lewat dialog simpan native. 5 tes unit.
- [x] **D2** Sinkronkan `PROGRESS.md` dan `MVP.md`: angka, hash commit, skema `0006`, hapus kalimat basi. Koreksi nomor migrasi di `FEATURES-V2.md` (`0003`/`0004` -> `0005`/`0006`).
- [x] **D3** Blok ini.

## Fase 4 — Listen Stats + Smart Shuffle (target `v0.4.0`)

Dikerjakan dalam dua tahap. **4a lebih dulu** supaya data mulai terkumpul dari
hari pertama dipakai — layar Stats dan smart shuffle tidak ada artinya kalau
tidak ada data untuk ditampilkan. **4b** menyusul setelah data cukup.

> Detail di `FEATURES-V2.md` §1 dan §2. Mulai hanya setelah Fase 1 (queue, auto-next, re-resolve) selesai.

**Prasyarat keras (blocker, sudah diuji):**

- [x] **Upsert lagu ke tabel `tracks` saat diputar/disimpan.** Terverifikasi pada database nyata: setelah satu pencarian, `tracks` naik 0 → 20 lagu, dan `favorites`/`history`/`queue_items`/`playlist_tracks`/`listen_events` semua lolos FK. Implementasi di `db::tracks::ensure_track*`, dipanggil dari command `search` dan `resolve_stream`.
- [x] **Keputusan timezone.** `started_at` disimpan sebagai epoch ms (UTC); heatmap 24 jam dan streak dihitung dalam zona waktu perangkat. WIB UTC+7: mendengar 06:00 tetap masuk hari yang benar. Lihat `REVIEW-V2.md` §2.

### 4a — pencatat (SELESAI)

- [x] Migrasi `0005_listen_events` + repo `db::listen`. Nomor `0005`, bukan `0003` — `0003` sudah dipakai `search_history` dan `0004` dipakai `playlist_details`. Tabel + dua indeks (`started_at`, `video_id+started_at`).
- [x] Pencatat listen berbasis **delta**, bukan selesai-mulai. `Akumulator` murni di `db/listen.rs` (7 tes) dan kembarannya di `lib/listen.ts` untuk sisi UI — keduanya memakai kontrak yang sama: ambang seek 2 detik, flush tiap 5 detik.
- [x] Command `listen_record`, `listen_summary`, `listen_clear` + mock browser.

Diverifikasi di aplikasi nyata dengan database sungguhan, bukan mock:

| Yang diuji | Hasil |
|---|---|
| Putar lagu 30 detik | 6 potongan, 30,3 detik tercatat |
| Seek lompat 189 detik | total hanya naik 19,7 detik (waktu nyata sebelum seek) — seek TIDAK dihitung |
| Pause 15 detik | 100,65 → 100,65 detik, nol bertambah |
| Ganti lagu | 2 lagu unik tercatat, sisa lagu lama tidak hilang |

Aturan yang dipegang: hanya perubahan posisi yang wajar (≤2 detik per event)
yang dihitung. Ini yang membedakan "mendengar" dari "lagu sedang terbuka".

### 4b — tampilan (SELESAI)

- [x] Layar Stats: total waktu, putaran, lagu/artis unik, streak, heatmap 24 jam, lagu & artis teratas, filter rentang (24 jam/minggu/bulan/tahun/semua).
- [x] Pengaturan: saklar catat statistik + tombol hapus data.
- [x] Smart shuffle lokal berbobot — modul murni `queue::smart`, 18 tes dengan seed.
- [x] Toggle ACAK → PINTAR di panel antrean (hanya muncul saat ACAK menyala).

**Dua hal yang mudah salah di statistik, keduanya sudah ditangani:** satu baris `listen_events` bukan satu putaran (pencatat menulis tiap ~5 detik, jadi potongan digabung jadi sesi dulu), dan `started_at` UTC sementara "jam 21:00" dan streak harian hanya bermakna dalam zona lokal pengguna (offset dikirim frontend, WIB = 420).

**Hasil pengukuran di aplikasi nyata** (40 acakan per jenis, playlist 431 lagu, posisi rata-rata per lagu): lagu yang didengar lama naik — Fallen Petals 228→128, Somewhere Only We Know 213→139. Lagu yang dicoba lalu di-skip turun — Tek It 187→328, The One That Got Away 208→336. Rata-rata gabungan terlihat tidak berubah karena yang naik dan turun saling meniadakan, jadi pengukuran harus per-lagu.

Tiga bug ditemukan karena mengukur pada data nyata, bukan lewat unit test: favorit sempat lebih rendah dari lagu asing, rasio "mendengar biasa" tidak terpakai (hanya 2 dari 16 lagu pernah "selesai"), dan satu skip menghukum penuh karena penyebut rasio skip salah.

## Fase 5 — Import Playlist (target `v0.5.0`) — SELESAI (5/5)

> Detail di `FEATURES-V2.md` §3.

- [x] Parser CSV/JSON + tes. CSV Exportify + CSV/JSON generik. Menangani BOM UTF-8, tanda kutip bersarang, artis ganda (`;`), judul non-ASCII, dedupe. 13 tes.
- [x] Normalisasi + skor kecocokan + tes. Modul murni `import/cocok.rs`, 12 tes: judul 65% + artis 35%, bonus/penalti durasi dan penanda versi. Ambang 0,80 otomatis / 0,60 review.
- [ ] Import dari link playlist YouTube Music (publik) — belum; butuh akses playlist publik, ditunda.
- [x] Layar review + ringkasan. Dialog 4 tahap (pilih berkas → progress → review dengan filter/filter checkbox → hasil). Baris `review` TIDAK tercentang otomatis.
- [x] Batalkan/lanjutkan job. Tombol batal memeriksa tanda setiap lagu; job kedua ditolak supaya tidak berebut katalog; timeout 15 detik per pencarian.

**Hasil pada berkas nyata (461 lagu Spotify):** 183,6 detik (~3 menit, 398 ms/lagu) → **428 otomatis (93%), 16 review (3%), 17 tidak ketemu (4%)** setelah perbaikan Tahap B dan C.

> **Koreksi klaim lama.** Versi pertama dokumen ini menulis bahwa yang gagal "hampir semuanya lagu Jepang — batas katalog YouTube Music". Itu **tidak terbukti**. Investigasi Tahap B menunjukkan katalog MENEMUKAN lagu-lagu itu; penskoran yang menolak, karena dua sebab terukur: (1) spasi artis — Spotify "PornoGraffitti" vs katalog "Porno Graffitti" memberi skor artis 0, dan (2) katalog menambah terjemahan romaji ("メリッサ - Melissa") yang dihukum Jaccard sebagai token tambahan. Sembilan lagu terselamatkan setelah kedua hal itu diperbaiki. Sisa 14 terbagi dua: 8 memang tanpa kandidat, 6 kandidatnya lagu berbeda.

- [x] Ekspor daftar "tidak ditemukan" dan "perlu diperiksa" ke CSV lewat dialog simpan native (Tahap D1). Header 9 kolom, semua nilai dikutip sehingga judul berkoma dan bertanda kutip tetap sah; 5 tes unit.

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
