//! Ambil metadata playlist YouTube lewat `yt-dlp --flat-playlist`.
//!
//! Yang diambil hanya metadata: id video, judul, kanal, durasi. Tidak ada
//! unduhan, tidak ada pencarian per lagu, tidak ada cover baru. Untuk playlist
//! 500 lagu ini satu panggilan proses, bukan 500 — beda jam dengan impor CSV
//! yang harus mencocokkan tiap lagu satu per satu.
//!
//! Entri yang dihapus/privat tetap muncul di keluaran `--flat-playlist` sebagai
//! judul `[Deleted video]` / `[Private video]`. Entri seperti itu dilewati dan
//! dihitung, bukan disimpan sebagai lagu tanpa judul yang nanti gagal diputar.

use std::collections::HashSet;
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use tokio::process::Command;

use crate::error::{AppError, AppResult};
use crate::models::Track;
use crate::resolver::ytdlp::{ensure_available, tanpa_jendela};

/// Batas waktu baca metadata. Jauh lebih longgar daripada resolve satu lagu
/// (25 detik) karena playlist besar bisa butuh puluhan detik untuk dienumerasi.
const TIMEOUT: Duration = Duration::from_secs(180);

/// Hasil satu kali ambil playlist.
#[derive(Debug, Clone)]
pub struct HasilAmbil {
    /// Judul playlist di YouTube, dipakai sebagai nama playlist baru.
    pub judul: String,
    /// Lagu yang siap disimpan, sudah unik per `video_id`.
    pub lagu: Vec<Track>,
    /// Entri yang dilewati: dihapus, privat, tanpa id, atau tanpa judul.
    pub dilewati: usize,
    /// Entri yang muncul lebih dari sekali di playlist sumber.
    pub dobel: usize,
}

#[derive(Debug, Deserialize)]
struct PlaylistJson {
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    entries: Option<Vec<Option<EntriJson>>>,
}

#[derive(Debug, Deserialize)]
struct EntriJson {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    uploader: Option<String>,
    /// Detik, bisa pecahan. `None` untuk entri yang belum diproses yt-dlp.
    #[serde(default)]
    duration: Option<f64>,
}

/// Ambil metadata playlist dari URL kanonis hasil `tautan::parse`.
pub async fn ambil(url: &str) -> AppResult<HasilAmbil> {
    let biner = ensure_available().await?;

    let mut cmd = Command::new(&biner);
    cmd.args([
        // Jangan buka tiap video: satu daftar, satu proses.
        "--flat-playlist",
        // Seluruh playlist sebagai satu objek JSON, bukan NDJSON per baris.
        "--dump-single-json",
        "--no-progress",
        // Entri rusak dilewati, bukan menggagalkan seluruh playlist.
        "--ignore-errors",
        url,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    tanpa_jendela(&mut cmd);

    let output = match tokio::time::timeout(TIMEOUT, cmd.output()).await {
        Err(_) => {
            return Err(AppError::Network(
                "yt-dlp tidak merespons saat membaca playlist (timeout). Coba lagi.".to_string(),
            ));
        }
        Ok(Err(e)) => {
            return Err(AppError::Network(format!(
                "tidak bisa menjalankan yt-dlp: {e}"
            )));
        }
        Ok(Ok(o)) => o,
    };

    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(galat_ytdlp(&stderr));
    }

    urai_json(&output.stdout)
}

/// Pisahkan parsing dari eksekusi proses supaya bisa diuji tanpa jaringan.
pub(crate) fn urai_json(bytes: &[u8]) -> AppResult<HasilAmbil> {
    // Toleran terhadap baris lain di stdout: ambil dari `{` pertama sampai `}`
    // terakhir. `--dump-single-json` normalnya hanya menulis JSON, tapi
    // peringatan yt-dlp versi lama kadang ikut tercetak di stdout.
    let teks = String::from_utf8_lossy(bytes);
    let mulai = teks.find('{').ok_or_else(|| {
        AppError::catalog("yt-dlp tidak mengembalikan data playlist (keluaran kosong)")
    })?;
    let akhir = teks.rfind('}').ok_or_else(|| {
        AppError::catalog("yt-dlp tidak mengembalikan data playlist (JSON terpotong)")
    })?;
    let potongan = &teks[mulai..=akhir];

    let data: PlaylistJson = serde_json::from_str(potongan)
        .map_err(|e| AppError::catalog(format!("data playlist tidak bisa dibaca: {e}")))?;

    let entries = data.entries.ok_or_else(|| {
        AppError::invalid("tautan itu tidak berisi daftar lagu — pastikan ini tautan playlist")
    })?;

    let judul = data
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Playlist YouTube".to_string());

    let mut lagu = Vec::with_capacity(entries.len());
    let mut terlihat: HashSet<String> = HashSet::with_capacity(entries.len());
    let mut dilewati = 0usize;
    let mut dobel = 0usize;

    for entri in entries {
        // `--flat-playlist` bisa menyisipkan `null` untuk entri yang gagal
        // dienumerasi; itu juga terhitung dilewati.
        let Some(entri) = entri else {
            dilewati += 1;
            continue;
        };
        let Some(video_id) = entri.id.map(|s| s.trim().to_string()) else {
            dilewati += 1;
            continue;
        };
        // Id video YouTube selalu 11 karakter. Batas lebar ini menampung id
        // lain yang mungkin muncul (mis. dari kanal) tanpa menerima sampah.
        if !(6..=32).contains(&video_id.len()) {
            dilewati += 1;
            continue;
        }

        let judul_lagu = entri.title.unwrap_or_default().trim().to_string();
        if judul_lagu.is_empty() || entri_tidak_tersedia(&judul_lagu) {
            dilewati += 1;
            continue;
        }

        if !terlihat.insert(video_id.clone()) {
            dobel += 1;
            continue;
        }

        let artis = entri
            .channel
            .or(entri.uploader)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Artis tidak diketahui".to_string());

        let durasi_ms = entri
            .duration
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| (d * 1000.0).round() as u64);

        lagu.push(Track {
            cover_key: Track::cover_key_for(&video_id),
            video_id,
            title: judul_lagu,
            artist: artis,
            album: None,
            duration_ms: durasi_ms,
        });
    }

    Ok(HasilAmbil {
        judul,
        lagu,
        dilewati,
        dobel,
    })
}

/// Judul penanda entri yang tidak bisa diputar. yt-dlp menuliskannya apa adanya
/// dalam tanda kurung siku untuk video yang dihapus atau privat.
fn entri_tidak_tersedia(judul: &str) -> bool {
    let j = judul.trim().to_ascii_lowercase();
    matches!(
        j.as_str(),
        "[deleted video]"
            | "[private video]"
            | "[unavailable video]"
            | "[video unavailable]"
            | "deleted video"
            | "private video"
    )
}

/// Terjemahkan kegagalan yt-dlp menjadi pesan yang bisa ditindaklanjuti.
///
/// Playlist privat/dihapus bersifat permanen — mengulang tidak akan menolong.
/// Sisanya (jaringan, rate limit) layak dicoba lagi.
fn galat_ytdlp(stderr: &str) -> AppError {
    let low = stderr.to_lowercase();
    let permanen = [
        "does not exist",
        "private playlist",
        "playlist is private",
        "playlist unavailable",
        "has been removed",
        "is not available",
    ]
    .iter()
    .any(|p| low.contains(p));

    let baris = stderr
        .lines()
        .rev()
        .find(|l| l.to_uppercase().contains("ERROR"))
        .unwrap_or("yt-dlp gagal membaca playlist")
        .trim();
    // Buang awalan "ERROR:" supaya pesan tidak tampil dua kali dengan label
    // error dari lapisan UI.
    let pesan = baris
        .strip_prefix("ERROR:")
        .map(str::trim)
        .unwrap_or(baris)
        .to_string();

    if permanen {
        AppError::NotFound(format!("playlist tidak bisa dibaca: {pesan}"))
    } else {
        AppError::Network(format!("gagal membaca playlist: {pesan}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn urai(isi: &str) -> HasilAmbil {
        urai_json(isi.as_bytes()).expect("JSON contoh seharusnya valid")
    }

    #[test]
    fn membaca_lagu_dasar() {
        let h = urai(
            r#"{
              "title": "  Campuran  ",
              "entries": [
                {"id": "aaaaaaaaaaa", "title": "Lagu Satu", "channel": "Kanal A", "duration": 215.4},
                {"id": "bbbbbbbbbbb", "title": "Lagu Dua", "uploader": "Kanal B", "duration": 60}
              ]
            }"#,
        );
        assert_eq!(h.judul, "Campuran");
        assert_eq!(h.lagu.len(), 2);
        assert_eq!(h.lagu[0].title, "Lagu Satu");
        assert_eq!(h.lagu[0].artist, "Kanal A");
        assert_eq!(h.lagu[0].duration_ms, Some(215_400));
        assert_eq!(h.lagu[1].artist, "Kanal B");
        assert_eq!(h.lagu[1].duration_ms, Some(60_000));
        assert_eq!(h.lagu[0].cover_key, "v:aaaaaaaaaaa");
        assert_eq!(h.dilewati, 0);
        assert_eq!(h.dobel, 0);
    }

    #[test]
    fn melewati_entri_dihapus_dan_privat() {
        let h = urai(
            r#"{"title":"X","entries":[
              {"id":"aaaaaaaaaaa","title":"[Deleted video]"},
              {"id":"bbbbbbbbbbb","title":"[Private video]"},
              {"id":"ccccccccccc","title":"Lagu Nyata","duration":1}
            ]}"#,
        );
        assert_eq!(h.lagu.len(), 1);
        assert_eq!(h.lagu[0].video_id, "ccccccccccc");
        assert_eq!(h.dilewati, 2);
    }

    #[test]
    fn melewati_entri_tanpa_id_atau_judul() {
        let h = urai(
            r#"{"entries":[
              null,
              {"title":"Tanpa id"},
              {"id":"aaaaaaaaaaa","title":"   "},
              {"id":"bbbbbbbbbbb","title":"Ada"}
            ]}"#,
        );
        assert_eq!(h.lagu.len(), 1);
        assert_eq!(h.dilewati, 3);
    }

    #[test]
    fn dedupe_video_id_yang_muncul_dua_kali() {
        let h = urai(
            r#"{"entries":[
              {"id":"aaaaaaaaaaa","title":"Lagu"},
              {"id":"aaaaaaaaaaa","title":"Lagu (lagi)"}
            ]}"#,
        );
        assert_eq!(h.lagu.len(), 1);
        assert_eq!(h.dobel, 1);
    }

    #[test]
    fn artis_dan_durasi_opsional() {
        let h = urai(r#"{"entries":[{"id":"aaaaaaaaaaa","title":"Lagu"}]}"#);
        assert_eq!(h.lagu[0].artist, "Artis tidak diketahui");
        assert_eq!(h.lagu[0].duration_ms, None);
        assert_eq!(h.judul, "Playlist YouTube");
    }

    #[test]
    fn toleran_terhadap_teks_lain_di_sekitar_json() {
        let h = urai("[youtube:tab] mengambil daftar\n{\"entries\":[]}\nsemoga beruntung");
        assert!(h.lagu.is_empty());
    }

    #[test]
    fn menolak_keluaran_bukan_playlist() {
        assert!(urai_json(b"").is_err());
        assert!(urai_json(b"bukan json").is_err());
        assert!(urai_json(br#"{"title":"Video tunggal"}"#).is_err());
    }
}
