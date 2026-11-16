use serde::{Deserialize, Serialize};

/// Satu lagu. `cover_key` adalah kunci cache lokal, BUKAN URL jaringan —
/// lihat docs/THUMBNAILS.md bagian 1.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub video_id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub cover_key: String,
}

impl Track {
    pub fn cover_key_for(video_id: &str) -> String {
        format!("v:{video_id}")
    }

    /// Kunci cover untuk album/playlist: satu cover dipakai seluruh lagunya.
    pub fn collection_cover_key(collection_id: &str) -> String {
        format!("a:{collection_id}")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub cover_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub tracks: Vec<Track>,
    pub albums: Vec<Collection>,
    pub artists: Vec<Collection>,
    pub playlists: Vec<Collection>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    High,
    Medium,
    Low,
}

/// URL audio hasil resolve. Hanya di memori — jangan pernah ditulis ke disk,
/// karena berisi token sesi dan cepat kedaluwarsa.
#[derive(Debug, Clone)]
pub struct ResolvedStream {
    pub url: String,
    pub mime: String,
    pub bitrate_kbps: Option<u32>,
    /// Unix epoch ms. Lewat dari ini: resolve ulang.
    pub expires_at_ms: i64,
}

impl ResolvedStream {
    pub fn is_expired(&self, now_ms: i64) -> bool {
        now_ms >= self.expires_at_ms
    }
}
