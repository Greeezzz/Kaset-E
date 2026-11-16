use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::{Quality, SearchResults, Track};

/// Sumber metadata (YouTube Music). Di balik trait karena API internalnya
/// sering berubah — UI tidak boleh tahu implementasinya (ARCHITECTURE.md §3).
#[async_trait]
pub trait MusicCatalog: Send + Sync {
    async fn search(&self, query: &str) -> AppResult<SearchResults>;
    async fn suggestions(&self, query: &str) -> AppResult<Vec<String>>;
    async fn track(&self, video_id: &str) -> AppResult<Track>;
}

#[async_trait]
pub trait StreamResolver: Send + Sync {
    /// Mengembalikan URL audio langsung + masa berlaku.
    async fn resolve(
        &self,
        video_id: &str,
        quality: Quality,
    ) -> AppResult<crate::models::ResolvedStream>;
}
