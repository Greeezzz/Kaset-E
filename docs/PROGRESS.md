# PROGRESS — Kaset

Ringkasan status proyek. Sumber kebenaran tetap `MVP.md` (checklist); dokumen ini untuk melihat gambaran besar tanpa membaca semuanya.

Terakhir diperbarui: commit `6872dfe`, branch `main`, repo `github.com/Greeezzz/Kaset-E`.

## Angka

| Fase | Selesai |
|------|---------|
| Fase 0 — Fondasi | **6/6 (selesai)** |
| Fase 1 — Desktop MVP | **35/35 (100%, selesai)** |
| Fase 1.5 — Polish | **4/4 (selesai)** |
| Fase 1.6 — Penyempurnaan Desktop | **4/4 tahap (selesai)** |
| Fase 2 — Android | 0/6 |
| Fase 3 — Rilis | 0/4 |
| Fase 4 — Stats + Smart Shuffle | **8/8 (selesai)** |
| Fase 5 — Import Playlist | **5/5 (selesai)** |
| Fase 6 — Login + Sync | 0/3 |
| Fase 7 (V3) — Mode Kaset & Lirik Engine | **11/11 (K1-K4, L1-L6, I1 selesai, L7 dilewati)** |
| **Total** | **66/82 item (80%)** |

Ukuran kode: **10.716 baris Rust + 10.092 baris TypeScript/TSX**. **215 unit test hijau**, `clippy --all-targets -- -D warnings` bersih, `tsc` + `eslint` + `prettier` bersih. 57 commit.

Ukuran terpasang: `kaset.exe` 9,8 MB. Database di `%APPDATA%\app.kaset.desktop\kaset.db`, 11 tabel + `schema_migrations` (skema versi `0007`). Cache cover terpisah di `%APPDATA%\app.kaset.desktop\covers`.

## Yang sudah benar-benar jalan (terverifikasi di aplikasi, bukan mock)

- **Cari lagu nyata dari YouTube Music** — `ytmapi-rs`, tanpa akun. Diuji: pencarian "radiohead" mengembalikan 20 lagu nyata dengan judul, artis, album, durasi.
- **Putar audio nyata** — `yt-dlp` eksternal me-resolve URL googlevideo (135 kbps webm); `<audio>` di webview memutarnya. Diuji: `currentTime` maju, player bar "0:27 / 3:58", pause/resume bekerja.
- **Ketahanan resolver** — backoff eksponensial + jitter, throttle 1,5 detik antar resolve, circuit breaker 3 status. Error permanen tidak membuka breaker (satu video rusak tidak mematikan semua pemutaran).
- **Pencarian & pemutaran tidak saling mengunci** — katalog dan resolver di-upgrade di background, aplikasi buka instan; offline tetap jalan dengan mock.
- **yt-dlp diunduh otomatis** saat pertama dijalankan (23,6 MB, ke folder data aplikasi), jadi pengguna tidak perlu memasang apa pun. Diverifikasi dengan menghapus yt-dlp lebih dulu: log memuat "mengunduh yt-dlp", `resolver_status` berubah `false` → `true`, lalu lagu benar-benar diputar tanpa env var apa pun.
- **Metadata lagu tersimpan ke database** — 0 → 20 baris setelah satu pencarian, sehingga `favorites`/`history`/`queue_items`/`playlist_tracks`/`listen_events` semuanya bisa menulis (FK lolos).
- **Antrean persisten + auto-lanjut** — `QueueManager` di Rust memegang urutan asli dan permutasi shuffle; setiap mutasi disimpan ke SQLite lewat satu pintu (`with_queue`), jadi antrean pulih setelah aplikasi ditutup. Diverifikasi di aplikasi nyata: 3 lagu + cursor + `repeat` bertahan setelah restart, auto-lanjut 1→2, repeat all membungkus 2→0, repeat one mengulang di tempat.
- **Pemulihan stream otomatis** — URL di-cache di memori (lagu sama tidak resolve ulang), dicek umurnya dengan margin 60 detik, dan saat audio ditolak (MediaError 2/4) di-resolve ulang sekali lalu lanjut dari posisi terakhir. Diverifikasi di aplikasi nyata: main 11,2 s → URL dirusak → pulih sendiri dan lanjut di 29,5 s; tiga kerusakan berturut-turut = tepat 3 resolve, bukan loop. Tiga bug ketemu lewat uji ini: posisi pemulihan selalu 0 (elemen memicu `timeupdate` 0 saat gagal), pemulihan tidak pernah jalan (`play()` mengirim kode `null` sehingga MediaError tertutupi), dan tidak ada batas percobaan.
- **Cover art tersimpan offline** — diunduh lewat Rust (bukan `<img>` ke i.ytimg.com), tangga kualitas maxres → sd → hq → mq, divalidasi magic bytes JPEG/PNG, disimpan di `<app_data>/covers`, dicatat di tabel `covers`. UI menampilkan placeholder generatif selama belum ada lalu menukarnya sendiri lewat event `cover://ready`. Diverifikasi di aplikasi: 24 cover termuat 1280×720 dirender 40×40 crop tengah 1:1; setelah restart `cover_get` 4 ms dari cache dengan 23 gambar langsung tampil tanpa unduh ulang. Eviction LRU (250 MB / 3000 file) melindungi cover yang masih dirujuk favorit/playlist/antrean.
- **Library hidup** — favorit, riwayat, playlist semuanya tersambung dan tersimpan. Diverifikasi di aplikasi nyata: favorit bertahan setelah restart, playlist 3 lagu diputar (audio 11,4 s/299 s), hapus lagu di tengah merapatkan posisi tanpa bentrok, dialog playlist tidak menggandakan lagu, riwayat tercatat. Dua bug ketemu lewat uji ini dan sudah diperbaiki: tombol ▶ playlist menampilkan hitungan basi, dan tab History menampilkan 0 padahal database terisi.
- **Saran dan riwayat pencarian** — mengetik 2+ huruf memunculkan panel saran: riwayat lokal lebih dulu (tanpa menunggu jaringan), lalu saran YouTube Music dengan debounce 250 ms. Jawaban basi dibuang lewat nomor urut, jadi saran untuk "rad" tidak menimpa "radiohead". Keyboard: panah membuka & menyorot, Enter memilih, Escape menutup; klik di luar juga menutup. Riwayat disimpan di tabel `search_history` (migrasi `0003`) dengan kunci ternormalisasi sehingga "Radiohead"/"radiohead"/"radiohead  " jadi satu baris, dihitung `hits`, bisa dihapus per entri atau semua, dan dipangkas ke 100. Diverifikasi di aplikasi: 6 saran nyata muncul untuk "radio"; hapus satu entri dan hapus semua bekerja; setelah restart riwayat tetap ada dengan hits benar.
- **Seek dan volume di UI** — bar seek bisa diklik, di-drag, dan dioperasikan keyboard (panah 5 detik, Shift+panah 30 detik, Home/End); volume punya slider + tombol bisu yang mengembalikan angka sebelumnya. Volume tersimpan dan pulih lintas restart. Diverifikasi di aplikasi: klik 60%/20%/90% mendarat 181,6/62,3/271,8 detik dari durasi 299,3; volume 35% → bisu → bunyi lagi 35%; setelah restart tetap 35. Satu bug ketemu: klik pada bar tidak melompat karena handler membaca state drag dari render sebelumnya — sekarang disimpan di ref.
- **Lagu prioritas "hantu" saat antrean dipulihkan (bug diperbaiki)** — dulu "sudah diputar" hanya tersirat dari posisi di `order`, dan `order` sengaja tidak disimpan karena shuffle harus bisa dibatalkan ke urutan asli. Saat aplikasi dibuka ulang, `restore` membangun `order` dari nol: shuffle mati menaruh lagu prioritas di ujung `items` (setelah cursor), shuffle nyala menyelipkan SEMUA lagu prioritas tepat setelah lagu aktif. Hasilnya lagu yang sudah lewat muncul lagi di BERIKUTNYA. Sekarang penanda `sudah_diputar` ikut disimpan (migrasi `0007`), diperbarui setiap cursor bergerak, dan pemulihan menyusun `[riwayat] → [lagu aktif] → [sisa]`; tombol Previous tetap bisa kembali. Tes regresi ada di `queue::tests` dan `db::queue`.
- **Antrean bisa di-drag** — HTML5 drag tanpa dependensi tambahan, urutan tersimpan setelah diubah.
- **Desain Endfield hidup** — dua tema (Terminal Kertas / Terminal Malam), font self-host, grid halus, chamfer, kontras terverifikasi (aktif = blok kuning + teks hitam).

## Fase 5 — impor playlist

**Sudah bisa dipakai.** Ekspor CSV dari Spotify lewat Exportify, buka dialog
**Impor playlist dari berkas** di sidebar, pilih berkasnya. Tiga tahap dengan
progress dan tombol batal: baca (24 ms untuk 461 lagu) → cocokkan → review →
simpan ke playlist.

Hasil pada berkas nyata 461 lagu (`chelokebab10k.csv`): **183,6 detik
(~3 menit), 428 otomatis (93%), 16 perlu diperiksa (3%), 17 tidak ketemu (4%)**
setelah perbaikan Tahap B dan C.

> **Klaim lama yang dikoreksi.** Dokumen ini sempat menulis bahwa yang gagal
> "hampir semuanya lagu Jepang — batas katalog YouTube Music". Itu tidak
> terbukti. Katalog MENEMUKAN lagu-lagu itu; penskoran yang menolak, karena
> spasi artis ("PornoGraffitti" vs "Porno Graffitti" = skor 0) dan terjemahan
> romaji yang dihukum Jaccard. Sembilan lagu terselamatkan setelah diperbaiki.
>
> Yang tetap tidak ketemu terbagi dua: 8 memang tanpa kandidat, 6 kandidatnya
> lagu berbeda (`誰我為` -> "Tokio" 0,35). Keduanya sengaja TIDAK dipaksa lolos.

Dua bug yang hanya ketemu lewat pengujian di aplikasi: job kedua tidak bisa
membatalkan job pertama (tanda batal di-reset di awal), dan tidak ada timeout
per pencarian sehingga satu pencarian menggantung menahan seluruh job.

## Redesign layout — 10 dari 10 langkah — SELESAI

Mengikuti `DESIGN-LAYOUT.md` §10. Seluruh sepuluh langkah sudah selesai dikerjakan.

| Langkah | Isi | Commit | Status |
|---|---|---|---|
| 1 | Bersihkan bug layout yang diketahui, string ke `strings.ts` | `d3dea86` | selesai |
| 2 | Kerangka grid 3 kolom, 3 area scroll independen, player bar 3 zona | `97962f4` | selesai |
| 3 | Sidebar library: playlist + Lagu Disukai + `+ BARU` | `25e5545` | selesai |
| 4 | Halaman playlist: header, aksi, tabel bervirtualisasi | `8c475f5` | selesai |
| 5 | Panel kanan dua tab: `SEDANG DIPUTAR` + `ANTREAN` | `6b7338b` | selesai |
| 6 | Player bar control deck, progress bersegmen 10 bagian | `2cbc50a` | selesai |
| 7 | Dialog Nama & Detail + cover kustom | `2dd1ad7` | selesai |
| 8 | Set ikon garis 1.5px | `5c7d35a` | selesai |
| 9 | Responsif (§8) | `865bf6e` | selesai |
| 10 | Pembersihan string dan bahasa | `36af3de` | selesai |

**Langkah 7 selesai, termasuk pelajaran yang tertinggal di versi sebelumnya.**
Sempat berstatus "separuh" dengan alasan yang layak dicatat: migrasi `0004` dan
service gambar `playlist_cover.rs` sudah lengkap dengan 9 unit test, tapi modul
itu belum didaftarkan di `lib.rs` dan crate `image` belum ada di `Cargo.toml` —
jadi seluruh file itu tidak ikut dikompilasi dan 9 tesnya tidak pernah berjalan.
Kode yang tidak dikompilasi tidak boleh dihitung selesai.

Sekarang modul terdaftar, `image` 0.25 masuk dengan fitur terbatas
(jpeg/png/webp), dan 9 tesnya berjalan hijau. Command Tauri:
`playlist_update_details`, `playlist_cover_set`, `playlist_cover_clear`,
`playlist_cover_path`. Dialog punya tiga mode cover dengan pratinjau dan
penghitung karakter; `PlaylistArt` memilih sumber gambar sesuai mode.

Diverifikasi di aplikasi: PNG 800×600 diunggah lewat command → menghasilkan
**JPEG 512×512 seberat 10,7 KB** di `playlist_covers/`, tampil 512×512 di sidebar
(44px) dan header halaman (188px), bertahan setelah restart. Ganti nama,
deskripsi, dan mode generatif juga tersimpan.

## Bug antrean yang ditemukan lewat pemakaian

**Gejala:** memutar lagu baru saat antrean sudah berisi lagu lain membuat panel
antrean tetap menulis lagu lama sebagai "sedang diputar", sementara player bar
dan audio sudah memutar lagu baru.

**Sebab:** `QueueManager::add` hanya memindahkan `cursor` kalau antrean tadinya
kosong. Menambah lagu ke antrean yang sudah berisi tidak menyentuh cursor, jadi
Rust terus menunjuk lagu lama. UI membaca cursor itu — bukan menebak — sehingga
panel menampilkan keadaan yang benar menurut Rust tapi salah menurut kenyataan.

**Perbaikan:** method `add_and_play` di Rust yang menambah lagu lalu memindahkan
cursor ke posisinya, dan command `queue_play_now` yang dipakai `handlePlay`.
Posisi dicari lewat `order`, bukan diasumsikan "selalu terakhir", karena dengan
shuffle hidup lagu baru disisipkan acak. Tiga tes regresi mengunci perilaku ini.

Diverifikasi di aplikasi: cursor 0 "Original Me" → klik Let Down → cursor 3
"Let Down"; player bar dan panel `SEDANG DIPUTAR` sama-sama menampilkan
LET DOWN / Radiohead / OK COMPUTER.

Terverifikasi di aplikasi 1100×720: sidebar 268px, panel kanan 336px, main
496 ↔ 832 saat panel dibuka/ditutup, tombol play 52×52 `rgb(255,230,0)` dengan
ikon hitam, seek bar 10 segmen setinggi 4px, dan tidak ada scroll horizontal di
panel mana pun.

## Fase 7 (V3) — Mode Kaset (Tape Mode) dan Lyrics Engine — SELESAI

Mengikuti `FEATURES-V3.md`. Fitur Mode Kaset dan Lirik telah selesai diimplementasikan 100%:

| Tahap | Fitur | Deskripsi | Status |
|---|---|---|---|
| K1 | Kerangka Mode Kaset | Mode switcher (Standar/Kaset), container Now Playing retro | Selesai |
| K2 | SVG Kaset & Label Generatif | Visual kaset Endfield, label unik deterministik FNV-1a | Selesai |
| K3 | Animasi Reel & Pita | Rotasi reel GPU sesuai playback, radius pita dinamis | Selesai |
| K4 | Dek Penuh & LCD Player | Dek hardware lengkap, counter waktu, LED VU, tombol chamfer | Selesai |
| I1 | Integrasi LCD + Lirik | Layar LCD kaset menampilkan baris lirik aktif realtime | Selesai |
| L1 | Model Data & Parser LRC | Migrasi SQLite `0008_lyrics.sql`, parser timestamp LRC di Rust | Selesai |
| L2 | Impor Berkas Manual | Dialog native file `.lrc`, drag-and-drop file lirik | Selesai |
| L3 | Tampilan Lirik Sinkron | Sorotan baris kuning Endfield, auto-scroll, seek-by-click, offset ±100ms | Selesai |
| L4 | Tampilan Penuh (Fullscreen) | Layar penuh lirik, scaling font (kecil/sedang/besar), dimmed mode, Esc | Selesai |
| L5 | Integrasi LRCLIB Opt-in | Auto-fetch lirik dari `lrclib.net`, filter kolaborator & durasi | Selesai |
| L6 | Romanisasi CJK Lokal | Transliterasi offline Rust (Korea Hangul, Jepang Kana Hepburn, Mandarin Pinyin) | Selesai |
| L7 | Terjemahan Mesin BYOK | Opsional; dilewati/ditunda sesuai konfirmasi pemilik proyek | Dilewati |

---

## Sisa Fase 1 (3 item — semua Desktop polish)

Ini dikerjakan bersama redesign UI, jadi sengaja ditunda.

1. **Tray icon + menu dasar** — `trayIcon` sudah ada di `tauri.conf.json` dan fitur `tray-icon` aktif, tapi belum ada menu/handler di Rust.
2. **Media key** — plugin `global-shortcut` belum terpasang.
3. **Export/import JSON library** — belum ada command maupun UI.

Setelah 3 item ini, Fase 1 selesai dan `v0.1.0` bisa ditandai.

## Catatan teknis yang perlu diingat

- **`tracks` untuk lagu yang dipulihkan** — antrean tersimpan merujuk `video_id`; kalau barisnya hilang dari `tracks`, pemulihan gagal diam-diam dan antrean mulai kosong. Sudah ditangani sebagai warning, belum diuji dengan sengaja menghapus baris.
- **CSP masih mengizinkan `https://*.ytimg.com`** di `img-src`. Cover sekarang selalu lewat Rust, jadi ini sisa yang bisa dihapus setelah dipastikan tidak ada jalur lain yang memakainya.
- **Ikon sudah SVG, bukan glyph** — set ikon garis 1.5px di `src/components/icons.tsx` (langkah 8). Tidak ada lagi glyph teks di JSX, jadi ukuran tombol tidak berubah saat state berubah dan warna ikon mengikuti `currentColor` di kedua tema.

## Yang sudah diputuskan (jangan ditanyakan lagi)

- Extractor: **yt-dlp eksternal**, bukan crate Rust. `rusty_ytdl` diuji dan sudah rusak (semua format `url_len=0`).
- Engine audio: **`<audio>` webview**, bukan `rodio`.
- Timezone: **ikut perangkat**, database tetap UTC.
- Import: **lewat file** dari layanan pihak ketiga (CSV/JSON), bukan API langsung.
- Desain: **Endfield menggantikan** estetika sebelumnya.
- Lisensi MIT; repo publik; commit author wajib `Greeezzz <ychel4508@gmail.com>`.

## Blocker / catatan yang perlu diingat

- `AGENTS.md` **tidak bisa ditulis agent** (file instruksi dilindungi). Patch tambahannya ada di `REVIEW-V2.md` §7 untuk ditempel manual.
- `yt-dlp` tidak dibundel (aturan `AGENTS.md`). Dev lokal menaruhnya di `.tools/` (di-gitignore) dan set `KASET_YTDLP_PATH`; untuk pengguna akhir diunduh otomatis ke folder data aplikasi.
- Jebakan build Windows dan cara verifikasi audio lewat CDP ada di `SETUP.md` §8–9. Yang paling sering kena: build gagal dengan `Access is denied` kalau `kaset.exe` masih berjalan.
- Dua aturan di `FEATURES-V2.md` sudah dikoreksi sebelum dikerjakan: timezone, dan ambang delta seek (lihat `REVIEW-V2.md` §2–3).
