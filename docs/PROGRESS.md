# PROGRESS — Kaset

Ringkasan status proyek. Sumber kebenaran tetap `MVP.md` (checklist); dokumen ini untuk melihat gambaran besar tanpa membaca semuanya.

Terakhir diperbarui: commit `aee0a49`, branch `main`, repo `github.com/Greeezzz/Kaset-E`.

## Angka

| Fase | Selesai |
|------|---------|
| Fase 0 — Fondasi | **6/6 (selesai)** |
| Fase 1 — Desktop MVP | **15/34 (sedang dikerjakan)** |
| Fase 2 — Android | 0/6 |
| Fase 3 — Rilis | 0/4 |
| Fase 4 — Stats + Smart Shuffle | 1/8 (prasyaratnya sudah dikerjakan) |
| Fase 5 — Import Playlist | 0/5 |
| Fase 6 — Login + Sync | 0/3 |
| **Total** | **22/44 item (50%)** |

Ukuran kode: 2.133 baris Rust + 1.552 baris TypeScript/TSX. 29 unit test hijau.

## Yang sudah benar-benar jalan (terverifikasi di aplikasi, bukan mock)

- **Cari lagu nyata dari YouTube Music** — `ytmapi-rs`, tanpa akun. Diuji: pencarian "radiohead" mengembalikan 20 lagu nyata dengan judul, artis, album, durasi.
- **Putar audio nyata** — `yt-dlp` eksternal me-resolve URL googlevideo (135 kbps webm); `<audio>` di webview memutarnya. Diuji: `currentTime` maju, player bar "0:27 / 3:58", pause/resume bekerja.
- **Ketahanan resolver** — backoff eksponensial + jitter, throttle 1,5 detik antar resolve, circuit breaker 3 status. Error permanen tidak membuka breaker (satu video rusak tidak mematikan semua pemutaran).
- **Pencarian & pemutaran tidak saling mengunci** — katalog dan resolver di-upgrade di background, aplikasi buka instan; offline tetap jalan dengan mock.
- **yt-dlp diunduh otomatis** saat pertama dijalankan (23,6 MB, ke folder data aplikasi), jadi pengguna tidak perlu memasang apa pun. Diverifikasi dengan menghapus yt-dlp lebih dulu: log memuat "mengunduh yt-dlp", `resolver_status` berubah `false` → `true`, lalu lagu benar-benar diputar tanpa env var apa pun.
- **Metadata lagu tersimpan ke database** — 0 → 20 baris setelah satu pencarian, sehingga `favorites`/`history`/`queue_items`/`playlist_tracks`/`listen_events` semuanya bisa menulis (FK lolos).
- **Antrean persisten + auto-lanjut** — `QueueManager` di Rust memegang urutan asli dan permutasi shuffle; setiap mutasi disimpan ke SQLite lewat satu pintu (`with_queue`), jadi antrean pulih setelah aplikasi ditutup. Diverifikasi di aplikasi nyata: 3 lagu + cursor + `repeat` bertahan setelah restart, auto-lanjut 1→2, repeat all membungkus 2→0, repeat one mengulang di tempat.
- **Desain Endfield hidup** — dua tema (Terminal Kertas / Terminal Malam), font self-host, grid halus, chamfer, kontras terverifikasi (aktif = blok kuning + teks hitam).

## Yang berikutnya (urutan kerja Fase 1 yang tersisa)

1. **Re-resolve saat URL kedaluwarsa** — URL googlevideo berumur ~6 jam dan bisa 403 sebelum itu. Sekarang pemutaran gagal dengan toast; yang belum ada: deteksi 403 saat memutar → resolve ulang otomatis → lanjut dari posisi terakhir.
2. **`tracks` untuk lagu yang dipulihkan** — antrean tersimpan merujuk `video_id`; kalau barisnya hilang dari `tracks`, pemulihan gagal diam-diam dan antrean mulai kosong (sudah ditangani sebagai warning, tapi belum diuji).
3. **Library** — playlist CRUD, favorit, history. FK-nya sudah siap, tinggal command + UI.
4. **Cover art bagian unduh** — job background + tangga kualitas + `cover://ready` + eviction LRU (skema dan placeholder sudah ada).
5. **Polish desktop** — media key, tray, export/import JSON.
6. **Desain lanjutan** — set ikon garis 1.5px (sekarang UI masih pakai glyph teks `▶ ❙❙ ✕`), PlayerBar "control deck" dengan progress bersegmen.

## Yang sudah diputuskan (jangan ditanyakan lagi)

- Extractor: **yt-dlp eksternal**, bukan crate Rust. `rusty_ytdl` diuji dan sudah rusak (semua format `url_len=0`).
- Engine audio: **`<audio>` webview**, bukan `rodio`.
- Timezone: **ikut perangkat**, database tetap UTC.
- Import: **lewat file** dari layanan pihak ketiga (CSV/JSON), bukan API langsung.
- Desain: **Endfield menggantikan** estetika sebelumnya.
- Lisensi MIT; repo publik; commit author wajib `Greeezzz <ychel4508@gmail.com>`.

## Blocker / catatan yang perlu diingat

- `AGENTS.md` **tidak bisa ditulis agent** (file instruksi dilindungi). Patch tambahannya ada di `REVIEW-V2.md` §7 untuk ditempel manual.
- `yt-dlp` tidak dibundel (aturan `AGENTS.md`). Dev lokal menaruhnya di `.tools/` (di-gitignore) dan set `KASET_YTDLP_PATH`.
- Jebakan build Windows dan cara verifikasi audio lewat CDP ada di `SETUP.md` §8–9.
- Dua aturan di `FEATURES-V2.md` sudah dikoreksi sebelum dikerjakan: timezone, dan ambang delta seek (lihat `REVIEW-V2.md` §2–3).
