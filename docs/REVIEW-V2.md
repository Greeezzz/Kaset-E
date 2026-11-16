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

## 2. Timezone belum ada, padahal metrik intinya berbasis "hari"

`started_at` adalah epoch ms (UTC). Dua metrik di §1.5 langsung terpengaruh:

- **Heatmap 24 jam** — jam harus jam lokal pengguna.
- **Streak hari berturut-turut** — "hari" harus batas lokal (tengah malam WIB), bukan UTC.

Di WIB (UTC+7), mendengar jam 06:00 akan dihitung sebagai hari sebelumnya kalau pakai UTC. Perlu keputusan: simpan offset timezone saat event dicatat, atau konversi di query. Untuk aplikasi desktop satu pengguna, menyimpan offset di tabel `settings` sudah cukup.

## 3. Aturan "delta > 2 detik = seek" berisiko mengorupsi metrik utama

§1.3 benar bahwa seek tidak boleh dihitung, tapi ambang tetap 2 detik berbahaya di webview: saat jendela tidak fokus atau (nanti di Android) layar mati, `timeupdate` bisa jarang — delta **normal** bisa 3–5 detik dan akan dibuang. Akibatnya `listened_ms` terlalu kecil, dan justru metrik "total waktu mendengar" yang rusak.

Saran: bandingkan tick dengan jam dinding (`Instant`/`performance.now()`), bukan ambang tetap. Delta dianggap seek hanya jika **posisi audio melompat lebih jauh daripada waktu nyata yang lewat** (mis. lompat 30 detik padahal baru 2 detik berlalu). Itu definisi seek yang benar dan tahan terhadap tick jarang.

Catatan tambahan: webview Tauri hanya mengekspos `timeupdate` (event berbasis DOM), jadi pengukuran harus dilakukan di sisi frontend lalu dikirim ke Rust — atau Rust menghitung delta dari event posisi yang sudah ada. Jangan berasumsi ada callback frame-level dari sisi Rust.

## 4. Verifikasi Spotify: dokumen sudah benar

Dicek ke dokumentasi resmi:

- Development mode: owner **wajib Premium**; maksimum **5 user** per app; 1 Client ID.
- Extended quota: **hanya organisasi**, minimum **250k MAU**, tersedia di pasar utama.
- Juli 2026: batas Client ID naik ke 25 (batas **user tetap 5**).

Kesimpulan §3.2 ("tidak praktis") valid dan bahkan lebih kuat sekarang. Yang bagus: dokumen sudah menulis "verifikasi lagi aturan terbaru" — angka-angka ini memang bergerak. Jalur CSV/JSON sebagai default adalah keputusan yang tepat.

## 5. DESIGN-ENDFIELD: catatan penerapan

- **Kuning #FFE600 di elemen yang selalu terlihat melelahkan mata.** Aturan kontrasnya sudah benar (kuning hanya latar + teks hitam), tapi perhatikan: player bar dan item queue aktif *selalu* ada di layar. Saran: kuning penuh hanya untuk keadaan benar-benar aktif (lagu yang sedang diputar, tombol utama), dan aksen yang lebih redup untuk penanda pasif.
- **`clip-path` memotong border di sudut chamfer** — dokumen sudah menangkap ini di §5.1. Tambahan praktis: untuk garis tegas di sudut potong, cara termurah adalah pseudo-element dengan `transform: skew()` atau SVG `polyline` kecil, bukan `clip-path` bersarang.
- **Font self-host, jangan CDN** — penting dan sudah ditulis. Barlow/Oswald/IBM Plex semuanya OFL, aman. Catatan: Barlow Condensed tidak punya varian italic lengkap, jadi jangan bergantung pada italic untuk `--font-display`.
- **Urutan penerapan §12 sudah benar.** Tambahan: kerjakan lewat `npm run dev` (mock) dulu — itu sebabnya `src/lib/tauri.ts` punya fallback mock.

## 6. Yang tidak bisa dikerjakan agent: `AGENTS.md`

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

## 7. Pertanyaan untuk pemilik proyek

Arah visual `DESIGN-ENDFIELD.md` (industrial taktis, Barlow Condensed + IBM Plex) bertolak belakang dengan estetika Japanese Manga Mincho (Shippori Mincho + Zen Kaku Gothic) yang dipakai proyek lain. Apakah ini memang sengaja mengganti arah untuk Kaset, atau nanti digabung? Ini memengaruhi `tokens.css` dan aset ikon yang harus dibuat.
