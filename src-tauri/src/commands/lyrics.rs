//! Command Tauri untuk lirik (FEATURES-V3 §4 L1).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::lyrics;
use crate::error::AppResult;
use crate::lyrics::lrc::{ParsedLyrics, parse_lrc};
use crate::lyrics::lrclib::{
    KandidatLirik, MetadataLagu, cari_lrclib, fetch_lrclib, metadata_lagu,
};
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
pub async fn lyrics_get(
    state: State<'_, AppState>,
    video_id: String,
) -> AppResult<Option<LyricsResponse>> {
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

    let raw = lyrics::get_lyrics(&state.db, &video_id)?.ok_or_else(|| {
        crate::error::AppError::NotFound("Lirik tidak ditemukan setelah disimpan".into())
    })?;

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

/// Mengambil lirik dari LRCLIB jika setting `lirik.lrclib` bernilai "1" (§4 L5).
/// Jika berhasil ditemukan, otomatis disimpan ke database SQLite sebagai sumber "lrclib".
#[tauri::command]
pub async fn lyrics_fetch_lrclib(
    state: State<'_, AppState>,
    video_id: String,
    title: String,
    artist: String,
    duration_secs: Option<f64>,
) -> AppResult<Option<LyricsResponse>> {
    // 1. Cek setting privasi (opt-in)
    let opt_in = crate::db::get_setting(&state.db, "lirik.lrclib")?.unwrap_or_else(|| "0".into());
    if opt_in != "1" {
        return Ok(None);
    }

    // 2. Cek apakah di database sudah ada lirik (hindari network request ganda)
    if let Some(existing) = lyrics::get_lyrics(&state.db, &video_id)? {
        let parsed = parse_lrc(&existing.lrc);
        return Ok(Some(LyricsResponse {
            video_id: existing.video_id,
            lrc: existing.lrc,
            sumber: existing.sumber,
            offset_ms: existing.offset_ms,
            diambil_pada: existing.diambil_pada,
            parsed,
        }));
    }

    // 3. Panggil API LRCLIB
    match fetch_lrclib(&title, &artist, duration_secs).await {
        Ok(Some(text)) => {
            let parsed = parse_lrc(&text);
            if parsed.lines.is_empty() {
                return Ok(None);
            }

            // Simpan otomatis ke DB
            lyrics::set_lyrics_text(&state.db, &video_id, &text, "lrclib", None)?;

            let raw = lyrics::get_lyrics(&state.db, &video_id)?.ok_or_else(|| {
                crate::error::AppError::NotFound("Lirik tidak ditemukan setelah disimpan".into())
            })?;

            Ok(Some(LyricsResponse {
                video_id: raw.video_id,
                lrc: raw.lrc,
                sumber: raw.sumber,
                offset_ms: raw.offset_ms,
                diambil_pada: raw.diambil_pada,
                parsed,
            }))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            tracing::warn!(error = %e, "LRCLIB fetch error");
            Ok(None)
        }
    }
}

/// Metadata yang sudah dibersihkan (judul, artis, hasil parser `Artis - Judul`).
/// Dipakai UI untuk mengisi kolom pencarian manual dengan judul yang layak.
#[tauri::command]
pub fn lyrics_metadata_lirik(title: String, artist: String) -> MetadataLagu {
    metadata_lagu(&title, &artist)
}

/// Pencarian manual di LRCLIB untuk panel `CARI LIRIK`.
///
/// Berbeda dari `lyrics_fetch_lrclib`, jalur ini dipicu klik user sehingga tidak
/// bergantung pada setting opt-in; user sendiri yang meminta pencarian.
#[tauri::command]
pub async fn lyrics_search_lrclib(
    query: String,
    duration_secs: Option<f64>,
) -> AppResult<Vec<KandidatLirik>> {
    cari_lrclib(&query, duration_secs)
        .await
        .map_err(crate::error::AppError::Network)
}

/// Impor berkas lirik dari path lokal (dialog native).
/// Membaca berkas (maks 1MB), memvalidasi teks UTF-8 / decode, menyimpan ke DB, dan mengembalikan parsed lirik.
#[tauri::command]
pub async fn lyrics_import_file(
    state: State<'_, AppState>,
    video_id: String,
    path: String,
) -> AppResult<LyricsResponse> {
    let metadata = std::fs::metadata(&path)?;
    if metadata.len() > 1_048_576 {
        return Err(crate::error::AppError::invalid(
            "Ukuran berkas lirik melebihi batas 1 MB",
        ));
    }

    let bytes = std::fs::read(&path)?;
    // Coba konversi UTF-8; jika bukan UTF-8 murni, gunakan lossy decode
    let text = match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => String::from_utf8_lossy(&bytes).to_string(),
    };

    let parsed = parse_lrc(&text);
    if parsed.lines.is_empty() {
        return Err(crate::error::AppError::invalid(
            "Berkas lirik tidak memiliki baris teks yang dapat dibaca",
        ));
    }

    lyrics::set_lyrics_text(&state.db, &video_id, &text, "impor", None)?;

    let raw = lyrics::get_lyrics(&state.db, &video_id)?.ok_or_else(|| {
        crate::error::AppError::NotFound("Lirik tidak ditemukan setelah disimpan".into())
    })?;

    Ok(LyricsResponse {
        video_id: raw.video_id,
        lrc: raw.lrc,
        sumber: raw.sumber,
        offset_ms: raw.offset_ms,
        diambil_pada: raw.diambil_pada,
        parsed,
    })
}
