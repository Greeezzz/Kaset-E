use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{Quality, ResolvedStream, SearchResults, Track};
use crate::state::AppState;

/// Batas panjang query: cegah UI mengirim string raksasa ke resolver/katalog.
const MAX_QUERY_LEN: usize = 256;

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> AppResult<SearchResults> {
    let q = query.trim();
    if q.is_empty() {
        return Err(AppError::invalid("kata kunci kosong"));
    }
    if q.chars().count() > MAX_QUERY_LEN {
        return Err(AppError::invalid("kata kunci terlalu panjang"));
    }
    state.catalog().search(q).await
}

#[tauri::command]
pub async fn search_suggestions(
    state: State<'_, AppState>,
    query: String,
) -> AppResult<Vec<String>> {
    state.catalog().suggestions(query.trim()).await
}

#[tauri::command]
pub async fn track(state: State<'_, AppState>, video_id: String) -> AppResult<Track> {
    state.catalog().track(&video_id).await
}

/// Status katalog: apakah sudah memakai YouTube Music atau masih mock.
/// Dipakai UI supaya user tahu kalau pencarian belum nyata.
#[tauri::command]
pub async fn catalog_status(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.catalog_is_live())
}

#[tauri::command]
pub async fn resolve_stream(
    state: State<'_, AppState>,
    video_id: String,
    quality: Option<Quality>,
) -> AppResult<ResolvedStream> {
    if video_id.trim().is_empty() {
        return Err(AppError::invalid("video_id kosong"));
    }
    // Catatan: Fase 1 akan membungkus ini dengan backoff + circuit breaker
    // (docs/RESILIENCE.md). Command tetap tipis: validasi → service → hasil.
    state
        .resolver
        .resolve(&video_id, quality.unwrap_or(Quality::High))
        .await
}
