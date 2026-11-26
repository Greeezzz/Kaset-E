//! Klien LRCLIB (FEATURES-V3 §4 L5).
//!
//! Spesifikasi LRCLIB (https://lrclib.net/docs):
//! - Endpoint GET `/api/get` (pencocokan persis): `track_name`, `artist_name`, `duration` (dalam detik).
//! - Endpoint GET `/api/search`: pencarian fleksibel jika pencocokan persis 404.
//! - Parameter:
//!   - `id`: number
//!   - `trackName`: string
//!   - `artistName`: string
//!   - `albumName`: string
//!   - `duration`: number (dalam detik)
//!   - `instrumental`: boolean
//!   - `plainLyrics`: string | null
//!   - `syncedLyrics`: string | null
//! - Aturan privasi: HANYA dipanggil saat setting `lirik.lrclib` bernilai `"1"` (opt-in).
//! - User-Agent sopan dan jujur: `Kaset (https://github.com/Greeezzz/Kaset-E)`.
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

/// Mengambil lirik dari LRCLIB menggunakan endpoint `/api/get`.
/// Jika tidak ditemukan atau gagal, mencoba `/api/search`.
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

    // 1. Coba endpoint `/api/get` lebih dulu (paling akurat)
    let get_url = format!("{}/get", LRCLIB_API_BASE);
    let mut query = vec![("track_name", title), ("artist_name", artist)];
    let dur_str;
    if let Some(d) = duration_secs {
        if d > 0.0 {
            dur_str = format!("{}", d.round() as i64);
            query.push(("duration", &dur_str));
        }
    }

    let resp = client.get(&get_url).query(&query).send().await;
    if let Ok(res) = resp {
        if res.status().is_success() {
            if let Ok(data) = res.json::<LrclibResponse>().await {
                if let Some(text) = extract_best_lyrics(&data) {
                    return Ok(Some(text));
                }
            }
        }
    }

    // 2. Jika 404 / gagal, coba `/api/search?q=...`
    let search_q = format!("{title} {artist}");
    let search_url = format!("{}/search", LRCLIB_API_BASE);

    let search_resp = client
        .get(&search_url)
        .query(&[("q", search_q.as_str())])
        .send()
        .await;

    if let Ok(res) = search_resp {
        if res.status().is_success() {
            if let Ok(items) = res.json::<Vec<LrclibResponse>>().await {
                for item in items {
                    if let Some(text) = extract_best_lyrics(&item) {
                        return Ok(Some(text));
                    }
                }
            }
        }
    }

    Ok(None)
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
