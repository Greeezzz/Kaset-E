# SETUP — Prasyarat Dev dan Jebakan Tauri 2

Catatan operasional yang tidak masuk ke dokumen desain. Ditulis dari build pertama proyek ini, supaya tidak perlu menemukan ulang.

## 1. Windows: MSVC Build Tools wajib

`cargo` tidak bisa apa pun di Windows tanpa MSVC + Windows SDK — bahkan `cargo check` gagal, karena build script crate ikut perlu di-link. Gejalanya menyesatkan: yang terpakai malah `link.exe` milik MSYS (`/usr/bin/link`), lalu muncul `link: extra operand ...` atau `LNK1181: cannot open input file 'dbghelp.lib'`.

```
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621 --includeRecommended"
```

Tanpa hak admin, picu lewat UAC:

```powershell
Start-Process -FilePath 'winget' -Verb RunAs -ArgumentList 'install','--id','Microsoft.VisualStudio.2022.BuildTools', ...
```

**Verifikasi sebelum lanjut:**

```bash
"/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" \
  -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
ls "/c/Program Files (x86)/Windows Kits/10/Lib/"*/um/x64/dbghelp.lib
```

Keduanya harus menghasilkan output. Installer VS sering "selesai" tapi belum lengkap — selama `tasklist | grep setup.exe` masih ada, tunggu.

Prasyarat lain: Node 20+, Rust stable (`rustup default stable`), komponen `rustfmt` + `clippy`.

## 2. Tauri 2: asset protocol

Cover art dibaca dari disk lewat `asset://`. **Jangan** menambahkan `core:asset:default` ke `capabilities/*.json` — permission itu tidak ada dan build gagal dengan daftar permission yang membingungkan. Yang benar:

- `tauri.conf.json` → `app.security.assetProtocol = { "enable": true, "scope": ["$APPDATA/covers/**"] }`
- `Cargo.toml` → feature `protocol-asset` pada crate `tauri`
- CSP harus mengizinkan `img-src 'self' asset: http://asset.localhost`

## 3. Tauri 2: CORS dan CSP untuk audio

Dua jebakan berbeda yang mudah tertukar, dan keduanya membuat audio **diam tanpa pesan jelas**:

1. **Jangan set `crossOrigin = "anonymous"` pada elemen `<audio>`.** Server `*.googlevideo.com` tidak mengirim header `Access-Control-Allow-Origin`, jadi Chromium menolak audionya dengan `ERR_FAILED`. Gejalanya menipu: `paused=false` tapi `readyState=0`, `networkState=3`. Tanpa atribut itu audio memutar normal. Konsekuensinya WebAudio tidak bisa membaca sampel cross-origin — memang tidak dibutuhkan.
2. **CSP harus punya `media-src`.** `default-src 'self'` memblokir `https://*.googlevideo.com`. Wajib ada `media-src 'self' blob: https://*.googlevideo.com` (dan `img-src` untuk thumbnail `*.ytimg.com` bila cover diambil langsung).

Debug-nya: buka webview lewat `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"`, sambungkan CDP, lalu baca `Log.entryAdded` + `Network.loadingFailed`. Pesan aslinya menyebut CORS/ERR_FAILED — tanpa itu, gejalanya cuma "audio tidak jalan".

## 4. Tauri 2: ikon wajib ada semua

`tauri-build` membaca `icons/icon.ico` (Windows) dan `icons/icon.icns` (macOS) **apa pun platform build-nya**. Kalau hilang:

```
`.../icons/icon.ico` not found; required for generating a Windows Resource file
```

Minimal yang harus ada: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns`, plus `tray.png` kalau memakai tray.

## 5. Migrasi SQLite

Jangan pernah menaruh `CREATE TABLE schema_migrations` di dalam file migrasi. Runner (`db::migrations::run`) sudah membuatnya lebih dulu; duplikasi membuat semua test gagal dengan `table schema_migrations already exists`.

Satu transaksi per migrasi, dan migrasi yang sudah dirilis tidak boleh diedit — tambah entri baru di daftar `MIGRATIONS` dan file `000N_*.sql` baru.

## 6. Frontend tanpa Rust

`npm run dev` sengaja bisa jalan murni di browser: `src/lib/tauri.ts` mendeteksi `__TAURI_INTERNALS__` dan jatuh ke mock. Ini memungkinkan kerja UI/desain tanpa menunggu kompilasi Rust (yang bisa 5–15 menit pada build pertama). Konsekuensinya: setiap command baru harus punya cabang di mock, kalau tidak UI diam saja saat dipreview.

## 7. Perintah verifikasi lengkap

```bash
npm run lint && npm run typecheck && npm run format && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npx tauri build --no-bundle
```

Enam perintah itu adalah gerbang yang sama dengan CI. Kalau semua lulus lokal, CI tidak akan kejut.
