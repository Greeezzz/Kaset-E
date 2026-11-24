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

/// Versi lama yang boleh dihapus karena sudah cukup lama tidak dipakai.
///
/// Bedanya dengan [`versi_yang_dihapus`]: fungsi itu menyimpan SATU versi
/// cadangan tanpa memandang umur, jadi cadangan bisa menumpuk selamanya kalau
/// pembaruan sering terjadi. Fungsi ini menghapus cadangan yang sudah berumur
/// lebih dari `umur_maks_hari`, karena versi baru jelas terbukti dipakai.
///
/// Versi AKTIF tidak pernah dihapus, apa pun umurnya.
pub fn cadangan_kadaluarsa(
    app_data: &Path,
    aktif: &str,
    umur_maks_hari: i64,
    sekarang_ms: i64,
) -> Vec<PathBuf> {
    let batas = sekarang_ms.saturating_sub(umur_maks_hari * 86_400_000);
    daftar_versi(app_data)
        .into_iter()
        .filter(|v| v != aktif)
        .filter_map(|v| {
            let folder = folder_versi(app_data, &v)?;
            // Umur diambil dari waktu modifikasi folder: itu kira-kira kapan
            // versi ini dipasang. Kalau tidak terbaca, JANGAN hapus — lebih
            // baik menyisakan berkas daripada menghapus yang masih dipakai.
            let meta = std::fs::metadata(&folder).ok()?;
            let diubah = meta.modified().ok()?;
            let ms = diubah
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            (ms < batas).then_some(folder)
        })
        .collect()
}

/// Umur maksimum cadangan versi lama: 7 hari.
pub const UMUR_CADANGAN_HARI: i64 = 7;

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

/// Nama berkas daftar hash resmi yt-dlp.
pub const NAMA_SUMS: &str = "SHA2-256SUMS";

/// URL daftar hash resmi.
pub fn url_sums() -> String {
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS".to_string()
}

/// Nama berkas zip onedir di dalam daftar hash.
pub fn nama_zip_onedir() -> &'static str {
    "yt-dlp_win.zip"
}

/// Apakah URL menunjuk ke rilis resmi yt-dlp lewat HTTPS.
///
/// Daftar hash hanya berguna kalau datang dari sumber yang benar: kalau
/// penyerang bisa mengubah zip, ia juga bisa mengubah daftar hash-nya. Jadi
/// host DAN skema diperiksa, bukan hanya "ada https di suatu tempat".
pub fn url_rilis_sah(url: &str) -> bool {
    let sisa = match url.strip_prefix("https://") {
        Some(s) => s,
        None => return false,
    };
    // Host harus persis github.com, lalu path di repo yt-dlp/yt-dlp.
    let (host, path) = match sisa.split_once('/') {
        Some((h, p)) => (h, p),
        None => return false,
    };
    host == "github.com" && path.starts_with("yt-dlp/yt-dlp/")
}

/// Cari hash SHA-256 untuk satu nama berkas di isi `SHA2-256SUMS`.
///
/// Formatnya `<64 hex><spasi><spasi atau *><nama>`, mis.
/// `824860...037a5f  yt-dlp_win.zip`. Tanda `*` menandai mode biner dan harus
/// ikut ditangani — beberapa alat menuliskannya begitu.
///
/// Mengembalikan hash dalam huruf kecil, atau `None` kalau berkasnya tidak
/// tercantum.
pub fn hash_untuk(sums: &str, nama_berkas: &str) -> Option<String> {
    for baris in sums.lines() {
        let baris = baris.trim();
        if baris.is_empty() || baris.starts_with('#') {
            continue;
        }
        let (hash, sisa) = match baris.split_once(char::is_whitespace) {
            Some(v) => v,
            None => continue,
        };
        // Buang spasi/tanda bintang pemisah mode biner.
        let nama = sisa.trim_start().trim_start_matches('*');
        if nama != nama_berkas {
            continue;
        }
        let hash = hash.trim().to_ascii_lowercase();
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        return Some(hash);
    }
    None
}

/// Hitung SHA-256 dari byte dan bandingkan dengan hash yang diharapkan.
///
/// Perbandingan tidak peka huruf besar/kecil karena daftar resmi memakai huruf
/// kecil sementara sebagian alat menulis huruf besar.
pub fn hash_cocok(bytes: &[u8], diharapkan: &str) -> bool {
    use sha2::{Digest, Sha256};
    let diharapkan = diharapkan.trim().to_ascii_lowercase();
    if diharapkan.len() != 64 {
        return false;
    }
    let mut h = Sha256::new();
    h.update(bytes);
    let hasil = h.finalize();
    let hex: String = hasil.iter().map(|b| format!("{b:02x}")).collect();
    hex == diharapkan
}

/// URL zip onedir Windows.
///
/// Bisa ditimpa lewat `KASET_YTDLP_URL_UJI` **hanya untuk pengujian**. Nilainya
/// tetap harus lolos [`url_rilis_sah`], jadi ini tidak menjadi celah: penimpaan
/// ke host lain akan ditolak sebelum diunduh.
pub fn url_onedir() -> String {
    if let Ok(u) = std::env::var("KASET_YTDLP_URL_UJI") {
        return u;
    }
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_win.zip".to_string()
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
    // ------------------------------------------------- integritas unduhan (A2.4)

    /// Isi asli SHA2-256SUMS (dipotong) dari rilis 2026.11.23.
    const SUMS_CONTOH: &str = "\
e8665ed64d6b9172773e812f891fb707a0cb1ee8d9ef4fc1acb00cabee4c5256  yt-dlp\n\
622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c  yt-dlp.exe\n\
824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f  yt-dlp_win.zip\n\
289733d1c9be7b7be49f6eda99b1568a4a3bea3e56b047d2b9c57b8dc5eb66a4  yt-dlp_win_arm64.zip\n";

    #[test]
    fn hash_ditemukan_di_daftar_resmi() {
        let h = hash_untuk(SUMS_CONTOH, "yt-dlp_win.zip").unwrap();
        assert_eq!(
            h,
            "824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f"
        );
    }

    #[test]
    fn hash_berkas_lain_tidak_tertukar() {
        // Awalan nama mirip: yt-dlp_win.zip vs yt-dlp_win_arm64.zip.
        let h = hash_untuk(SUMS_CONTOH, "yt-dlp_win_arm64.zip").unwrap();
        assert!(h.starts_with("289733d1"));
    }

    #[test]
    fn berkas_tidak_tercantum_mengembalikan_none() {
        assert!(hash_untuk(SUMS_CONTOH, "yt-dlp_tidak_ada.zip").is_none());
    }

    #[test]
    fn daftar_kosong_atau_rusak_tidak_panik() {
        assert!(hash_untuk("", "yt-dlp_win.zip").is_none());
        assert!(hash_untuk("   \n\n", "yt-dlp_win.zip").is_none());
        // Hash bukan 64 hex.
        assert!(hash_untuk("bukanhash  yt-dlp_win.zip", "yt-dlp_win.zip").is_none());
        // Baris tanpa nama berkas.
        assert!(hash_untuk("824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f", "x").is_none());
    }

    #[test]
    fn tanda_bintang_mode_biner_ditangani() {
        // Beberapa alat menulis "hash *nama".
        let s = "824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f *yt-dlp_win.zip\n";
        assert!(hash_untuk(s, "yt-dlp_win.zip").is_some());
    }

    #[test]
    fn baris_komentar_dilewati() {
        let s = "# ini komentar\n824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f  yt-dlp_win.zip\n";
        assert!(hash_untuk(s, "yt-dlp_win.zip").is_some());
    }

    #[test]
    fn hash_cocok_untuk_data_benar() {
        // SHA-256 dari "abc".
        let h = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(hash_cocok(b"abc", h));
        // Huruf besar juga diterima.
        assert!(hash_cocok(b"abc", &h.to_uppercase()));
    }

    #[test]
    fn hash_tidak_cocok_untuk_data_berbeda() {
        let h = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(!hash_cocok(b"abd", h));
        assert!(!hash_cocok(b"", h));
        // Satu bit berubah di tengah data.
        assert!(!hash_cocok(b"abC", h));
    }

    #[test]
    fn hash_diharapkan_rusak_ditolak() {
        assert!(!hash_cocok(b"abc", ""));
        assert!(!hash_cocok(b"abc", "terlalu-pendek"));
        assert!(!hash_cocok(b"abc", &"z".repeat(64)));
    }

    #[test]
    fn url_rilis_resmi_diterima() {
        assert!(url_rilis_sah(
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"
        ));
        assert!(url_rilis_sah(
            "https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp_win.zip"
        ));
    }

    #[test]
    fn url_selain_github_ditolak() {
        // HTTP biasa: bisa diubah di jalan.
        assert!(!url_rilis_sah("http://github.com/yt-dlp/yt-dlp/x"));
        // Host mirip tapi bukan github.com.
        assert!(!url_rilis_sah("https://github.com.evil.test/yt-dlp/yt-dlp/x"));
        assert!(!url_rilis_sah("https://evil.test/github.com/yt-dlp/yt-dlp/x"));
        assert!(!url_rilis_sah("https://raw.githubusercontent.com/yt-dlp/yt-dlp/x"));
        // Repo lain di github.com.
        assert!(!url_rilis_sah("https://github.com/penipu/yt-dlp/x"));
        assert!(!url_rilis_sah(""));
    }

    #[test]
    fn url_dengan_userinfo_ditolak() {
        // Trik klasik: https://github.com@evil.test/...
        assert!(!url_rilis_sah("https://github.com@evil.test/yt-dlp/yt-dlp/x"));
    }

    // ---------------------------------------- pembersihan cadangan (A2.5)

    #[test]
    fn cadangan_baru_tidak_dihapus() {
        let d = DirUji::baru("cadangan-baru");
        buat_versi(d.path(), "2026.10.26");
        buat_versi(d.path(), "2026.11.23");
        // Baru saja dipasang: belum lewat 7 hari.
        let hapus = cadangan_kadaluarsa(d.path(), "2026.11.23", UMUR_CADANGAN_HARI, sekarang_ms());
        assert!(hapus.is_empty(), "cadangan baru tidak boleh dihapus: {hapus:?}");
    }

    #[test]
    fn cadangan_tua_dihapus() {
        let d = DirUji::baru("cadangan-tua");
        buat_versi(d.path(), "2026.01.01");
        buat_versi(d.path(), "2026.11.23");
        // "Sekarang" = 30 hari setelah folder dibuat.
        let hapus =
            cadangan_kadaluarsa(d.path(), "2026.11.23", UMUR_CADANGAN_HARI, sekarang_ms() + 30 * 86_400_000);
        assert_eq!(hapus.len(), 1, "cadangan lama harus dihapus: {hapus:?}");
        assert!(hapus[0].to_string_lossy().contains("2026.01.01"));
    }

    #[test]
    fn versi_aktif_tidak_pernah_dihapus() {
        let d = DirUji::baru("aktif-aman");
        buat_versi(d.path(), "2026.11.23");
        // Meski "sekarang" jauh di masa depan, versi aktif tetap disimpan.
        let hapus =
            cadangan_kadaluarsa(d.path(), "2026.11.23", UMUR_CADANGAN_HARI, sekarang_ms() + 3650 * 86_400_000);
        assert!(hapus.is_empty(), "versi aktif tidak boleh dihapus: {hapus:?}");
    }

    fn sekarang_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Uji integrasi memakai berkas zip nyata kalau tersedia.
    ///
    /// Dilewati (bukan gagal) kalau berkasnya tidak ada, karena berkas itu
    /// hasil unduhan manual dan tidak boleh jadi syarat build.
    #[test]
    fn hash_zip_nyata_cocok_dengan_daftar_resmi() {
        let kandidat = [
            r"C:\Users\USER\AppData\Local\Temp\ytdlp_dir\ytdlp_win.zip",
            "/tmp/ytdlp_dir/ytdlp_win.zip",
        ];
        let Some(path) = kandidat.iter().find(|p| std::path::Path::new(p).is_file()) else {
            eprintln!("dilewati: zip contoh tidak ada");
            return;
        };
        let bytes = std::fs::read(path).unwrap();
        let resmi = "824860984b96ca01de09f98f7bfd74ed7bbdce72a3340b51af8b9dc5ee037a5f";
        assert!(hash_cocok(&bytes, resmi), "zip resmi harus cocok dengan hash resminya");

        // Ubah satu byte: harus DITOLAK. Ini yang membuktikan verifikasi tidak
        // asal lolos.
        let mut rusak = bytes.clone();
        let tengah = rusak.len() / 2;
        rusak[tengah] ^= 0xFF;
        assert!(
            !hash_cocok(&rusak, resmi),
            "zip yang diubah satu byte harus ditolak"
        );
    }

}