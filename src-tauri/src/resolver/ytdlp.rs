use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::process::Command;

use crate::catalog::StreamResolver;
use crate::error::{AppError, AppResult};
use crate::models::{Quality, ResolvedStream};

/// Jangan tampilkan jendela konsol saat menjalankan proses anak di Windows.
///
/// Tanpa ini, setiap klik putar memunculkan jendela cmd hitam sekejap — proses
/// anak dibuat sebagai proses konsol baru, dan Windows selalu menampilkan
/// jendelanya. `CREATE_NO_WINDOW` menyembunyikannya tanpa mengubah apa pun
/// soal stdio: stdout/stderr tetap bisa ditangkap lewat pipe.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Siapkan `Command` supaya tidak ada jendela konsol yang muncul.
///
/// Di platform lain fungsi ini tidak melakukan apa pun; hanya Windows yang
/// punya masalah jendela konsol untuk proses anak.
fn tanpa_jendela(cmd: &mut Command) -> &mut Command {
    // `tokio::process::Command` punya `creation_flags` sendiri di Windows,
    // jadi tidak perlu mengimpor `std::os::windows::process::CommandExt`.
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Batas waktu satu pemanggilan yt-dlp. Ekstraksi normal 2–5 detik; kalau lebih
/// dari ini jaringan atau YouTube sedang bermasalah, lebih baik gagal cepat.
const TIMEOUT: Duration = Duration::from_secs(25);

/// Resolver stream memakai `yt-dlp` yang diinstal pengguna.
///
/// Kenapa bukan crate Rust? Sudah diuji: `rusty_ytdl` 0.7.4 (rilis Agu 2024)
/// mengembalikan 22 format tanpa satu pun URL (`url_len=0`) — crate itu kalah
/// oleh perubahan YouTube. yt-dlp aktif dan berhasil. Ini persis skenario yang
/// sudah diantisipasi ARCHITECTURE.md §3: ekstraksi dibungkus trait supaya bisa
/// ditukar tanpa menyentuh UI.
///
/// Sesuai AGENTS.md, binary yt-dlp TIDAK dibundel ke repo/aplikasi. Kita memakai
/// yang ada di PATH pengguna. Kalau tidak ada, error-nya harus ramah.
pub struct YtDlpResolver {
    binary: PathBuf,
}

#[derive(Debug, Deserialize)]
struct YtDlpFormat {
    #[serde(default)]
    format_id: Option<String>,
    #[serde(default)]
    ext: Option<String>,
    #[serde(default)]
    acodec: Option<String>,
    #[serde(default)]
    vcodec: Option<String>,
    #[serde(default)]
    abr: Option<f64>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtDlpOutput {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    formats: Vec<YtDlpFormat>,
}

impl YtDlpResolver {
    /// Mencari yt-dlp di PATH. Gagal di sini berarti fitur putar belum bisa
    /// dipakai, tapi aplikasi tetap boleh jalan (pencarian tidak tergantung ini).
    pub fn detect() -> AppResult<Self> {
        let candidates = if cfg!(windows) {
            vec!["yt-dlp.exe", "yt-dlp"]
        } else {
            vec!["yt-dlp"]
        };

        for name in candidates {
            if let Some(path) = which(name) {
                return Ok(Self { binary: path });
            }
        }

        Err(AppError::stream(
            "yt-dlp tidak ditemukan. Pasang yt-dlp dulu untuk bisa memutar lagu.",
            true,
        ))
    }

    /// Untuk test: pakai path eksplisit.
    pub fn with_binary(binary: impl Into<PathBuf>) -> Self {
        Self {
            binary: binary.into(),
        }
    }
}

/// Cari biner di PATH atau lewat env var eksplisit.
///
/// **Tidak** menyentuh folder data aplikasi. Itu disengaja: kalau fungsi ini
/// juga mengembalikan biner lama di `<data>/yt-dlp.exe`, `ensure_available`
/// akan berhenti di situ dan pengguna yang sudah punya biner satu-file TIDAK
/// PERNAH dimigrasi ke onedir. Pemisahan ini yang membuat migrasi mungkin.
///
/// Urutan: env `KASET_YTDLP_PATH` (pilihan eksplisit pengguna/dev) → PATH.
fn which(name: &str) -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("KASET_YTDLP_PATH") {
        let p = PathBuf::from(explicit);
        if p.is_file() {
            return Some(p);
        }
    }

    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// URL rilis resmi yt-dlp. Dipakai untuk mengunduh binary di Windows/macOS
/// supaya pengguna tidak perlu memasang apa pun secara manual.
#[cfg(not(target_os = "linux"))]
fn release_url() -> &'static str {
    if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else {
        // macOS: tidak ada binary universal tunggal; pakai varian macos.
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    }
}

/// Memastikan yt-dlp tersedia. Kalau belum ada, unduh ke folder data aplikasi.
///
/// Kenapa tidak dibundel saja ke repo? Karena `AGENTS.md` melarang menyertakan
/// binary ekstraktor pihak ketiga ke dalam repo. Unduhan saat runtime tidak
/// melanggar aturan itu, dan membuat aplikasi bisa dipakai orang lain tanpa
/// langkah manual. Kalau unduhan gagal (offline), aplikasi tetap jalan —
/// pemutaran saja yang nonaktif, dan pesannya jelas.
pub async fn ensure_available() -> AppResult<PathBuf> {
    // 1. Pilihan eksplisit pengguna/dev selalu menang.
    if let Ok(explicit) = std::env::var("KASET_YTDLP_PATH") {
        let p = PathBuf::from(explicit);
        if p.is_file() {
            return Ok(p);
        }
    }

    // 2. Biner yang dikelola Kaset sendiri (onedir diutamakan).
    //
    // Onedir didahulukan daripada biner satu-file warisan di `<data>/yt-dlp.exe`
    // — kalau tidak, pengguna lama tidak akan pernah pindah dan tetap kena
    // ekstraksi 30 MB tiap resolve.
    #[cfg(windows)]
    if let Some(dir) = crate::paths::data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Some(path) = pasang_onedir(&dir).await {
            return Ok(path);
        }
        // Onedir gagal (offline dsb): pakai biner satu-file lama kalau ada,
        // supaya pemutaran tetap jalan.
        let lama = dir.join("yt-dlp.exe");
        if lama.is_file() {
            tracing::warn!(biner = %lama.display(), "onedir tidak tersedia; memakai biner satu-file lama");
            return Ok(lama);
        }
    }

    // 3. PATH sistem.
    if let Some(path) = which("yt-dlp.exe").or_else(|| which("yt-dlp")) {
        return Ok(path);
    }

    #[cfg(target_os = "linux")]
    {
        Err(AppError::stream(
            "yt-dlp tidak ditemukan. Pasang lewat package manager distro kamu \
             (mis. `sudo apt install yt-dlp` atau `pipx install yt-dlp`), lalu buka ulang Kaset.",
            true,
        ))
    }

    #[cfg(not(target_os = "linux"))]
    {
        let dir = crate::paths::data_dir()
            .ok_or_else(|| AppError::stream("tidak bisa menentukan folder data aplikasi", true))?;
        std::fs::create_dir_all(&dir)?;

        let file_name = if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        };
        let dest = dir.join(file_name);
        let url = release_url();

        tracing::info!(%url, dest = %dest.display(), "mengunduh yt-dlp");

        let resp = reqwest::Client::builder()
            // Unduhan binary bisa besar (~24 MB di Windows); beri waktu layak.
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| AppError::stream(format!("gagal menyiapkan klien unduhan: {e}"), false))?
            .get(url)
            .send()
            .await
            .map_err(|e| {
                AppError::stream(
                    format!("gagal mengunduh yt-dlp (periksa koneksi): {e}"),
                    false,
                )
            })?;

        if !resp.status().is_success() {
            return Err(AppError::stream(
                format!("unduhan yt-dlp gagal dengan status {}", resp.status()),
                false,
            ));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::stream(format!("unduhan terputus: {e}"), false))?;

        // Tulis ke file sementara lalu pindahkan: kalau unduhan/penulisan gagal
        // di tengah, kita tidak meninggalkan file rusak yang terlihat valid.
        let tmp = dest.with_extension("part");
        tokio::fs::write(&tmp, &bytes).await?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(&tmp).await?.permissions();
            perms.set_mode(0o755);
            tokio::fs::set_permissions(&tmp, perms).await?;
        }

        tokio::fs::rename(&tmp, &dest).await?;

        tracing::info!(size = bytes.len(), "yt-dlp selesai diunduh");
        Ok(dest)
    }
}

/// Hapus cadangan versi lama yang sudah berumur lebih dari beberapa hari.
///
/// Dipanggil saat start. Terpisah dari pemeriksaan versi baru: pembersihan ini
/// tidak butuh jaringan dan harus jalan meski offline.
#[cfg(windows)]
pub fn bersihkan_cadangan_lama() {
    let Some(dir) = crate::paths::data_dir() else {
        return;
    };
    let Some(aktif) = super::biner::daftar_versi(&dir).into_iter().next() else {
        return;
    };
    let hapus = super::biner::cadangan_kadaluarsa(
        &dir,
        &aktif,
        super::biner::UMUR_CADANGAN_HARI,
        sekarang_ms(),
    );
    for folder in hapus {
        match std::fs::remove_dir_all(&folder) {
            Ok(()) => tracing::info!(folder = %folder.display(), "cadangan yt-dlp lama dihapus"),
            Err(e) => {
                // Gagal hapus bukan masalah: cuma makan disk. Bisa jadi folder
                // masih dipakai proses lain.
                tracing::debug!(folder = %folder.display(), error = %e, "gagal menghapus cadangan yt-dlp")
            }
        }
    }
}

/// Periksa versi terbaru di background dan pasang kalau sudah waktunya.
///
/// Dipanggil setelah resolver aktif — **tidak pernah** memblokir pemutaran.
/// Kebijakan: paling sering sekali per [`biner::JEDA_CEK_MS`] (3 hari), karena
/// yt-dlp rilis hampir tiap hari dan menembak GitHub setiap start itu boros
/// sekaligus tidak sopan.
///
/// Kegagalan apa pun hanya dicatat: biner lama tetap dipakai. Ini penting —
/// pembaruan otomatis yang bisa mematikan pemutaran lebih buruk daripada
/// versi yang agak tua.
#[cfg(windows)]
pub async fn cek_pembaruan_latar(db: &crate::db::Db) {
    /// Kunci `settings` untuk waktu cek terakhir.
    const KUNCI_CEK: &str = "ytdlp_cek_terakhir";

    let Some(dir) = crate::paths::data_dir() else {
        return;
    };
    let sekarang = sekarang_ms();

    // Kapan terakhir dicek: disimpan di `settings` supaya bertahan lintas sesi.
    let terakhir = crate::db::get_setting(db, KUNCI_CEK)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);

    if !super::biner::sudah_waktunya_cek(terakhir, sekarang, super::biner::JEDA_CEK_MS) {
        tracing::debug!("cek pembaruan yt-dlp dilewati (belum waktunya)");
        return;
    }

    // Tandai lebih dulu: kalau pengecekan ini gagal, kita tidak mencoba lagi
    // di setiap start berikutnya dan menghujani GitHub.
    let _ = crate::db::set_setting(db, KUNCI_CEK, &sekarang.to_string());

    let terpasang = super::biner::daftar_versi(&dir).into_iter().next();
    let tersedia = match versi_terbaru_jaringan().await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "gagal memeriksa versi yt-dlp terbaru");
            return;
        }
    };

    if !super::biner::perlu_unduh(terpasang.as_deref(), &tersedia) {
        tracing::debug!(
            terpasang = terpasang.as_deref().unwrap_or("-"),
            tersedia = %tersedia,
            "yt-dlp sudah terbaru"
        );
        return;
    }

    tracing::info!(
        terpasang = terpasang.as_deref().unwrap_or("-"),
        tersedia = %tersedia,
        "yt-dlp versi baru tersedia, memasang di background"
    );

    // Pemasangan memakai jalur yang sama dengan pemasangan pertama; kalau
    // gagal, versi lama tetap ada dan tetap dipakai.
    match unduh_onedir_terverifikasi().await {
        Ok(bytes) => {
            let tanda = sekarang as u64;
            let kerja = super::biner::folder_sementara(&dir, tanda);
            let hasil = ekstrak_dan_pasang(&dir, &kerja, &bytes).await;
            let _ = tokio::fs::remove_dir_all(&kerja).await;
            match hasil {
                Ok(p) => tracing::info!(biner = %p.display(), "yt-dlp diperbarui di background"),
                Err(e) => tracing::warn!(error = %e, "pembaruan yt-dlp gagal; versi lama tetap dipakai"),
            }
        }
        Err(e) => tracing::warn!(error = %e, "gagal mengunduh pembaruan yt-dlp"),
    }
}

/// Tanya GitHub rilis terbaru, ambil nomor versinya saja.
///
/// Memakai API rilis (bukan menjalankan biner) supaya bisa tahu versi tanpa
/// mengunduh 22 MB lebih dulu.
#[cfg(windows)]
async fn versi_terbaru_jaringan() -> AppResult<String> {
    #[derive(serde::Deserialize)]
    struct Rilis {
        tag_name: String,
    }
    let resp = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        // GitHub menolak permintaan tanpa User-Agent.
        .user_agent("kaset/0")
        .build()
        .map_err(|e| AppError::stream(format!("klien GitHub: {e}"), false))?
        .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
        .send()
        .await
        .map_err(|e| AppError::stream(format!("gagal menghubungi GitHub: {e}"), false))?;
    if !resp.status().is_success() {
        return Err(AppError::stream(
            format!("GitHub menjawab {}", resp.status()),
            false,
        ));
    }
    let rilis: Rilis = resp
        .json()
        .await
        .map_err(|e| AppError::stream(format!("jawaban GitHub tidak terbaca: {e}"), false))?;
    Ok(rilis.tag_name)
}

/// Epoch ms sekarang.
fn sekarang_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Apakah Kaset sedang menyiapkan pemutar (unduh + ekstrak pertama kali).
///
/// Dibaca UI supaya pengguna melihat "MENYIAPKAN PEMUTAR…" alih-alih tombol
/// play yang diam. Tanpa ini, unduhan 22,8 MB + ekstraksi 3,5 detik terlihat
/// seperti aplikasi rusak.
static SEDANG_MENYIAPKAN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// True selama unduhan/ekstraksi pertama berjalan.
pub fn sedang_menyiapkan() -> bool {
    SEDANG_MENYIAPKAN.load(std::sync::atomic::Ordering::Relaxed)
}

/// Pasang/refresh build onedir di Windows.
///
/// Mengembalikan `None` kalau apa pun gagal — pemanggil lalu jatuh ke biner
/// satu-file. Kegagalan di sini **tidak boleh** mematikan pemutaran, jadi
/// semua error ditelan dengan `warn!` dan bukan `?`.
///
/// Alur: unduh zip → ekstrak ke folder sementara → jalankan `--version` untuk
/// memastikan biner benar-benar bisa dipakai → pindahkan atomik ke
/// `bin/yt-dlp-<versi>/` → hapus versi lama di luar satu cadangan.
#[cfg(windows)]
async fn pasang_onedir(dir: &std::path::Path) -> Option<PathBuf> {
    use super::biner;

    // Sudah ada versi terpasang? Pakai itu, tidak perlu menyentuh jaringan.
    if let Some(biner) = biner::pilih_aktif(dir) {
        tracing::debug!(biner = %biner.display(), "yt-dlp onedir sudah terpasang");
        return Some(biner);
    }

    tracing::info!("menyiapkan yt-dlp onedir (unduh + ekstrak sekali)");
    // Penanda untuk UI. Di-reset di semua jalur keluar lewat penjaga Drop di
    // bawah, jadi tidak mungkin tertinggal `true` kalau ada error di tengah.
    struct Penanda;
    impl Drop for Penanda {
        fn drop(&mut self) {
            SEDANG_MENYIAPKAN.store(false, std::sync::atomic::Ordering::Relaxed);
        }
    }
    SEDANG_MENYIAPKAN.store(true, std::sync::atomic::Ordering::Relaxed);
    let _penanda = Penanda;

    let zip_bytes = match unduh_onedir_terverifikasi().await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = %e, "gagal mengunduh zip onedir; memakai biner satu-file");
            return None;
        }
    };
    tracing::info!(size = zip_bytes.len(), "zip onedir terunduh");

    let tanda = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let kerja = biner::folder_sementara(dir, tanda);

    let hasil = ekstrak_dan_pasang(dir, &kerja, &zip_bytes).await;
    // Bersihkan folder kerja apa pun hasilnya.
    let _ = tokio::fs::remove_dir_all(&kerja).await;

    match hasil {
        Ok(path) => Some(path),
        Err(e) => {
            tracing::warn!(error = %e, "pemasangan onedir gagal; memakai biner satu-file");
            None
        }
    }
}

/// Bagian yang bisa gagal dari [`pasang_onedir`], dipisah supaya folder kerja
/// selalu dibersihkan pemanggil.
#[cfg(windows)]
async fn ekstrak_dan_pasang(
    dir: &std::path::Path,
    kerja: &std::path::Path,
    zip_bytes: &[u8],
) -> AppResult<PathBuf> {
    use super::biner;

    tokio::fs::create_dir_all(kerja).await?;

    // Ekstraksi zip adalah kerja CPU/disk; jalankan di thread blocking supaya
    // tidak menahan runtime async.
    let kerja_owned = kerja.to_path_buf();
    let bytes_owned = zip_bytes.to_vec();
    tokio::task::spawn_blocking(move || ekstrak_zip(&bytes_owned, &kerja_owned))
        .await
        .map_err(|e| AppError::stream(format!("ekstraksi terhenti: {e}"), false))??;

    let biner_baru = kerja.join(biner::nama_biner());
    if !biner_baru.is_file() {
        return Err(AppError::stream(
            "zip onedir tidak berisi yt-dlp.exe".to_string(),
            false,
        ));
    }

    // Verifikasi SEBELUM dipakai: zip rusak atau ekstraksi separuh harus
    // ketahuan di sini, bukan saat pengguna menekan play.
    //
    // Dijalankan dari SALINAN, bukan biner aslinya. Di Windows, menjalankan
    // sebuah .exe membuat berkas itu terkunci selama proses induk masih hidup —
    // dan `rename` folder sesudahnya gagal dengan "Access is denied". Itu
    // benar-benar terjadi saat diuji: pembaruan mendeteksi versi baru,
    // mengunduh, memverifikasi, lalu gagal memindahkan foldernya.
    let verifikasi = kerja.join("uji-versi.exe");
    tokio::fs::copy(&biner_baru, &verifikasi).await?;
    let versi = jalankan_versi(&verifikasi).await?;
    // Salinan tidak dipakai lagi; hapus supaya tidak ikut pindah ke folder versi.
    let _ = tokio::fs::remove_file(&verifikasi).await;
    let versi = biner::versi_aman(&versi)
        .ok_or_else(|| AppError::stream(format!("versi yt-dlp tidak wajar: {versi}"), false))?;
    tracing::info!(%versi, "yt-dlp onedir terverifikasi");

    let tujuan = biner::folder_versi(dir, &versi)
        .ok_or_else(|| AppError::stream("nama folder versi tidak sah".to_string(), false))?;

    // Sudah ada folder dengan versi sama (balapan dua proses)? Pakai yang ada.
    if tujuan.join(biner::nama_biner()).is_file() {
        return Ok(tujuan.join(biner::nama_biner()));
    }

    // Tukar atomik: `rename` folder kerja -> folder versi.
    //
    // Dua hal yang membuat ini gagal di Windows dan sudah diuji:
    //  1. Tujuan sudah ada (sisa percobaan sebelumnya) — `rename` Windows
    //     menolak menimpa direktori. Dihapus dulu.
    //  2. Berkas di folder kerja masih terkunci proses — ditangani dengan
    //     memverifikasi dari salinan, bukan biner aslinya.
    tokio::fs::create_dir_all(biner::bin_dir(dir)).await?;
    if tujuan.exists() {
        tokio::fs::remove_dir_all(&tujuan).await?;
    }
    if let Err(e) = tokio::fs::rename(kerja, &tujuan).await {
        tracing::warn!(error = %e, "rename folder versi gagal; memakai biner di folder kerja");
        if tujuan.join(biner::nama_biner()).is_file() {
            return Ok(tujuan.join(biner::nama_biner()));
        }
        return Err(AppError::stream(format!("gagal memasang folder versi: {e}"), false));
    }

    // Rapikan versi lama: sisakan satu cadangan untuk rollback.
    for usang in biner::versi_yang_dihapus(dir, &versi) {
        if let Err(e) = tokio::fs::remove_dir_all(&usang).await {
            tracing::debug!(folder = %usang.display(), error = %e, "gagal menghapus versi lama");
        } else {
            tracing::info!(folder = %usang.display(), "versi yt-dlp lama dihapus");
        }
    }

    let akhir = tujuan.join(biner::nama_biner());
    tracing::info!(biner = %akhir.display(), "yt-dlp onedir siap dipakai");
    Ok(akhir)
}

/// Ekstrak zip ke folder tujuan (blocking).
///
/// Menolak entri yang mencoba keluar dari folder tujuan. Zip ini datang dari
/// rilis resmi yt-dlp, tapi memeriksanya murah dan mencegah satu kelas bug
/// yang tidak bisa dipulihkan (menulis ke `C:\Windows` dsb).
#[cfg(windows)]
fn ekstrak_zip(bytes: &[u8], tujuan: &std::path::Path) -> AppResult<()> {
    use std::io::Read;

    let reader = std::io::Cursor::new(bytes);
    let mut arsip =
        zip::ZipArchive::new(reader).map_err(|e| AppError::stream(format!("zip rusak: {e}"), false))?;

    for i in 0..arsip.len() {
        let mut entri = arsip
            .by_index(i)
            .map_err(|e| AppError::stream(format!("entri zip rusak: {e}"), false))?;

        // `enclosed_name` menolak path absolut dan `..`.
        let Some(relatif) = entri.enclosed_name() else {
            let nama = String::from_utf8_lossy(entri.name_raw()).into_owned();
            tracing::warn!(nama, "entri zip menolak path tidak aman, dilewati");
            continue;
        };
        let keluar = tujuan.join(relatif);

        if entri.is_dir() {
            std::fs::create_dir_all(&keluar)?;
            continue;
        }
        if let Some(induk) = keluar.parent() {
            std::fs::create_dir_all(induk)?;
        }
        let mut buf = Vec::with_capacity(entri.size() as usize);
        entri.read_to_end(&mut buf)?;
        std::fs::write(&keluar, &buf)?;
    }
    Ok(())
}

/// Jalankan `--version` pada biner dan kembalikan keluarannya.
#[cfg(windows)]
async fn jalankan_versi(biner: &std::path::Path) -> AppResult<String> {
    let mut cmd = Command::new(biner);
    cmd.arg("--version").stdin(Stdio::null()).stderr(Stdio::piped()).stdout(Stdio::piped());
    tanpa_jendela(&mut cmd);
    let out = tokio::time::timeout(Duration::from_secs(60), cmd.output())
        .await
        .map_err(|_| AppError::stream("verifikasi yt-dlp kehabisan waktu".to_string(), false))?
        .map_err(|e| AppError::stream(format!("verifikasi yt-dlp gagal dijalankan: {e}"), false))?;
    if !out.status.success() {
        return Err(AppError::stream(
            format!("yt-dlp hasil ekstrak tidak bisa jalan (kode {:?})", out.status.code()),
            false,
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Unduh zip onedir DAN verifikasi SHA-256 terhadap daftar hash resmi.
///
/// Kenapa hash diperiksa meski HTTPS sudah dipakai: HTTPS melindungi
/// pengiriman, tapi tidak melindungi dari rilis yang diubah di sisi GitHub atau
/// dari proxy yang dipasang pengguna. Daftar hash resmi memberi titik
/// pembanding kedua, dan itu murah.
///
/// Kalau daftar hash tidak bisa diambil atau hash tidak cocok, unduhan
/// DITOLAK. Pemanggil lalu tetap memakai versi yang sudah terpasang — lebih
/// baik memutar dengan versi agak tua daripada memasang biner yang tidak
/// terverifikasi.
#[cfg(windows)]
async fn unduh_onedir_terverifikasi() -> AppResult<Vec<u8>> {
    use super::biner;

    // Jangan pernah mengambil daftar hash dari URL yang bukan rilis resmi:
    // kalau zip bisa diubah, daftar hash-nya juga bisa.
    let url_zip = biner::url_onedir();
    let url_sums = biner::url_sums();
    if !biner::url_rilis_sah(&url_zip) || !biner::url_rilis_sah(&url_sums) {
        return Err(AppError::stream(
            "URL unduhan bukan rilis resmi yt-dlp".to_string(),
            false,
        ));
    }

    let sums = match unduh_bytes(&url_sums).await {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) => {
            // Tanpa daftar hash kita tidak bisa memverifikasi. Menolak lebih
            // aman daripada memasang apa pun yang datang.
            tracing::warn!(error = %e, "gagal mengambil daftar hash; unduhan dibatalkan");
            return Err(AppError::stream(
                format!("gagal mengambil daftar hash resmi: {e}"),
                false,
            ));
        }
    };

    let diharapkan = biner::hash_untuk(&sums, biner::nama_zip_onedir()).ok_or_else(|| {
        tracing::warn!(
            berkas = biner::nama_zip_onedir(),
            "daftar hash resmi tidak mencantumkan berkas ini"
        );
        AppError::stream(
            format!(
                "daftar hash resmi tidak mencantumkan {}",
                biner::nama_zip_onedir()
            ),
            false,
        )
    })?;

    let bytes = unduh_bytes(&url_zip).await?;

    if !biner::hash_cocok(&bytes, &diharapkan) {
        tracing::warn!(
            diharapkan = %diharapkan,
            ukuran = bytes.len(),
            "hash unduhan tidak cocok; berkas ditolak"
        );
        return Err(AppError::stream(
            "hash unduhan yt-dlp tidak cocok — berkas ditolak".to_string(),
            false,
        ));
    }

    tracing::info!(hash = %diharapkan, "hash unduhan yt-dlp cocok");
    Ok(bytes)
}

/// Unduh isi URL jadi byte. Dipakai jalur onedir; jalur satu-file memakai
/// aliran langsung ke berkas karena ukurannya besar.
#[cfg(not(target_os = "linux"))]
async fn unduh_bytes(url: &str) -> AppResult<Vec<u8>> {
    let resp = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| AppError::stream(format!("gagal menyiapkan klien unduhan: {e}"), false))?
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::stream(format!("gagal mengunduh (periksa koneksi): {e}"), false))?;
    if !resp.status().is_success() {
        return Err(AppError::stream(
            format!("unduhan gagal dengan status {}", resp.status()),
            false,
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::stream(format!("unduhan terputus: {e}"), false))?;
    Ok(bytes.to_vec())
}

/// Ambil `expire=<unix>` dari URL googlevideo. URL stream memang membawa masa
/// berlakunya sendiri — lebih jujur daripada menebak durasi tetap.
fn parse_expire_ms(url: &str) -> Option<i64> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("expire=") {
            let secs: i64 = v.parse().ok()?;
            return Some(secs * 1000);
        }
    }
    None
}

/// Pilih format audio terbaik: audio-only, bitrate tertinggi.
/// Kalau tidak ada audio-only (jarang), jatuhkan ke format apa pun yang punya
/// codec audio — lebih baik bunyi daripada gagal total.
fn pick_best_audio(formats: &[YtDlpFormat]) -> Option<&YtDlpFormat> {
    let has_audio = |f: &YtDlpFormat| {
        f.acodec
            .as_deref()
            .map(|c| !c.is_empty() && c != "none")
            .unwrap_or(false)
    };
    let is_audio_only = |f: &YtDlpFormat| {
        has_audio(f)
            && f.vcodec
                .as_deref()
                .map(|c| c.is_empty() || c == "none")
                .unwrap_or(true)
    };

    let audio_only = formats
        .iter()
        .filter(|f| is_audio_only(f) && f.url.is_some())
        .max_by(|a, b| {
            a.abr
                .unwrap_or(0.0)
                .partial_cmp(&b.abr.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    if audio_only.is_some() {
        return audio_only;
    }

    formats
        .iter()
        .filter(|f| has_audio(f) && f.url.is_some())
        .max_by(|a, b| {
            a.abr
                .unwrap_or(0.0)
                .partial_cmp(&b.abr.unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Ambil baris `WARNING:` dari stderr yt-dlp, sudah dinormalisasi.
///
/// Dipisah dari pencatatan supaya bisa diuji tanpa log.
///
/// Normalisasi perlu karena yt-dlp menyisipkan URL video dan kadang potongan
/// variabel ke dalam pesan. Tanpa itu, "No supported JavaScript runtime" dari
/// sepuluh lagu berbeda akan tampak sepuluh peringatan unik, dan dedupe-nya
/// tidak berguna.
///
/// Mengembalikan daftar unik, urut kemunculan.
pub fn peringatan_unik(stderr: &str) -> Vec<String> {
    let mut hasil: Vec<String> = Vec::new();
    for baris in stderr.lines() {
        let Some(isi) = baris.trim().strip_prefix("WARNING:") else {
            continue;
        };
        let bersih = normalisasi_peringatan(isi.trim());
        if bersih.is_empty() || hasil.contains(&bersih) {
            continue;
        }
        hasil.push(bersih);
    }
    hasil
}

/// Buang bagian yang berubah-ubah dari satu pesan peringatan.
///
/// Yang dibuang: URL (`https://…`), dan id video 11 karakter yang muncul di
/// dalam tanda kurung siku — keduanya membuat pesan yang sama terlihat berbeda.
fn normalisasi_peringatan(pesan: &str) -> String {
    let mut out = String::with_capacity(pesan.len());
    let mut sisa = pesan;

    while let Some(pos) = sisa.find("http") {
        out.push_str(&sisa[..pos]);
        // Lewati sampai spasi pertama setelah URL.
        let setelah = &sisa[pos..];
        let akhir = setelah.find(char::is_whitespace).unwrap_or(setelah.len());
        out.push_str("<url>");
        sisa = &setelah[akhir..];
    }
    out.push_str(sisa);

    // Rapatkan spasi berlebih.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Catat peringatan yt-dlp sekali per sesi.
///
/// Tanpa dedupe, satu sesi 40 lagu akan menulis 40 baris identik dan menenggelamkan
/// log lain. Dedupe disimpan di memori proses: cukup untuk "sekali per sesi",
/// dan sengaja tidak disimpan ke disk supaya sesi berikutnya tetap melaporkan.
fn catat_peringatan(stderr: &str) {
    use std::collections::HashSet;
    use std::sync::Mutex;
    use std::sync::OnceLock;

    static SUDAH: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let sudah = SUDAH.get_or_init(|| Mutex::new(HashSet::new()));

    for pesan in peringatan_unik(stderr) {
        // Kunci hanya sebentar; kalau poisoned, tetap catat daripada diam.
        let baru = match sudah.lock() {
            Ok(mut s) => s.insert(pesan.clone()),
            Err(_) => true,
        };
        if baru {
            tracing::warn!(peringatan = %pesan, "yt-dlp melaporkan peringatan");
        }
    }
}

/// yt-dlp menulis alasan kegagalan ke stderr; terjemahkan ke error yang
/// bisa diklasifikasi (permanen vs layak dicoba lagi).
///
/// Catatan penting dari uji nyata: yt-dlp menulis "This video is unavailable",
/// bukan "Video unavailable" — jadi pencocokan harus toleran terhadap kata
/// sisipan. Kalau klasifikasi salah, satu video rusak bisa membuka circuit
/// breaker dan mematikan pemutaran SEMUA lagu.
fn classify_stderr(stderr: &str) -> AppError {
    let low = stderr.to_lowercase();
    // Normalisasi: buang tanda baca & kata sisipan umum, supaya "video is
    // unavailable" dan "video unavailable" sama-sama cocok.
    let flat = low.replace(['.', ',', '!', '?', ':', '\'', '"'], " ");
    let compact = flat
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("video is unavailable", "video unavailable");

    let permanent_patterns = [
        "video unavailable",
        "private video",
        "has been removed",
        "does not exist",
        "is not available in your country",
        "account associated with this video has been terminated",
        "this video is not available",
        "video has been taken down",
        "requested format is not available",
        "incomplete youtube id",
        "no video formats found",
    ];
    let permanent = permanent_patterns.iter().any(|p| compact.contains(p));

    // Ambil baris ERROR paling relevan, bukan seluruh dump.
    let msg = stderr
        .lines()
        .rev()
        .find(|l| l.to_uppercase().contains("ERROR"))
        .unwrap_or("yt-dlp gagal mengekstrak stream")
        .trim()
        .to_string();

    AppError::stream(msg, permanent)
}

#[async_trait]
impl StreamResolver for YtDlpResolver {
    async fn resolve(&self, video_id: &str, quality: Quality) -> AppResult<ResolvedStream> {
        if video_id.trim().is_empty() {
            return Err(AppError::invalid("video_id kosong"));
        }

        let url = format!("https://www.youtube.com/watch?v={video_id}");

        let mut cmd = Command::new(&self.binary);
        cmd.args([
            "-j", // dump metadata JSON, jangan unduh
            // `--no-warnings` SENGAJA TIDAK dipakai lagi: peringatan yt-dlp
            // (mis. "No supported JavaScript runtime could be found") adalah
            // satu-satunya tanda bahwa ekstraksi akan rusak. Dulu dibuang,
            // jadi peringatan deprecation itu tidak pernah terlihat di log.
            // Sekarang ditangkap, didedupe, dan dicatat sekali per sesi.
            "--no-playlist",
            "--no-progress",
            "-f",
            // batasi ke audio saja; format terbaik dipilih ulang setelah parsing
            "bestaudio/best",
            &url,
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());

        // Tanpa ini, setiap resolve memunculkan jendela cmd hitam sekejap.
        tanpa_jendela(&mut cmd);
        let fut = cmd.output();

        let output = match tokio::time::timeout(TIMEOUT, fut).await {
            Err(_) => {
                return Err(AppError::stream(
                    "yt-dlp tidak merespons (timeout). Coba lagi.",
                    false,
                ))
            }
            Ok(Err(e)) => {
                // Gagal menjalankan binary: biasanya tidak ada di PATH.
                return Err(AppError::stream(
                    format!("tidak bisa menjalankan yt-dlp: {e}"),
                    true,
                ));
            }
            Ok(Ok(o)) => o,
        };

        let stderr_teks = String::from_utf8_lossy(&output.stderr);
        if !output.status.success() {
            return Err(classify_stderr(&stderr_teks));
        }
        // yt-dlp tetap bisa sukses sambil menulis peringatan penting (runtime JS
        // hilang, format tertentu tidak tersedia). Catat sekali per jenis.
        catat_peringatan(&stderr_teks);

        let parsed: YtDlpOutput = serde_json::from_slice(&output.stdout).map_err(|e| {
            AppError::stream(format!("output yt-dlp tidak bisa dibaca: {e}"), false)
        })?;

        let chosen = pick_best_audio(&parsed.formats).ok_or_else(|| {
            AppError::stream("tidak ada format audio yang tersedia untuk lagu ini", true)
        })?;

        let stream_url = chosen
            .url
            .clone()
            .ok_or_else(|| AppError::stream("format terpilih tidak punya URL", false))?;

        // `expire` dari URL adalah kebenaran; kalau tidak ada, pakai 6 jam sebagai
        // perkiraan konservatif (URL YouTube biasanya berlaku ~6 jam).
        let expires_at_ms = parse_expire_ms(&stream_url).unwrap_or_else(|| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            now + 6 * 60 * 60 * 1000
        });

        let _ = parsed.title;
        let _ = parsed.duration;
        let _ = quality; // pemilihan bitrate mengikuti yang terbaik tersedia

        tracing::debug!(
            video_id,
            format_id = chosen.format_id.as_deref().unwrap_or("?"),
            bitrate_kbps = chosen.abr.unwrap_or(0.0),
            "stream resolved"
        );

        Ok(ResolvedStream {
            url: stream_url,
            mime: chosen
                .ext
                .as_deref()
                .map(|e| match e {
                    "webm" => "audio/webm".to_string(),
                    "m4a" => "audio/mp4".to_string(),
                    other => format!("audio/{other}"),
                })
                .unwrap_or_else(|| "audio/webm".to_string()),
            bitrate_kbps: chosen.abr.map(|b| b.round() as u32),
            expires_at_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(id: &str, acodec: &str, vcodec: &str, abr: f64, url: &str) -> YtDlpFormat {
        YtDlpFormat {
            format_id: Some(id.into()),
            ext: Some("webm".into()),
            acodec: Some(acodec.into()),
            vcodec: Some(vcodec.into()),
            abr: Some(abr),
            url: Some(url.into()),
        }
    }

    #[test]
    fn pilih_audio_bitrate_tertinggi() {
        let formats = vec![
            fmt("251", "opus", "none", 135.3, "https://a"),
            fmt("140", "mp4a.40.2", "none", 129.6, "https://b"),
            fmt("249", "opus", "none", 51.6, "https://c"),
        ];
        assert_eq!(
            pick_best_audio(&formats).unwrap().format_id.as_deref(),
            Some("251")
        );
    }

    #[test]
    fn abaikan_format_tanpa_audio() {
        let formats = vec![
            fmt("137", "none", "avc1", 4000.0, "https://video-only"),
            fmt("251", "opus", "none", 135.3, "https://audio"),
        ];
        assert_eq!(
            pick_best_audio(&formats).unwrap().format_id.as_deref(),
            Some("251")
        );
    }

    #[test]
    fn format_tanpa_url_tidak_dipilih() {
        let mut f = fmt("251", "opus", "none", 135.3, "https://a");
        f.url = None;
        let formats = vec![f, fmt("140", "mp4a.40.2", "none", 129.6, "https://b")];
        assert_eq!(
            pick_best_audio(&formats).unwrap().format_id.as_deref(),
            Some("140")
        );
    }

    #[test]
    fn fallback_ke_format_kombinasi_bila_tidak_ada_audio_only() {
        let formats = vec![fmt("18", "mp4a.40.2", "avc1", 96.0, "https://muxed")];
        assert_eq!(
            pick_best_audio(&formats).unwrap().format_id.as_deref(),
            Some("18")
        );
    }

    #[test]
    fn tidak_ada_format_audio_sama_sekali() {
        let formats = vec![fmt("137", "none", "avc1", 4000.0, "https://v")];
        assert!(pick_best_audio(&formats).is_none());
    }

    #[test]
    fn expire_diparse_dari_url() {
        let url = "https://rr3.googlevideo.com/videoplayback?expire=1794827567&itag=251";
        assert_eq!(parse_expire_ms(url), Some(1_794_827_567_000));
    }

    #[test]
    fn expire_tidak_ada_atau_rusak() {
        assert_eq!(parse_expire_ms("https://x/videoplayback?itag=251"), None);
        assert_eq!(parse_expire_ms("https://x/videoplayback?expire=abc"), None);
        assert_eq!(parse_expire_ms("tanpa-query"), None);
    }

    #[test]
    fn klasifikasi_error_permanen() {
        let e = classify_stderr("ERROR: Video unavailable");
        assert!(matches!(
            e,
            AppError::Stream {
                permanent: true,
                ..
            }
        ));
        let e = classify_stderr("ERROR: Private video. Sign in if you've been granted access");
        assert!(matches!(
            e,
            AppError::Stream {
                permanent: true,
                ..
            }
        ));
    }

    #[test]
    fn klasifikasi_error_sementara() {
        let e = classify_stderr("ERROR: Unable to download webpage: HTTP Error 429");
        assert!(matches!(
            e,
            AppError::Stream {
                permanent: false,
                ..
            }
        ));

        let e = classify_stderr("ERROR: Unable to download webpage: <urlopen error timed out>");
        assert!(matches!(
            e,
            AppError::Stream {
                permanent: false,
                ..
            }
        ));
    }

    /// Regresi dari uji nyata: yt-dlp menulis "This video is unavailable" —
    /// dengan kata "is" di tengah. Pola lama tidak cocok, sehingga error
    /// dianggap sementara, breaker terbuka, dan SATU video rusak mematikan
    /// pemutaran semua lagu.
    #[test]
    fn klasifikasi_pesan_asli_ytdlp_video_is_unavailable() {
        let stderr = "ERROR: [youtube] aaaaaaaaaaa: This video is unavailable";
        let e = classify_stderr(stderr);
        assert!(
            matches!(
                e,
                AppError::Stream {
                    permanent: true,
                    ..
                }
            ),
            "pesan asli yt-dlp harus terdeteksi permanen, dapat: {e}"
        );
    }

    #[test]
    fn klasifikasi_toleran_terhadap_tanda_baca_and_huruf_besar() {
        for s in [
            "ERROR: [youtube] x: Video unavailable.",
            "ERROR: [youtube] x: This Video Is Unavailable!",
            "ERROR: [youtube] x: PRIVATE VIDEO",
            "ERROR: [youtube] x: This video is not available",
        ] {
            let e = classify_stderr(s);
            assert!(
                matches!(
                    e,
                    AppError::Stream {
                        permanent: true,
                        ..
                    }
                ),
                "gagal untuk: {s}"
            );
        }
    }
    // ---------------------------------------------------- peringatan (A2.3)

    #[test]
    fn peringatan_diambil_dari_stderr() {
        let stderr = "WARNING: [youtube] No supported JavaScript runtime could be found\n                      ERROR: sesuatu\n                      WARNING: format terbatas\n";
        let p = peringatan_unik(stderr);
        assert_eq!(p.len(), 2);
        assert!(p[0].contains("JavaScript runtime"));
        assert!(p[1].contains("format terbatas"));
    }

    #[test]
    fn peringatan_diduplikat_dibuang() {
        // Pesan sama dari dua lagu berbeda harus jadi satu.
        let stderr = "WARNING: No supported JavaScript runtime could be found\n                      WARNING: No supported JavaScript runtime could be found\n                      WARNING: No supported JavaScript runtime could be found\n";
        assert_eq!(peringatan_unik(stderr).len(), 1);
    }

    #[test]
    fn url_dinormalisasi_supaya_duplikat_terdeteksi() {
        // yt-dlp menyisipkan URL berbeda; tanpa normalisasi dedupe-nya gagal.
        let a = "WARNING: gagal mengambil https://example.com/a?x=1 lalu lanjut";
        let b = "WARNING: gagal mengambil https://example.com/b?y=2 lalu lanjut";
        let gabung = format!("{a}\n{b}\n");
        let p = peringatan_unik(&gabung);
        assert_eq!(p.len(), 1, "dua URL berbeda harus jadi satu pesan: {p:?}");
        assert!(p[0].contains("<url>"), "URL harus diganti penanda: {}", p[0]);
    }

    #[test]
    fn stderr_tanpa_warning_tidak_menghasilkan_apa_pun() {
        assert!(peringatan_unik("").is_empty());
        assert!(peringatan_unik("ERROR: rusak\n[debug] sesuatu\n").is_empty());
    }

    #[test]
    fn baris_kosong_dan_spasi_berlebih_diabaikan() {
        let p = peringatan_unik("WARNING:    \nWARNING:  pesan   dengan   spasi  \n");
        assert_eq!(p.len(), 1);
        assert_eq!(p[0], "pesan dengan spasi");
    }

}
