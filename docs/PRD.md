# PRD — Kaset (working name)

> Music player pribadi berbasis YouTube Music, tanpa iklan, untuk desktop dan Android.
> Nama "Kaset" cuma placeholder, boleh diganti.

## 1. Ringkasan

Kaset adalah aplikasi pemutar musik open-source untuk penggunaan pribadi/edukasi. Aplikasi mengambil katalog dan metadata dari YouTube Music, memutar audionya lewat player buatan sendiri (bukan embed YouTube) sehingga tidak ada iklan, dan menyediakan kontrol penuh atas antrean (queue), shuffle, dan playlist lokal.

Target platform: **Desktop (Windows, Linux, macOS)** dan **Android**.
Distribusi: **GitHub Releases saja**. Tidak ke Play Store.

## 2. Masalah

- Pemutar resmi menampilkan iklan dan membatasi kontrol queue/shuffle di tier tertentu.
- Tidak ada satu aplikasi ringan yang sama persis di desktop dan Android dengan kontrol queue penuh.
- Pengguna ingin data (playlist, history) tersimpan lokal dan bisa dipindah antar perangkat.

## 3. Tujuan

1. Cari lagu, album, artis, playlist dari katalog YouTube Music.
2. Putar audio tanpa iklan dengan background playback yang stabil (terutama di Android).
3. Queue yang fleksibel: tambah, hapus, urut ulang, putar berikutnya, shuffle.
4. Playlist dan history tersimpan lokal (offline-first).
5. Satu codebase UI untuk desktop dan Android.
6. Rilis otomatis ke GitHub Releases lewat CI.

## 4. Non-Tujuan (v1)

- Tidak untuk Play Store / App Store.
- Tidak ada akun, login, atau server milik sendiri.
- Tidak ada sync cloud otomatis (v1 hanya export/import).
- Tidak ada download offline lagu.
- Tidak ada lirik sinkron.
- Tidak ada fitur sosial.

## 5. Target Pengguna

- **Utama:** pemilik proyek (pemakaian pribadi sehari-hari).
- **Sekunder:** developer/teman yang tertarik mencoba lewat GitHub.

## 6. User Stories

| ID | Sebagai pengguna, saya ingin... | Prioritas |
|----|----------------------------------|-----------|
| U1 | mencari lagu/artis/album dan melihat hasilnya | Must |
| U2 | memutar lagu tanpa iklan | Must |
| U3 | menambah lagu ke queue, atau "putar berikutnya" | Must |
| U4 | mengacak (shuffle) queue dan mengatur repeat | Must |
| U5 | mengurutkan ulang dan menghapus item queue | Must |
| U6 | musik tetap jalan saat layar mati / app di background (Android) | Must |
| U7 | kontrol play/pause/next/prev dari notifikasi dan lock screen | Must |
| U8 | membuat dan mengelola playlist lokal | Should |
| U9 | menandai lagu favorit | Should |
| U10 | melihat history putar | Should |
| U11 | export/import playlist (JSON) antar perangkat | Should |
| U12 | media key keyboard dan tray icon di desktop | Should |
| U13 | mengatur sleep timer | Could |
| U14 | memilih kualitas audio | Could |

## 7. Kebutuhan Fungsional

### 7.1 Pencarian
- Input pencarian dengan saran (suggestions).
- Hasil dikelompokkan: Lagu, Album, Artis, Playlist.
- Halaman artis dan album menampilkan daftar lagu.

### 7.2 Pemutaran
- Resolve stream audio dari ID video YouTube.
- Putar, jeda, seek, volume, next, previous.
- Crossfade/gapless: Could (v2).
- Auto-lanjut ke item queue berikutnya.
- Jika stream gagal di-resolve, tampilkan error ringan dan lompat ke lagu berikutnya setelah retry.

### 7.3 Queue
- Tambah di akhir, tambah sebagai berikutnya, hapus, drag-reorder, kosongkan.
- Shuffle bersifat non-destruktif: urutan asli bisa dikembalikan.
- Mode repeat: off / satu lagu / semua.
- Queue tersimpan dan dipulihkan saat app dibuka lagi.

### 7.4 Library
- Playlist lokal (CRUD).
- Favorit.
- History.
- Export/import JSON.

### 7.5 Sistem
- Background playback + MediaSession (Android).
- Media key + tray (desktop).
- Pengaturan dasar: tema, kualitas audio, folder data.

## 8. Kebutuhan Non-Fungsional

- **Performa:** hasil pencarian tampil di bawah 2 detik pada koneksi normal; lagu mulai bunyi di bawah 3 detik.
- **Ukuran:** installer desktop sekecil mungkin (keunggulan Tauri).
- **Ketahanan:** extractor stream sering rusak karena perubahan YouTube, jadi harus dibungkus di balik interface agar mudah diganti/diupdate.
- **Privasi:** semua data lokal; tidak ada telemetri.
- **Offline:** library (playlist, favorit, history) bisa dibuka tanpa internet, walau lagu tidak bisa diputar.

## 9. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|--------|--------|----------|
| Melanggar ToS YouTube | Takedown repo jika populer | Disclaimer "personal/educational use"; jangan bundle binary extractor; hanya GitHub |
| Extractor rusak karena perubahan YouTube | Lagu tidak bisa diputar | Abstraksi `StreamResolver`; update dependensi rutin; fallback ke extractor lain |
| Background audio Android rumit di WebView | Musik berhenti saat layar mati | Plugin Kotlin dengan ExoPlayer/Media3 + foreground service sejak awal |
| Scope melebar | Proyek tidak selesai | Patuhi `MVP.md`; fitur di luar MVP masuk backlog |
| Kehilangan keystore Android | Update APK tidak bisa dipasang di atas versi lama | Backup keystore, simpan di GitHub Secrets dan penyimpanan offline |

## 10. Metrik Keberhasilan (pribadi)

- Dipakai sendiri sehari-hari menggantikan player resmi.
- Tidak ada crash saat sesi putar 1 jam+ di Android dengan layar mati.
- Rilis `v0.1.0` yang bisa diunduh dan dipasang oleh orang lain dari GitHub.

## 11. Dokumen Terkait

- `MVP.md` — batas scope dan checklist
- `ARCHITECTURE.md` — arsitektur, struktur folder, skema database
- `DESIGN.md` — arah visual dan layar
- `RELEASE.md` — CI/CD dan distribusi
- `AGENTS.md` — instruksi untuk agent AI
