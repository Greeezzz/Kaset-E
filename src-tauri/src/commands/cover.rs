use serde::Serialize;
use tauri::State;

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Hasil lookup cover. `path` null = belum ada di cache lokal; UI harus render
/// placeholder generatif, bukan menembak server gambar YouTube.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverLookup {
    pub key: String,
    pub path: Option<String>,
    pub status: String,
}

#[tauri::command]
pub async fn cover_get(state: State<'_, AppState>, key: String) -> AppResult<CoverLookup> {
    if key.trim().is_empty() {
        return Err(AppError::invalid("key cover kosong"));
    }
    let covers_dir = state.covers_dir();

    let row: Option<(Option<String>, String)> = state.db.with(|c| {
        let mut stmt = c.prepare("SELECT path, status FROM covers WHERE key = ?1")?;
        let mut rows = stmt.query([&key])?;
        match rows.next()? {
            Some(r) => Ok(Some((r.get(0)?, r.get(1)?))),
            None => Ok(None),
        }
    })?;

    match row {
        // Verifikasi file benar-benar ada: DB bisa saja bilang 'ok' padahal user
        // menghapus folder data. Jangan pernah kembalikan path hantu ke UI.
        Some((Some(path), status)) if status == "ok" => {
            let abs = covers_dir.join(&path);
            if abs.is_file() {
                Ok(CoverLookup {
                    key,
                    path: Some(abs.to_string_lossy().to_string()),
                    status: "ok".into(),
                })
            } else {
                state.db.with(|c| {
                    c.execute(
                        "UPDATE covers SET status = 'missing', path = NULL, last_try_at = ?2 WHERE key = ?1",
                        rusqlite::params![key, now_ms()],
                    )?;
                    Ok(())
                })?;
                Ok(CoverLookup {
                    key,
                    path: None,
                    status: "missing".into(),
                })
            }
        }
        Some((_, status)) => Ok(CoverLookup {
            key,
            path: None,
            status,
        }),
        None => Ok(CoverLookup {
            key,
            path: None,
            status: "missing".into(),
        }),
    }
}

/// Statistik cache cover — dipakai Settings dan nanti eviction LRU.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverStats {
    pub total: i64,
    pub ok: i64,
    pub missing: i64,
    pub error: i64,
    pub bytes: i64,
}

#[tauri::command]
pub async fn cover_stats(state: State<'_, AppState>) -> AppResult<CoverStats> {
    state.db.with(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(status = 'ok'), 0),
                    COALESCE(SUM(status = 'missing'), 0),
                    COALESCE(SUM(status = 'error'), 0),
                    COALESCE(SUM(bytes), 0)
             FROM covers",
            [],
            |r| {
                Ok(CoverStats {
                    total: r.get(0)?,
                    ok: r.get(1)?,
                    missing: r.get(2)?,
                    error: r.get(3)?,
                    bytes: r.get(4)?,
                })
            },
        )?)
    })
}
