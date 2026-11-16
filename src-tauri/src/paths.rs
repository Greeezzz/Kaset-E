//! Lokasi folder aplikasi.
//!
//! Kenapa modul sendiri, bukan field di `AppState`? Karena resolver perlu tahu
//! folder data untuk mencari (dan mengunduh) `yt-dlp` **sebelum** `AppState`
//! ada — `YtDlpResolver::detect()` dipanggil saat menyiapkan state. Satu tempat
//! yang menyimpan path menghindari dua sumber kebenaran.

use std::path::PathBuf;
use std::sync::OnceLock;

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Dipanggil sekali saat aplikasi start (dari `lib.rs` setup).
pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

/// Folder data aplikasi, kalau sudah di-set.
pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR.get().cloned()
}

/// Folder cache cover: `<data_dir>/covers`.
pub fn covers_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join("covers"))
}
