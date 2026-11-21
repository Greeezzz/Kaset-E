use tauri::State;

use crate::db::{ensure_track, ensure_tracks};
use crate::error::{AppError, AppResult};
use crate::models::{QueueItem, RepeatMode, Track};
use crate::queue::QueueManager;
use crate::state::AppState;

/// Bentuk data yang dikirim ke UI setiap kali antrean berubah.
///
/// UI tidak perlu tahu soal `order`/`cursor` internal — ia hanya butuh daftar
/// dalam urutan pemutaran, plus indeks lagu aktif.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueView {
    pub items: Vec<QueueItem>,
    /// Indeks lagu aktif di dalam `items` (urutan pemutaran).
    pub cursor: usize,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub current: Option<Track>,
}

pub(crate) fn view(q: &QueueManager) -> QueueView {
    QueueView {
        items: q.play_order(),
        cursor: q.cursor(),
        shuffle: q.shuffle_enabled(),
        repeat: q.repeat(),
        current: q.current().map(|i| i.track.clone()),
    }
}

/// Pastikan lagu ada di `tracks` sebelum masuk antrean.
///
/// FK `queue_items.video_id -> tracks` akan menolak lagu yang belum dikenal.
/// Menulisnya di sini membuat antrean bisa diisi dari mana pun (hasil
/// pencarian, playlist, import) tanpa pemanggil harus ingat urutannya.
fn ensure(state: &AppState, track: &Track) -> AppResult<()> {
    ensure_track(&state.db, track)
}

#[tauri::command]
pub async fn queue_get(state: State<'_, AppState>) -> AppResult<QueueView> {
    Ok(view(&state.queue_snapshot()))
}

/// Tambah lagu di akhir antrean. Kalau antrean kosong, lagu ini langsung aktif.
#[tauri::command]
pub async fn queue_add(state: State<'_, AppState>, track: Track) -> AppResult<QueueView> {
    ensure(&state, &track)?;
    Ok(state.with_queue(|q| {
        q.add(track);
        view(q)
    }))
}

/// Sisipkan lagu tepat setelah lagu yang sedang diputar.
#[tauri::command]
pub async fn queue_play_next(state: State<'_, AppState>, track: Track) -> AppResult<QueueView> {
    ensure(&state, &track)?;
    Ok(state.with_queue(|q| {
        q.play_next(track);
        view(q)
    }))
}

#[tauri::command]
pub async fn queue_remove(state: State<'_, AppState>, position: usize) -> AppResult<QueueView> {
    let removed = state.with_queue(|q| q.remove(position));
    if !removed {
        return Err(AppError::invalid("posisi antrean tidak valid"));
    }
    Ok(view(&state.queue_snapshot()))
}

#[tauri::command]
pub async fn queue_move(
    state: State<'_, AppState>,
    from: usize,
    to: usize,
) -> AppResult<QueueView> {
    let moved = state.with_queue(|q| q.move_item(from, to));
    if !moved {
        return Err(AppError::invalid("posisi antrean tidak valid"));
    }
    Ok(view(&state.queue_snapshot()))
}

#[tauri::command]
pub async fn queue_clear(state: State<'_, AppState>) -> AppResult<QueueView> {
    Ok(state.with_queue(|q| {
        q.clear();
        view(q)
    }))
}

/// Ganti seluruh antrean dengan daftar lagu baru, mulai dari `start_index`.
///
/// Dipakai saat memutar playlist atau klik ganda sebuah baris lagu di dalam
/// playlist / Lagu Disukai (DESIGN-LAYOUT bagian 3.3).
#[tauri::command]
pub async fn queue_replace(
    state: State<'_, AppState>,
    tracks: Vec<Track>,
    start_index: Option<usize>,
) -> AppResult<QueueView> {
    if tracks.is_empty() {
        return Err(AppError::invalid("daftar lagu kosong"));
    }
    ensure_tracks(&state.db, &tracks)?;
    let idx = start_index.unwrap_or(0);
    Ok(state.with_queue(|q| {
        q.replace(tracks, idx);
        view(q)
    }))
}

/// Jadikan lagu pada posisi tertentu sebagai lagu aktif.
#[tauri::command]
pub async fn queue_jump(state: State<'_, AppState>, position: usize) -> AppResult<QueueView> {
    let ok = state.with_queue(|q| q.jump_to(position));
    if !ok {
        return Err(AppError::invalid("posisi antrean tidak valid"));
    }
    Ok(view(&state.queue_snapshot()))
}

#[tauri::command]
pub async fn set_shuffle(state: State<'_, AppState>, enabled: bool) -> AppResult<QueueView> {
    Ok(state.with_queue(|q| {
        q.set_shuffle(enabled);
        view(q)
    }))
}

#[tauri::command]
pub async fn set_repeat(state: State<'_, AppState>, mode: RepeatMode) -> AppResult<QueueView> {
    Ok(state.with_queue(|q| {
        q.set_repeat(mode);
        view(q)
    }))
}

/// Maju ke lagu berikutnya.
///
/// Mengembalikan `None` kalau antrean sudah habis (repeat off di akhir) — UI
/// memakai ini untuk menghentikan pemutaran, bukan menganggapnya error.
#[tauri::command]
pub async fn queue_next(state: State<'_, AppState>) -> AppResult<Option<QueueView>> {
    Ok(state.with_queue(|q| {
        // `next()` sendiri yang memutuskan; jangan menebak dari hasil sampingan.
        if q.advance().is_some() {
            Some(view(q))
        } else {
            None
        }
    }))
}

/// Mundur ke lagu sebelumnya.
#[tauri::command]
pub async fn queue_previous(state: State<'_, AppState>) -> AppResult<Option<QueueView>> {
    Ok(state.with_queue(|q| {
        if q.retreat().is_some() {
            Some(view(q))
        } else {
            None
        }
    }))
}
