use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{MusicCatalog, StreamResolver};
use crate::error::{AppError, AppResult};
use crate::models::{Quality, ResolvedStream, SearchResults, Track};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn demo_tracks() -> Vec<Track> {
    vec![
        Track {
            video_id: "mock0000001".into(),
            title: "Contoh Lagu Satu".into(),
            artist: "Artis Contoh".into(),
            album: Some("Album Contoh".into()),
            duration_ms: Some(213_000),
            cover_key: Track::cover_key_for("mock0000001"),
        },
        Track {
            video_id: "mock0000002".into(),
            title: "Contoh Lagu Dua Dengan Judul Yang Sengaja Panjang Sekali".into(),
            artist: "Artis Lain".into(),
            album: None,
            duration_ms: Some(187_000),
            cover_key: Track::cover_key_for("mock0000002"),
        },
        Track {
            video_id: "mock0000003".into(),
            title: "Contoh Lagu Tiga".into(),
            artist: "Artis Contoh".into(),
            album: Some("Album Contoh".into()),
            duration_ms: Some(251_000),
            cover_key: Track::cover_key_for("mock0000003"),
        },
    ]
}

/// Mock katalog: cukup untuk Fase 0 supaya UI punya data tanpa menyentuh jaringan.
#[derive(Default)]
pub struct MockCatalog {
    /// Mock resolver sengaja bisa disuruh gagal supaya backoff/breaker di Fase 1
    /// bisa diuji tanpa internet — lihat docs/RESILIENCE.md bagian 7.
    pub fail_next: AtomicBool,
}

#[async_trait]
impl MusicCatalog for MockCatalog {
    async fn search(&self, _query: &str) -> AppResult<SearchResults> {
        Ok(SearchResults {
            tracks: demo_tracks(),
            ..Default::default()
        })
    }

    async fn suggestions(&self, _query: &str) -> AppResult<Vec<String>> {
        Ok(vec!["contoh sarana".into(), "contoh sarana dua".into()])
    }

    async fn track(&self, video_id: &str) -> AppResult<Track> {
        demo_tracks()
            .into_iter()
            .find(|t| t.video_id == video_id)
            .ok_or_else(|| AppError::NotFound(format!("lagu {video_id} tidak ada di mock")))
    }
}

#[async_trait]
impl StreamResolver for MockCatalog {
    async fn resolve(&self, _video_id: &str, quality: Quality) -> AppResult<ResolvedStream> {
        if self.fail_next.swap(false, Ordering::SeqCst) {
            return Err(AppError::stream("mock: resolver gagal (disengaja)", false));
        }
        Ok(ResolvedStream {
            url: "mock://stream".into(),
            mime: "audio/webm".into(),
            bitrate_kbps: Some(match quality {
                Quality::High => 256,
                Quality::Medium => 128,
                Quality::Low => 64,
            }),
            // Mock: berlaku 1 jam.
            expires_at_ms: now_ms() + 3_600_000,
        })
    }
}
