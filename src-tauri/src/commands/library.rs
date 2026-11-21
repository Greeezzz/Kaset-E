use tauri::State;

use crate::db::library;
use crate::error::{AppError, AppResult};
use crate::models::Track;
use crate::state::AppState;

/// Favorit: tambah kalau belum ada, hapus kalau sudah ada.
///
/// Satu command untuk dua arah karena UI-nya satu tombol. Mengembalikan
/// keadaan akhir supaya UI tidak perlu menebak.
#[tauri::command]
pub async fn toggle_favorite(state: State<'_, AppState>, track: Track) -> AppResult<bool> {
    if library::is_favorite(&state.db, &track.video_id)? {
        library::remove_favorite(&state.db, &track.video_id)?;
        Ok(false)
    } else {
        library::add_favorite(&state.db, &track)?;
        Ok(true)
    }
}

#[tauri::command]
pub async fn list_favorites(state: State<'_, AppState>) -> AppResult<Vec<Track>> {
    library::list_favorites(&state.db)
}

#[tauri::command]
pub async fn is_favorite(state: State<'_, AppState>, video_id: String) -> AppResult<bool> {
    library::is_favorite(&state.db, &video_id)
}

/// Catat pemutaran. Dipanggil UI saat audio benar-benar mulai berbunyi.
#[tauri::command]
pub async fn record_play(state: State<'_, AppState>, track: Track) -> AppResult<()> {
    library::record_play(&state.db, &track)
}

#[tauri::command]
pub async fn list_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> AppResult<Vec<Track>> {
    library::list_history(&state.db, limit.unwrap_or(100))
}

#[tauri::command]
pub async fn clear_history(state: State<'_, AppState>) -> AppResult<usize> {
    library::clear_history(&state.db)
}

#[tauri::command]
pub async fn history_count(state: State<'_, AppState>) -> AppResult<i64> {
    library::history_count(&state.db)
}

/// Validasi nama playlist: tidak kosong, tidak kepanjangan.
fn validate_name(name: &str) -> AppResult<&str> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::invalid("nama playlist kosong"));
    }
    if n.chars().count() > 120 {
        return Err(AppError::invalid("nama playlist terlalu panjang"));
    }
    Ok(n)
}

#[tauri::command]
pub async fn create_playlist(
    state: State<'_, AppState>,
    name: String,
) -> AppResult<crate::db::playlist::Playlist> {
    crate::db::playlist::create(&state.db, validate_name(&name)?)
}

#[tauri::command]
pub async fn rename_playlist(
    state: State<'_, AppState>,
    id: i64,
    name: String,
) -> AppResult<crate::db::playlist::Playlist> {
    crate::db::playlist::rename(&state.db, id, validate_name(&name)?)
}

#[tauri::command]
pub async fn delete_playlist(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    crate::db::playlist::delete(&state.db, id)
}

#[tauri::command]
pub async fn list_playlists(
    state: State<'_, AppState>,
) -> AppResult<Vec<crate::db::playlist::Playlist>> {
    crate::db::playlist::list(&state.db)
}

#[tauri::command]
pub async fn playlist_tracks(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Track>> {
    crate::db::playlist::tracks(&state.db, id)
}

#[tauri::command]
pub async fn add_to_playlist(state: State<'_, AppState>, id: i64, track: Track) -> AppResult<()> {
    crate::db::playlist::add_track(&state.db, id, &track)
}

#[tauri::command]
pub async fn remove_from_playlist(
    state: State<'_, AppState>,
    id: i64,
    video_id: String,
) -> AppResult<bool> {
    crate::db::playlist::remove_track(&state.db, id, &video_id)
}

#[tauri::command]
pub async fn play_playlist(
    state: State<'_, AppState>,
    id: i64,
) -> AppResult<crate::commands::QueueView> {
    let tracks = crate::db::playlist::tracks(&state.db, id)?;
    if tracks.is_empty() {
        return Err(AppError::invalid("playlist kosong"));
    }
    // Ganti antrean dengan isi playlist, lalu mulai dari lagu pertama.
    crate::db::ensure_tracks(&state.db, &tracks)?;
    Ok(state.with_queue(|q| {
        q.replace(tracks, 0);
        crate::commands::queue::view(q)
    }))
}
