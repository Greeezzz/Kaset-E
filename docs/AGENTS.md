# AGENTS.md — Instruksi untuk Agent AI

Kamu membantu membangun **Kaset**: music player pribadi (desktop + Android) berbasis YouTube Music, tanpa iklan, dengan shuffle dan custom queue. Stack: **Tauri 2 + Rust + React/TypeScript + SQLite**.

Baca dulu, berurutan: `PRD.md` → `MVP.md` → `ARCHITECTURE.md` → `DESIGN.md` → `RELEASE.md`.

## Aturan Kerja

1. **Ikuti `MVP.md`.** Kerjakan satu fase dan satu item checklist per langkah. Jangan loncat ke fitur backlog.
2. **Jangan membangun sekaligus.** Setiap langkah harus menghasilkan sesuatu yang bisa dijalankan dan dites.
3. **Desktop dulu**, Android di Fase 2. Tapi jangan menulis kode yang mengunci ke desktop; semua lewat trait `PlayerBackend`.
4. **Verifikasi dependensi.** Nama crate/library di dokumen ini adalah usulan. Cek versi terbaru, status maintenance, dan dokumentasi resmi sebelum dipakai. Kalau ada yang tidak aktif lagi, usulkan pengganti dan jelaskan alasannya.
5. **Jangan mengarang API.** Kalau tidak yakin sebuah fungsi atau crate ada, cek dokumentasinya atau tulis sebagai asumsi yang perlu diverifikasi.
6. **Tanya kalau scope ambigu**, jangan menebak untuk keputusan besar (ganti stack, ubah skema database yang sudah dirilis, tambah server).
7. **Commit kecil dan jelas**, satu perubahan logis per commit.

## Batasan Penting

- Jangan menambah server, akun, login, atau telemetri.
- Jangan menyertakan binary ekstraktor (mis. `yt-dlp`) ke dalam repo.
- Jangan memakai nama/logo YouTube atau YouTube Music untuk branding.
- Jangan commit rahasia: keystore, password, token, private key updater.
- Jangan mengedit migrasi database yang sudah dirilis. Buat migrasi baru.

## Konvensi Kode

**Rust**
- `cargo fmt` dan `cargo clippy -- -D warnings` harus bersih.
- Error pakai `thiserror` untuk tipe error sendiri; `anyhow` hanya di lapisan atas.
- Fungsi async untuk I/O; jangan blokir thread UI.
- Command Tauri tipis: validasi input, panggil service, kembalikan hasil.
- Tulis unit test untuk `QueueManager` (shuffle, repeat, reorder, pemulihan) dan lapisan database.

**TypeScript/React**
- `strict` mode aktif; hindari `any`.
- Komponen fungsional + hooks.
- Semua panggilan `invoke`/`listen` lewat `src/lib/tauri.ts` yang bertipe.
- State global minimal (Zustand). State server/Rust adalah sumber kebenaran, UI hanya cerminan.
- Gaya mengikuti token di `DESIGN.md`; jangan hardcode warna.

**Umum**
- Nama berkas dan folder sesuai `ARCHITECTURE.md` bagian 5.
- Komentar menjelaskan *kenapa*, bukan *apa*.
- Pesan error untuk pengguna singkat dan ramah, detail teknis masuk log.
- Cover art selalu lewat Rust dan selalu cache ke disk — jangan pernah `<img src=...ytimg...>` di JSX (`THUMBNAILS.md`).
- Resolver stream selalu lewat backoff + circuit breaker — jangan panggil resolver mentah dari command (`RESILIENCE.md`).

## Urutan Pengerjaan yang Disarankan

1. **Fase 0:** scaffold Tauri 2 + React + TS, lint/format, SQLite + migrasi `0001_init.sql`, definisi trait, mock implementasi, CI dasar.
2. **Fase 1:** `MusicCatalog` nyata → `StreamResolver` nyata → `PlayerBackend` desktop → `QueueManager` + tes → UI Search/Player/Queue → Library → media key + tray → export/import.
3. **Fase 2:** plugin Kotlin (ExoPlayer/Media3, foreground service, MediaSession), layout mobile, audio focus, signing.
4. **Fase 3:** workflow rilis, README, updater.

## Definition of Done per Tugas

- Berjalan di desktop (dan Android untuk tugas Fase 2+)
- Lint, typecheck, dan tes lulus
- Error ditangani, tidak ada `unwrap()` liar di jalur produksi
- Dokumen terkait diperbarui bila ada perubahan arsitektur
- Ringkasan singkat: apa yang berubah, cara mengetesnya, apa yang belum dikerjakan

## Format Laporan Setelah Tiap Tugas

```
Selesai: <item checklist MVP>
Perubahan: <file/modul utama>
Cara tes: <perintah / langkah manual>
Catatan/risiko: <hal yang perlu perhatian>
Berikutnya: <item checklist selanjutnya>
```

## Hal yang Perlu Ditanyakan ke Pemilik Proyek

- Nama final aplikasi dan identitas visual (warna aksen, font)
- Pilihan ekstraktor stream setelah uji coba ketahanan
- Apakah desktop audio memakai `rodio` atau `<audio>` webview
- Lisensi repo (misal MIT atau GPL-3.0)
