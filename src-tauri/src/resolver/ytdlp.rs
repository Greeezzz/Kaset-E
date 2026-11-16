use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::process::Command;

use crate::catalog::StreamResolver;
use crate::error::{AppError, AppResult};
use crate::models::{Quality, ResolvedStream};

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

/// Pencarian `executable` sederhana di PATH tanpa menambah dependensi.
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

        let fut = Command::new(&self.binary)
            .args([
                "-j", // dump metadata JSON, jangan unduh
                "--no-warnings",
                "--no-playlist",
                "--no-progress",
                "-f",
                // batasi ke audio saja; format terbaik dipilih ulang setelah parsing
                "bestaudio/best",
                &url,
            ])
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .output();

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

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(classify_stderr(&stderr));
        }

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
}
