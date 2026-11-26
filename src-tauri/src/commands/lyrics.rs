//! Command Tauri untuk lirik (FEATURES-V3 §4 L1).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::lyrics;
use crate::error::AppResult;
use crate::lyrics::lrc::{parse_lrc, ParsedLyrics};
use crate::state::AppState;

/// Hasil pengembalian saat UI meminta lirik:
/// teks asli, metadata sumber, offset, dan struktur lirik yang siap dirender.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsResponse {
    pub video_id: String,
    pub lrc: String,
    pub sumber: String,
    pub offset_ms: i64,
    pub diambil_pada: i64,
    pub parsed: ParsedLyrics,
}

#[tauri::command]
pub async fn lyrics_get(state: State<'_, AppState>, video_id: String) -> AppResult<Option<LyricsResponse>> {
    let raw = lyrics::get_lyrics(&state.db, &video_id)?;
    if let Some(item) = raw {
        let parsed = parse_lrc(&item.lrc);
        Ok(Some(LyricsResponse {
            video_id: item.video_id,
            lrc: item.lrc,
            sumber: item.sumber,
            offset_ms: item.offset_ms,
            diambil_pada: item.diambil_pada,
            parsed,
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn lyrics_set_from_text(
    state: State<'_, AppState>,
    video_id: String,
    text: String,
    sumber: Option<String>,
    offset_ms: Option<i64>,
) -> AppResult<LyricsResponse> {
    let sumber_str = sumber.unwrap_or_else(|| "impor".to_string());
    lyrics::set_lyrics_text(&state.db, &video_id, &text, &sumber_str, offset_ms)?;

    let raw = lyrics::get_lyrics(&state.db, &video_id)?
        .ok_or_else(|| crate::error::AppError::NotFound("Lirik tidak ditemukan setelah disimpan".into()))?;

    let parsed = parse_lrc(&raw.lrc);
    Ok(LyricsResponse {
        video_id: raw.video_id,
        lrc: raw.lrc,
        sumber: raw.sumber,
        offset_ms: raw.offset_ms,
        diambil_pada: raw.diambil_pada,
        parsed,
    })
}

#[tauri::command]
pub async fn lyrics_set_offset(
    state: State<'_, AppState>,
    video_id: String,
    offset_ms: i64,
) -> AppResult<bool> {
    lyrics::set_lyrics_offset(&state.db, &video_id, offset_ms)
}

#[tauri::command]
pub async fn lyrics_delete(state: State<'_, AppState>, video_id: String) -> AppResult<bool> {
    lyrics::delete_lyrics(&state.db, &video_id)
}
