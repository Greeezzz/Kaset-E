use async_trait::async_trait;
use ytmapi_rs::common::YoutubeID;
use ytmapi_rs::query::GetSearchSuggestionsQuery;
use ytmapi_rs::YtMusic;

use super::MusicCatalog;
use crate::error::{AppError, AppResult};
use crate::models::{SearchResults, Track};

/// Katalog nyata berbasis YouTube Music lewat `ytmapi-rs`.
///
/// Autentikasi: TIDAK ADA. `new_unauthenticated()` cukup untuk pencarian katalog
/// publik, dan sesuai PRD proyek ini tidak punya akun/login.
///
/// PENTING: `YtMusic` menyimpan connection pool, jadi ia dibuat sekali dan
/// dipakai ulang — jangan membuat client baru per request.
pub struct YouTubeMusicCatalog {
    yt: YtMusic<ytmapi_rs::auth::noauth::NoAuthToken>,
}

impl YouTubeMusicCatalog {
    /// Membuat client. Butuh jaringan; panggil sekali saat setup aplikasi.
    pub async fn new() -> AppResult<Self> {
        let yt = YtMusic::new_unauthenticated()
            .await
            .map_err(|e| AppError::catalog(format!("gagal membuat client YouTube Music: {e}")))?;
        Ok(Self { yt })
    }
}

/// Durasi YouTube Music datang sebagai string "m:ss" atau "h:mm:ss" — atau kosong
/// kalau tidak diketahui. Konversi ke ms, dan kembalikan None kalau tidak valid.
fn parse_duration_ms(raw: &str) -> Option<u64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut total: u64 = 0;
    let mut parts = 0;
    for part in raw.split(':') {
        let n: u64 = part.trim().parse().ok()?;
        total = total * 60 + n;
        parts += 1;
    }
    // Lebih dari 3 bagian berarti formatnya tidak seperti yang kita duga.
    if parts == 0 || parts > 3 {
        return None;
    }
    Some(total * 1000)
}

/// `ytmapi-rs` mengembalikan error-nya sendiri. Kita petakan ke AppError sambil
/// menandai mana yang permanen vs layak dicoba lagi — lihat docs/RESILIENCE.md.
fn map_ytm_error(e: ytmapi_rs::Error) -> AppError {
    let msg = e.to_string();
    let lowered = msg.to_lowercase();
    // Sinyal "video hilang / tidak bisa diakses" = permanen, jangan retry.
    let permanent = lowered.contains("not found")
        || lowered.contains("unavailable")
        || lowered.contains("private")
        || lowered.contains("removed");
    AppError::catalog(msg).with_permanent(permanent)
}

#[async_trait]
impl MusicCatalog for YouTubeMusicCatalog {
    async fn search(&self, query: &str) -> AppResult<SearchResults> {
        let songs = self.yt.search_songs(query).await.map_err(map_ytm_error)?;

        let tracks = songs
            .into_iter()
            .map(|s| Track {
                video_id: s.video_id.get_raw().to_string(),
                title: s.title,
                artist: s.artist,
                album: s.album.map(|a| a.name),
                duration_ms: parse_duration_ms(&s.duration),
                cover_key: Track::cover_key_for(s.video_id.get_raw()),
            })
            .collect();

        // Album/artis/playlist menyusul; Fase 1 sengaja hanya lagu.
        Ok(SearchResults {
            tracks,
            ..Default::default()
        })
    }

    async fn suggestions(&self, query: &str) -> AppResult<Vec<String>> {
        let q = GetSearchSuggestionsQuery::new(query);
        let raw = self
            .yt
            .get_search_suggestions(q)
            .await
            .map_err(map_ytm_error)?;

        // Setiap saran adalah daftar "runs" (teks terpotong karena bolding);
        // `get_text()` menggabungkannya kembali jadi satu string utuh.
        let out = raw
            .into_iter()
            .map(|s| s.get_text())
            .filter(|s| !s.trim().is_empty())
            .collect();

        Ok(out)
    }

    async fn track(&self, video_id: &str) -> AppResult<Track> {
        // Tidak ada endpoint "get song by id" yang murah di API publik; cara yang
        // benar adalah lewat watch playlist / album. Untuk Fase 1, pencarian
        // adalah satu-satunya jalur masuk lagu, jadi ini sengaja belum diisi.
        Err(AppError::invalid(format!(
            "track({video_id}) belum diimplementasikan; lagu masuk lewat pencarian"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_duration_ms;

    #[test]
    fn durasi_format_umum() {
        assert_eq!(parse_duration_ms("3:33"), Some(213_000));
        assert_eq!(parse_duration_ms("0:07"), Some(7_000));
        assert_eq!(parse_duration_ms("1:00:00"), Some(3_600_000));
        assert_eq!(parse_duration_ms("1:35:38"), Some(5_738_000));
    }

    #[test]
    fn durasi_tidak_valid_jadi_none() {
        assert_eq!(parse_duration_ms(""), None);
        assert_eq!(parse_duration_ms("abc"), None);
        assert_eq!(parse_duration_ms("1:2:3:4"), None);
        assert_eq!(parse_duration_ms("12:ab"), None);
    }

    #[test]
    fn durasi_spasi_diabaikan() {
        assert_eq!(parse_duration_ms(" 4:11 "), Some(251_000));
    }
}
