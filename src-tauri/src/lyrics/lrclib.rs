//! Klien LRCLIB (FEATURES-V3 §4 L5).
//!
//! Spesifikasi LRCLIB (https://lrclib.net/docs):
//! - Endpoint GET `/api/get` (pencocokan persis): `track_name`, `artist_name`, `duration` (dalam detik).
//! - Endpoint GET `/api/search`: pencarian fleksibel jika pencocokan persis 404.
//! - Aturan privasi: HANYA dipanggil saat setting `lirik.lrclib` bernilai `"1"` (opt-in).
//! - User-Agent sopan dan jujur: `Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)`.
//! - Timeout pendek (5 detik), penanganan error jinak (fallback aman).

use serde::Deserialize;
use std::time::Duration;

const LRCLIB_API_BASE: &str = "https://lrclib.net/api";
const USER_AGENT: &str = "Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)";

#[derive(Debug, Clone, Deserialize)]
pub struct LrclibResponse {
    pub id: Option<i64>,
    #[serde(rename = "trackName")]
    pub track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub artist_name: Option<String>,
    #[serde(rename = "albumName")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

/// Mengambil lirik dari LRCLIB menggunakan endpoint `/api/get` dan `/api/search`.
/// Dilengkapi dengan normalisasi nama artis (mis. "Sān-Z & HOYO-MiX" -> "Sān-Z")
/// dan pencocokan durasi lagu agar tidak salah mengambil lagu berjudulkan sama milik musisi lain.
pub async fn fetch_lrclib(
    title: &str,
    artist: &str,
    duration_secs: Option<f64>,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Gagal inisialisasi HTTP client: {e}"))?;

    let clean_title = bersihkan_judul(title);
    let artist_candidates = pecah_kandidat_artis(artist);

    // 1. Coba `/api/get` dengan kombinasi judul & kandidat artis
    for art in &artist_candidates {
        let mut query = vec![("track_name", clean_title.as_str()), ("artist_name", art.as_str())];
        let dur_str;
        if let Some(d) = duration_secs {
            if d > 0.0 {
                dur_str = format!("{}", d.round() as i64);
                query.push(("duration", &dur_str));
            }
        }

        let resp = client.get(format!("{}/get", LRCLIB_API_BASE)).query(&query).send().await;
        if let Ok(res) = resp {
            if res.status().is_success() {
                if let Ok(data) = res.json::<LrclibResponse>().await {
                    if let Some(text) = extract_best_lyrics(&data) {
                        return Ok(Some(text));
                    }
                }
            }
        }
    }

    // 2. Coba `/api/search?q=...` dengan pencocokan durasi ketat
    for art in &artist_candidates {
        let search_q = format!("{clean_title} {art}");
        let search_resp = client
            .get(format!("{}/search", LRCLIB_API_BASE))
            .query(&[("q", search_q.as_str())])
            .send()
            .await;

        if let Ok(res) = search_resp {
            if res.status().is_success() {
                if let Ok(items) = res.json::<Vec<LrclibResponse>>().await {
                    // Cari item yang memiliki syncedLyrics dan durasi mendekati (selisih <= 4 detik)
                    let matched = items.iter().find(|it| {
                        if it.synced_lyrics.is_none() {
                            return false;
                        }
                        if let (Some(target_d), Some(it_d)) = (duration_secs, it.duration) {
                            if (target_d - it_d).abs() > 4.0 {
                                return false;
                            }
                        }
                        true
                    });

                    if let Some(best) = matched {
                        if let Some(text) = extract_best_lyrics(best) {
                            return Ok(Some(text));
                        }
                    }

                    // Jika tidak ada yang cocok dengan durasi, ambil hasil pertama yang memiliki lirik
                    for item in &items {
                        if let Some(text) = extract_best_lyrics(item) {
                            return Ok(Some(text));
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Menghapus tag video YouTube seperti (Official Audio), [MV], dsb.
fn bersihkan_judul(judul: &str) -> String {
    let mut clean = judul.to_string();
    for tag in &[
        "(Official Audio)",
        "(Official Music Video)",
        "(Official Video)",
        "[Official Audio]",
        "[Official Music Video]",
        "[MV]",
        "(MV)",
        "(Audio)",
        "[Audio]",
    ] {
        clean = clean.replace(tag, "");
    }
    clean.trim().to_string()
}

/// Memecah nama artis yang berisi kolaborator seperti "Sān-Z & HOYO-MiX" -> ["Sān-Z & HOYO-MiX", "Sān-Z"].
fn pecah_kandidat_artis(artist: &str) -> Vec<String> {
    let mut list = Vec::new();
    let trimmed = artist.trim();
    if !trimmed.is_empty() {
        list.push(trimmed.to_string());
    }

    for separator in &[" & ", " feat. ", " ft. ", " x ", ", "] {
        if let Some((first, _)) = trimmed.split_once(separator) {
            let clean_first = first.trim();
            if !clean_first.is_empty() && !list.iter().any(|x| x == clean_first) {
                list.push(clean_first.to_string());
            }
        }
    }
    list
}

/// Utilitas untuk memprioritaskan `syncedLyrics` (LRC tersinkron), jika kosong pakai `plainLyrics`.
fn extract_best_lyrics(item: &LrclibResponse) -> Option<String> {
    if let Some(ref synced) = item.synced_lyrics {
        if !synced.trim().is_empty() {
            return Some(synced.clone());
        }
    }
    if let Some(ref plain) = item.plain_lyrics {
        if !plain.trim().is_empty() {
            return Some(plain.clone());
        }
    }
    None
}
