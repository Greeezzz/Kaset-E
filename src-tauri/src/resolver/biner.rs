//! Pengelola biner yt-dlp: pemilihan versi, tukar atomik, dan fallback.
//!
//! ## Kenapa ada modul ini
//!
//! Diukur di mesin nyata (lihat catatan A2 di `PROGRESS.md`): biner yt-dlp
//! satu-file adalah PyInstaller **onefile** yang mengekstrak 30 MB / 142 file
//! ke `%TEMP%\_MEI…` pada SETIAP pemanggilan. Akibatnya start-up saja makan
//! 2,1–4,4 detik, sementara resolve total 4,8–6,5 detik — jaringan hanya
//! 0,7–1,6 detik dari itu. Build **onedir** (`yt-dlp_win.zip`) menghilangkan
//! ekstraksi per-jalan dan menghemat ~1,1–1,8 detik per resolve, stabil di
//! 1,4–1,6 detik untuk start-up.
//!
//! ## Tata letak di disk
//!
//! ```text
//! <app_data>/bin/
//!   yt-dlp-2026.11.23/          <- versi aktif
//!     yt-dlp.exe
//!     _internal/…
//!   yt-dlp-2026.10.26/          <- SATU versi lama disimpan untuk rollback
//!   yt-dlp.exe                  <- biner satu-file (fallback / non-Windows)
//!   .tmp-xxxx/                  <- folder kerja saat mengekstrak
//! ```
//!
//! ## Aturan yang dipegang
//!
//! - **Verifikasi sebelum dipakai.** Biner hasil ekstrak harus bisa menjalankan
//!   `--version` dan keluar dengan kode 0. Zip rusak atau ekstraksi separuh
//!   tidak boleh pernah menjadi biner aktif.
//! - **Tukar atomik.** Folder versi baru selesai diekstrak & diverifikasi
//!   lebih dulu; baru setelah itu dianggap aktif. Tidak ada keadaan "setengah
//!   terpasang". Aktif/tidaknya ditentukan oleh [`pilih_aktif`] yang membaca
//!   isi disk, bukan oleh penanda terpisah yang bisa desinkron.
//! - **Selalu ada jalan keluar.** Kalau apa pun gagal, pemanggil jatuh ke
//!   biner satu-file. Pemutaran tidak boleh mati karena pembaruan gagal.
//! - **Nama versi divalidasi.** Versi datang dari keluaran biner (bukan input
//!   pengguna), tapi tetap disaring: hanya angka dan titik. Versi yang
//!   mengandung `/`, `..`, atau `\` bisa membuat folder keluar dari `bin/`.

use std::path::{Path, PathBuf};

/// Awalan folder versi. Dipakai juga sebagai penanda "ini folder onedir".
const AWALAN: &str = "yt-dlp-";

/// Nama biner di dalam folder versi.
pub fn nama_biner() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Saring versi supaya aman dipakai sebagai nama folder.
///
/// Mengembalikan `None` kalau tidak ada satu pun karakter yang sah — lebih baik
/// tidak menyimpan versi baru daripada menebak-nebak nama folder.
pub fn versi_aman(versi: &str) -> Option<String> {
    let bersih = versi.trim();
    if bersih.is_empty() || bersih.len() > 32 {
        return None;
    }
    // Hanya angka, titik, dan tanda hubung. Tidak ada pemisah path sama sekali,
    // jadi tidak mungkin keluar dari folder `bin/`.
    if !bersih
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.' || c == '-')
    {
        return None;
    }
    // Harus ada angkanya.
    if !bersih.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(bersih.to_string())
}

/// Folder tempat semua biner dikelola.
pub fn bin_dir(app_data: &Path) -> PathBuf {
    app_data.join("bin")
}

/// Folder untuk satu versi onedir.
pub fn folder_versi(app_data: &Path, versi: &str) -> Option<PathBuf> {
    versi_aman(versi).map(|v| bin_dir(app_data).join(format!("{AWALAN}{v}")))
}

/// Apakah folder ini berisi onedir yang lengkap (biner ada dan berupa file).
///
/// Sengaja TIDAK menjalankan biner — ini dipanggil di jalur cepat saat start,
/// dan menjalankan proses butuh ~1,5 detik. Verifikasi eksekusi dilakukan
/// sekali saat pemasangan ([`perlu_verifikasi`]).
pub fn onedir_lengkap(folder: &Path) -> bool {
    folder.join(nama_biner()).is_file()
}

/// Semua versi onedir yang ada, diurutkan dari terbaru ke terlama.
///
/// Pengurutan memakai perbandingan versi numerik, bukan abjad: sebagai teks,
/// `"2026.9.1"` > `"2026.11.23"` yang jelas salah.
pub fn daftar_versi(app_data: &Path) -> Vec<String> {
    let bin = bin_dir(app_data);
    let Ok(entries) = std::fs::read_dir(&bin) else {
        return Vec::new();
    };
    let mut versi: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let nama = e.file_name().to_string_lossy().to_string();
            let v = nama.strip_prefix(AWALAN)?;
            // Folder tanpa biner lengkap diabaikan: bisa jadi sisa ekstraksi
            // yang gagal sebelum sempat dibersihkan.
            if !onedir_lengkap(&e.path()) {
                return None;
            }
            versi_aman(v)
        })
        .collect();
    versi.sort_by(|a, b| banding_versi(b, a));
    versi
}

/// Bandingkan dua versi bergaya `YYYY.MM.DD` secara numerik per bagian.
///
/// Panjang berbeda ditangani: bagian yang tidak ada dianggap 0, jadi
/// `"2026.11"` < `"2026.11.1"`.
pub fn banding_versi(a: &str, b: &str) -> std::cmp::Ordering {
    let ambil = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|x| x.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (va, vb) = (ambil(a), ambil(b));
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            lain => return lain,
        }
    }
    std::cmp::Ordering::Equal
}

/// Pilih biner yang dipakai.
///
/// Urutan: onedir versi terbaru → biner satu-file → `None`.
///
/// Onedir didahulukan karena alasan performa di atas. Kalau onedir tidak ada
/// (platform lain, atau pemasangan belum pernah berhasil), biner satu-file
/// tetap dipakai — itulah jalur fallback yang menjaga pemutaran tetap hidup.
pub fn pilih_aktif(app_data: &Path) -> Option<PathBuf> {
    if let Some(v) = daftar_versi(app_data).first() {
        if let Some(folder) = folder_versi(app_data, v) {
            let biner = folder.join(nama_biner());
            if biner.is_file() {
                return Some(biner);
            }
        }
    }
    let satu_file = bin_dir(app_data).join(nama_biner());
    if satu_file.is_file() {
        return Some(satu_file);
    }
    None
}

/// Versi yang harus dipertahankan di samping versi terbaru.
///
/// Mengembalikan folder-folder yang boleh dihapus: semua versi selain `aktif`
/// dan satu versi tepat di bawahnya (cadangan untuk rollback).
pub fn versi_yang_dihapus(app_data: &Path, aktif: &str) -> Vec<PathBuf> {
    let semua = daftar_versi(app_data);
    let posisi = semua.iter().position(|v| v == aktif);
    let mut simpan: Vec<&String> = vec![];
    if let Some(i) = posisi {
        simpan.push(&semua[i]);
        if let Some(bawah) = semua.get(i + 1) {
            simpan.push(bawah);
        }
    } else {
        // `aktif` tidak dikenal: simpan dua terbaru supaya tidak menghapus
        // semuanya karena satu argumen yang salah.
        simpan.extend(semua.iter().take(2));
    }

    semua
        .iter()
        .filter(|v| !simpan.contains(v))
        .filter_map(|v| folder_versi(app_data, v))
        .collect()
}

/// Nama folder kerja sementara untuk ekstraksi.
///
/// Diawali titik supaya tidak pernah dianggap versi oleh [`daftar_versi`]
/// (yang hanya menerima nama berawalan `yt-dlp-`).
pub fn folder_sementara(app_data: &Path, tanda: u64) -> PathBuf {
    bin_dir(app_data).join(format!(".tmp-{tanda}"))
}

/// Apakah versi ini perlu diunduh.
///
/// `terpasang` adalah versi onedir terbaru yang ada di disk (kalau ada).
/// Mengembalikan `true` kalau belum ada sama sekali atau versi di disk lebih
/// tua dari `tersedia`.
pub fn perlu_unduh(terpasang: Option<&str>, tersedia: &str) -> bool {
    match terpasang {
        None => true,
        Some(v) => banding_versi(v, tersedia) == std::cmp::Ordering::Less,
    }
}

/// Apakah sudah waktunya memeriksa versi baru.
///
/// Dipisah jadi fungsi murni supaya kebijakan "jangan menembak GitHub setiap
/// start" bisa diuji tanpa menunggu berhari-hari.
pub fn sudah_waktunya_cek(terakhir_cek_ms: i64, sekarang_ms: i64, jeda_ms: i64) -> bool {
    if terakhir_cek_ms <= 0 {
        return true;
    }
    // Waktu mundur (jam diubah pengguna) jangan mengunci pembaruan selamanya.
    if sekarang_ms < terakhir_cek_ms {
        return true;
    }
    sekarang_ms.saturating_sub(terakhir_cek_ms) >= jeda_ms
}

/// Jeda antar pemeriksaan versi: 3 hari.
pub const JEDA_CEK_MS: i64 = 3 * 24 * 60 * 60 * 1000;

/// URL zip onedir Windows.
pub fn url_onedir() -> &'static str {
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip"
}

/// URL biner satu-file (fallback & platform non-Windows).
pub fn url_satufile() -> &'static str {
    if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Folder data sementara yang dibersihkan sendiri.
    struct DirUji(PathBuf);

    impl DirUji {
        fn baru(nama: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "kaset-uji-biner-{nama}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&p);
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for DirUji {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Buat onedir palsu: cukup berkas biner kosong.
    fn buat_versi(app: &Path, versi: &str) {
        let f = folder_versi(app, versi).unwrap();
        fs::create_dir_all(&f).unwrap();
        fs::write(f.join(nama_biner()), b"palsu").unwrap();
    }

    #[test]
    fn versi_aman_menolak_pemisah_path() {
        assert!(versi_aman("../../evil").is_none());
        assert!(versi_aman("2026.11.23/..").is_none());
        assert!(versi_aman("a\\b").is_none());
        assert!(versi_aman("").is_none());
        assert!(versi_aman("   ").is_none());
        assert!(versi_aman("tanpa-angka").is_none());
    }

    #[test]
    fn versi_aman_menerima_format_rilis() {
        assert_eq!(versi_aman("2026.11.23").as_deref(), Some("2026.11.23"));
        assert_eq!(versi_aman(" 2026.11.23 ").as_deref(), Some("2026.11.23"));
        assert_eq!(versi_aman("2026.11.23-1").as_deref(), Some("2026.11.23-1"));
    }

    #[test]
    fn versi_aman_menolak_terlalu_panjang() {
        assert!(versi_aman(&"9".repeat(33)).is_none());
    }

    #[test]
    fn banding_versi_numerik_bukan_abjad() {
        use std::cmp::Ordering;
        // Sebagai teks, "2026.9.1" > "2026.11.23". Itu salah.
        assert_eq!(banding_versi("2026.9.1", "2026.11.23"), Ordering::Less);
        assert_eq!(banding_versi("2026.11.23", "2026.9.1"), Ordering::Greater);
        assert_eq!(banding_versi("2026.11.23", "2026.11.23"), Ordering::Equal);
        // Panjang berbeda: bagian yang hilang dianggap 0.
        assert_eq!(banding_versi("2026.11", "2026.11.1"), Ordering::Less);
    }

    #[test]
    fn daftar_versi_urut_terbaru_dulu() {
        let d = DirUji::baru("daftar");
        buat_versi(d.path(), "2026.9.1");
        buat_versi(d.path(), "2026.11.23");
        buat_versi(d.path(), "2026.10.26");
        assert_eq!(
            daftar_versi(d.path()),
            vec!["2026.11.23", "2026.10.26", "2026.9.1"]
        );
    }

    #[test]
    fn folder_tanpa_biner_diabaikan() {
        let d = DirUji::baru("taklengkap");
        // Folder versi ada tapi binernya tidak — sisa ekstraksi yang gagal.
        let f = folder_versi(d.path(), "2026.11.23").unwrap();
        fs::create_dir_all(&f).unwrap();
        assert!(daftar_versi(d.path()).is_empty(), "folder rusak tidak boleh dianggap versi");
    }

    #[test]
    fn folder_kerja_sementara_tidak_dianggap_versi() {
        let d = DirUji::baru("tmp");
        let t = folder_sementara(d.path(), 12345);
        fs::create_dir_all(&t).unwrap();
        fs::write(t.join(nama_biner()), b"palsu").unwrap();
        assert!(daftar_versi(d.path()).is_empty(), ".tmp-* bukan versi");
    }

    #[test]
    fn pilih_aktif_mendahulukan_onedir_terbaru() {
        let d = DirUji::baru("pilih");
        buat_versi(d.path(), "2026.10.26");
        buat_versi(d.path(), "2026.11.23");
        // Biner satu-file juga ada; onedir harus menang.
        fs::write(bin_dir(d.path()).join(nama_biner()), b"satufile").unwrap();
        let aktif = pilih_aktif(d.path()).unwrap();
        assert!(aktif.to_string_lossy().contains("2026.11.23"), "dapat {}", aktif.display());
    }

    #[test]
    fn pilih_aktif_jatuh_ke_satufile_kalau_onedir_tidak_ada() {
        let d = DirUji::baru("fallback");
        let bin = bin_dir(d.path());
        fs::create_dir_all(&bin).unwrap();
        let satu = bin.join(nama_biner());
        fs::write(&satu, b"satufile").unwrap();
        assert_eq!(pilih_aktif(d.path()), Some(satu));
    }

    #[test]
    fn pilih_aktif_none_kalau_kosong() {
        let d = DirUji::baru("kosong");
        assert_eq!(pilih_aktif(d.path()), None);
    }

    #[test]
    fn simpan_satu_versi_lama_saja() {
        let d = DirUji::baru("simpan");
        buat_versi(d.path(), "2026.9.1");
        buat_versi(d.path(), "2026.10.26");
        buat_versi(d.path(), "2026.11.23");
        let hapus = versi_yang_dihapus(d.path(), "2026.11.23");
        // Yang dihapus hanya 2026.9.1: aktif + satu di bawahnya disimpan.
        assert_eq!(hapus.len(), 1);
        assert!(hapus[0].to_string_lossy().contains("2026.9.1"));
    }

    #[test]
    fn versi_dihapus_tidak_menyentuh_dua_terbaru() {
        let d = DirUji::baru("aman");
        buat_versi(d.path(), "2026.10.26");
        buat_versi(d.path(), "2026.11.23");
        assert!(versi_yang_dihapus(d.path(), "2026.11.23").is_empty());
    }

    #[test]
    fn perlu_unduh_saat_belum_ada() {
        assert!(perlu_unduh(None, "2026.11.23"));
    }

    #[test]
    fn tidak_perlu_unduh_kalau_sama_atau_lebih_baru() {
        assert!(!perlu_unduh(Some("2026.11.23"), "2026.11.23"));
        assert!(!perlu_unduh(Some("2026.12.1"), "2026.11.23"));
    }

    #[test]
    fn perlu_unduh_kalau_disk_lebih_tua() {
        assert!(perlu_unduh(Some("2026.9.1"), "2026.11.23"));
        assert!(perlu_unduh(Some("2026.11"), "2026.11.23"));
    }

    #[test]
    fn cek_versi_tidak_tiap_start() {
        let jeda = JEDA_CEK_MS;
        let sekarang = 1_000_000_000_000;
        // Belum pernah dicek.
        assert!(sudah_waktunya_cek(0, sekarang, jeda));
        // Baru saja dicek.
        assert!(!sudah_waktunya_cek(sekarang - 1000, sekarang, jeda));
        // Sudah lewat jeda.
        assert!(sudah_waktunya_cek(sekarang - jeda - 1, sekarang, jeda));
        // Jam mundur: jangan mengunci selamanya.
        assert!(sudah_waktunya_cek(sekarang + 10_000_000, sekarang, jeda));
    }
}