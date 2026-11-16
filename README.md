# Kaset

Pemutar musik pribadi untuk desktop dan Android. Cari lagu, putar tanpa iklan, kelola antrean sepenuhnya. Tanpa akun, tanpa server, tanpa telemetri.

> **Status: Fase 0 (fondasi).** Belum bisa memutar audio sungguhan — katalog dan resolver masih mock. Lihat [MVP.md](docs/MVP.md).

## Stack

| Lapisan | Pilihan |
|---------|---------|
| Shell | Tauri 2 |
| Logika | Rust |
| UI | React 19 + TypeScript + Vite |
| Database | SQLite (bundled `rusqlite`) |
| State UI | Zustand |

## Menjalankan

Prasyarat: Node 20+, Rust stable, dan **C toolchain** (Windows: MSVC Build Tools; Linux: `build-essential` + `libwebkit2gtk-4.1-dev`; macOS: Xcode CLT).

```bash
npm install         # dependensi frontend
npm run dev         # UI saja di browser (pakai mock, tanpa Rust)
npm run tauri dev   # aplikasi desktop lengkap
```

UI murni di browser sengaja didukung: `src/lib/tauri.ts` mendeteksi ketiadaan Tauri dan jatuh ke mock. Ini yang membuat desain bisa dikerjakan tanpa menunggu kompilasi Rust.

## Perintah

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format        # Prettier --check
npm run build         # typecheck + bundle produksi
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Dokumen

Baca berurutan: [PRD](docs/PRD.md) → [MVP](docs/MVP.md) → [ARCHITECTURE](docs/ARCHITECTURE.md) → [DESIGN](docs/DESIGN.md) → [RELEASE](docs/RELEASE.md) → [AGENTS](docs/AGENTS.md).

Dua dokumen tambahan menutup celah yang tidak dibahas dokumen asli:

- [THUMBNAILS](docs/THUMBNAILS.md) — cache cover art: tangga kualitas, tabel `covers`, placeholder generatif, eviction LRU.
- [RESILIENCE](docs/RESILIENCE.md) — backoff, klasifikasi error, dan circuit breaker untuk resolver stream.

## Struktur

```
src/                 React UI (features/, components/, lib/, stores/)
src-tauri/           Rust core + konfigurasi Tauri
  migrations/        SQL versioned — jangan edit migrasi yang sudah dirilis
docs/                Dokumen proyek
```

## Disclaimer

Proyek pribadi/edukasi. Tidak berafiliasi dengan Google, YouTube, atau YouTube Music. Aplikasi tidak menyertakan binary ekstraktor pihak ketiga dan tidak memakai merek/logo YouTube. Pengguna bertanggung jawab penuh atas pemakaiannya, termasuk kepatuhan terhadap ketentuan layanan pihak ketiga.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
