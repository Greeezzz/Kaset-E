# RELEASE — Kaset

Distribusi **hanya lewat GitHub Releases**. Tidak ke Play Store.

## 1. Alur Rilis

1. Update versi di `package.json`, `src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json`.
2. Commit, lalu buat tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. GitHub Actions membangun semua platform dan membuat **draft release**.
4. Cek artefak, tulis catatan rilis, lalu publish.

## 2. Artefak

| Platform | Format |
|----------|--------|
| Windows | `.msi` / `.exe` |
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` (belum signed; pengguna perlu klik kanan → Open) |
| Android | `.apk` (signed) |

## 3. Workflow CI (`.github/workflows/ci.yml`)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
        with: { components: clippy, rustfmt }
      - uses: swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - name: Install Linux deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
            librsvg2-dev patchelf libasound2-dev
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: cargo fmt --manifest-path src-tauri/Cargo.toml --check
      - run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
      - run: cargo test --manifest-path src-tauri/Cargo.toml
```

## 4. Workflow Rilis Desktop (`.github/workflows/release.yml`)

```yaml
name: Release
on:
  push:
    tags: ["v*"]

jobs:
  desktop:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: ubuntu-22.04
          - platform: windows-latest
          - platform: macos-latest
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - name: Install Linux deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev \
            librsvg2-dev patchelf libasound2-dev
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Kaset ${{ github.ref_name }}"
          releaseDraft: true
          prerelease: false
```

> Versi action dan nama paket sistem bisa berubah. Agent harus memverifikasi terhadap dokumentasi Tauri 2 terbaru sebelum dipakai.

## 5. Build Android

Tambahkan job terpisah yang:

1. Setup JDK 17, Android SDK + NDK.
2. Tambah target Rust Android (`aarch64-linux-android`, dst.).
3. Jalankan `npm run tauri android build`.
4. Tanda tangani APK dengan keystore dari secrets.
5. Upload APK ke release yang sama (`gh release upload`).

**Secrets yang dibutuhkan:**

| Secret | Isi |
|--------|-----|
| `ANDROID_KEYSTORE_BASE64` | keystore yang di-encode base64 |
| `ANDROID_KEYSTORE_PASSWORD` | password keystore |
| `ANDROID_KEY_ALIAS` | alias key |
| `ANDROID_KEY_PASSWORD` | password key |

Membuat keystore (sekali saja, simpan baik-baik):

```bash
keytool -genkey -v -keystore kaset.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias kaset
```

> **Jangan hilangkan keystore.** Tanpa keystore yang sama, update APK tidak bisa dipasang di atas versi lama. Simpan salinan di tempat aman di luar repo. **Jangan pernah commit keystore ke Git.**

## 6. Update Aplikasi

- **Desktop:** pakai plugin updater Tauri (butuh pasangan kunci untuk menandatangani update; simpan private key di secrets).
- **Android:** cek versi terbaru via GitHub Releases API, tampilkan tombol "Unduh pembaruan" yang membuka halaman rilis. Alternatif: pengguna memakai **Obtainium** yang otomatis memantau GitHub Releases.

## 7. README Wajib Memuat

- Deskripsi singkat + screenshot
- Cara instal per platform
- **Disclaimer:** proyek pribadi/edukasi, tidak berafiliasi dengan Google/YouTube, pengguna bertanggung jawab atas pemakaiannya
- Cara build dari source
- Cara kontribusi
- Lisensi

## 8. Pertimbangan Hukum dan Risiko Repo

- Jangan menyertakan binary ekstraktor pihak ketiga di repo.
- Jangan pakai logo atau nama YouTube/YouTube Music sebagai nama atau ikon aplikasi.
- Jangan sertakan fitur yang bertujuan menghindari pembayaran atau DRM secara eksplisit di materi promosi.
- Jika ada surat takedown, repo mungkin perlu diturunkan; simpan salinan lokal.
