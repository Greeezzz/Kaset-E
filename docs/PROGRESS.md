# PROGRESS — Kaset

Ringkasan status proyek. Sumber kebenaran tetap `MVP.md` (checklist); dokumen ini untuk melihat gambaran besar tanpa membaca semuanya.

Terakhir diperbarui: commit `bc7a2c6`, branch `main`, repo `github.com/Greeezzz/Kaset-E`.

## Angka

| Fase | Selesai |
|------|---------|
| Fase 0 — Fondasi | **6/6 (selesai)** |
| Fase 1 — Desktop MVP | **30/35 (86%, sedang dikerjakan)** |
| Fase 2 — Android | 0/6 |
| Fase 3 — Rilis | 0/4 |
| Fase 4 — Stats + Smart Shuffle | 2/8 (prasyaratnya sudah selesai) |
| Fase 5 — Import Playlist | 0/5 |
| Fase 6 — Login + Sync | 0/3 |
| **Total** | **38/67 item (57%)** |

Ukuran kode: **4.787 baris Rust + 3.462 baris TypeScript/TSX**. **79 unit test hijau**, `clippy --all-targets -- -D warnings` bersih, `tsc` + `eslint` + `prettier` bersih. 22 commit.

Ukuran terpasang: `kaset.exe` 8,6 MB. Database di `%APPDATA%\app.kaset.desktop\kaset.db`, 9 tabel + `schema_migrations` (skema versi `0002`). Cache cover terpisah di `%APPDATA%\app.kaset.desktop\covers`.

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
- **Seek dan volume di UI** — bar seek bisa diklik, di-drag, dan dioperasikan keyboard (panah 5 detik, Shift+panah 30 detik, Home/End); volume punya slider + tombol bisu yang mengembalikan angka sebelumnya. Volume tersimpan dan pulih lintas restart. Diverifikasi di aplikasi: klik 60%/20%/90% mendarat 181,6/62,3/271,8 detik dari durasi 299,3; volume 35% → bisu → bunyi lagi 35%; setelah restart tetap 35. Satu bug ketemu: klik pada bar tidak melompat karena handler membaca state drag dari render sebelumnya — sekarang disimpan di ref.
- **Antrean bisa di-drag** — HTML5 drag tanpa dependensi tambahan, urutan tersimpan setelah diubah.
- **Desain Endfield hidup** — dua tema (Terminal Kertas / Terminal Malam), font self-host, grid halus, chamfer, kontras terverifikasi (aktif = blok kuning + teks hitam).

## Sisa Fase 1 (5 item, urutan kerja)

1. **Saran pencarian di UI** — command `search_suggestions` sudah ada dan teruji di Rust; `Search.tsx` belum memanggilnya.
2. **History pencarian lokal** — belum ada tabel maupun UI.
3. **Tray icon + menu dasar** — `trayIcon` sudah ada di `tauri.conf.json` dan fitur `tray-icon` aktif, tapi belum ada menu/handler di Rust.
4. **Media key** — plugin `global-shortcut` belum terpasang.
5. **Export/import JSON library** — belum ada command maupun UI.

Setelah 5 item ini, Fase 1 selesai dan `v0.1.0` bisa ditandai.

## Catatan teknis yang perlu diingat

- **`tracks` untuk lagu yang dipulihkan** — antrean tersimpan merujuk `video_id`; kalau barisnya hilang dari `tracks`, pemulihan gagal diam-diam dan antrean mulai kosong. Sudah ditangani sebagai warning, belum diuji dengan sengaja menghapus baris.
- **CSP masih mengizinkan `https://*.ytimg.com`** di `img-src`. Cover sekarang selalu lewat Rust, jadi ini sisa yang bisa dihapus setelah dipastikan tidak ada jalur lain yang memakainya.
- **Desain lanjutan** — UI masih memakai glyph teks `▶ ❙❙ ✕`, belum set ikon garis 1.5px; PlayerBar masih progress tipis, belum "control deck" bersegmen.

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
