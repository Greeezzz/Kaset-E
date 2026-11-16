use tauri::State;

use crate::db::{track_count, tracks};
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
    let results = state.catalog().search(q).await?;

    // Simpan metadata hasil pencarian ke `tracks` sekarang juga.
    // Alasannya bukan sekadar cache: semua tabel lain (favorites, history,
    // queue_items, playlist_tracks, dan listen_events di Fase 4) punya FK ke
    // tracks(video_id). Kalau lagu belum ada di sana, insert-nya gagal.
    // Menulis di sini berarti user bisa memutar, memfavoritkan, atau
    // mengantrekan hasil pencarian tanpa langkah tambahan.
    if let Err(e) = tracks::ensure_tracks(&state.db, &results.tracks) {
        // Jangan gagalkan pencarian hanya karena penulisan cache gagal — user
        // tetap harus bisa melihat dan memutar hasilnya.
        tracing::warn!(error = %e, "gagal menyimpan metadata hasil pencarian");
    }

    Ok(results)
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
    // Sekalian jamin lagunya ada di `tracks`: resolve bisa dipanggil tanpa
    // lewat pencarian (mis. queue dipulihkan saat app dibuka), dan penulisan
    // metadata YouTube yang berubah saat resolve adalah perilaku yang benar.
    if let Ok(t) = state.catalog().track(&video_id).await {
        if let Err(e) = crate::db::ensure_track(&state.db, &t) {
            tracing::warn!(error = %e, video_id, "gagal menyimpan metadata lagu");
        }
    }

    state
        .resolver
        .resolve(&video_id, quality.unwrap_or(Quality::High))
        .await
}

/// Berapa lagu yang sudah dikenal database. Dipakai Settings dan test manual
/// untuk memastikan jalur pencarian benar-benar menulis ke `tracks`.
#[tauri::command]
pub async fn tracks_count(state: State<'_, AppState>) -> AppResult<i64> {
    track_count(&state.db)
}
