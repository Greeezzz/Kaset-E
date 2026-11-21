use serde::Serialize;
use tauri::{Emitter, State};

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

/// Unduh cover untuk `key` (format `v:<video_id>`) ke cache lokal dan simpan
/// ke tabel `covers`. UI tidak boleh nunggu ini — panggil di background, lalu
/// render dari path lokal yang dikembalikan lewat event `cover://ready`.
///
/// Tangga kualitas: maxresdefault → sddefault → hqdefault → mqdefault.
/// Maksimal 5 MB per file, validasi magic bytes sebelum tulis disk.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverDownloadResult {
    pub key: String,
    pub path: Option<String>,
    pub status: String,
}

const MAX_COVER_BYTES: u64 = 5 * 1024 * 1024;

const COVER_TANGGA: &[&str] = &["maxresdefault", "sddefault", "hqdefault", "mqdefault"];

#[tauri::command]
pub async fn cover_download(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    key: String,
) -> AppResult<CoverDownloadResult> {
    if key.trim().is_empty() {
        return Err(AppError::invalid("key cover kosong"));
    }

    let video_id = key.strip_prefix("v:").unwrap_or(&key);
    let covers_dir = state.covers_dir();
    std::fs::create_dir_all(&covers_dir)?;

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::REFERER,
        reqwest::header::HeaderValue::from_static("https://www.youtube.com/"),
    );
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static(
            "image/avif,image/webp,image/*,*/*;q=0.8",
        ),
    );

    let client = reqwest::Client::builder()
        // UA harus menyerupai browser sungguhan. Dengan UA ringkas seperti
        // "Kaset/1.0", i.ytimg.com membalas 200 tapi body kosong — bukan
        // error HTTP, jadi tanpa validasi magic bytes ini akan tersimpan
        // sebagai file 0 byte yang tampak "berhasil".
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .default_headers(headers)
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;

    let mut attempts: i32 = 0;

    for nama in COVER_TANGGA {
        attempts += 1;
        let url = format!("https://i.ytimg.com/vi/{video_id}/{nama}.jpg");
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(url = %url, error = %e, "cover: permintaan gagal");
                continue;
            }
        };
        if !resp.status().is_success() {
            tracing::warn!(url = %url, status = %resp.status(), "cover: status bukan 2xx");
            continue;
        }

        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(url = %url, error = %e, "cover: baca body gagal");
                continue;
            }
        };
        if bytes.len() > MAX_COVER_BYTES as usize {
            tracing::warn!(url = %url, len = bytes.len(), "cover: file terlalu besar");
            continue;
        }
        if !is_gambar_valid(&bytes) {
            tracing::warn!(
                url = %url,
                len = bytes.len(),
                awal = ?&bytes[..bytes.len().min(8)],
                "cover: isi bukan JPEG/PNG"
            );
            continue;
        }

        // Kunci cover berbentuk `v:<video_id>`, dan titik dua ILEGAL di nama
        // file Windows. Menyimpannya apa adanya membuat std::fs::write selalu
        // gagal tanpa gejala — file tidak pernah ada, dan semua tangga
        // kualitas tampak "gagal" padahal gambarnya sudah terunduh.
        let rel = format!("{}.jpg", nama_file_aman(&key));
        let abs = covers_dir.join(&rel);
        if let Err(e) = std::fs::write(&abs, &bytes) {
            tracing::warn!(path = %abs.display(), error = %e, "cover: tulis file gagal");
            continue;
        }

        let bytes_len = bytes.len() as i64;
        state.db.with(|c| {
            c.execute(
                "INSERT INTO covers (key, kind, path, width, height, bytes, status, attempts, last_try_at, fetched_at)
                 VALUES (?1, 'track', ?2, NULL, NULL, ?3, 'ok', ?4, ?5, ?6)
                 ON CONFLICT(key) DO UPDATE SET
                   kind='track', path=excluded.path, bytes=excluded.bytes,
                   status='ok', attempts=excluded.attempts, last_try_at=excluded.last_try_at,
                   fetched_at=excluded.fetched_at",
                rusqlite::params![
                    key,
                    rel,
                    bytes_len,
                    attempts,
                    now_ms(),
                    now_ms()
                ],
            )?;
            Ok(())
        })?;

        let _ = app.emit(
            "cover://ready",
            serde_json::json!({ "key": key, "path": abs.to_string_lossy() }),
        );

        return Ok(CoverDownloadResult {
            key,
            path: Some(abs.to_string_lossy().to_string()),
            status: "ok".into(),
        });
    }

    // Semua tangga gagal — tandai error, jangan ulang tak terbatas.
    state.db.with(|c| {
        c.execute(
            "INSERT INTO covers (key, kind, path, width, height, bytes, status, attempts, last_try_at, fetched_at)
             VALUES (?1, 'track', NULL, NULL, NULL, 0, 'error', ?2, ?3, NULL)
             ON CONFLICT(key) DO UPDATE SET
               status='error', attempts=excluded.attempts, last_try_at=excluded.last_try_at",
            rusqlite::params![key, attempts, now_ms()],
        )?;
        Ok(())
    })?;

    Ok(CoverDownloadResult {
        key,
        path: None,
        status: "error".into(),
    })
}

/// Ubah kunci cover jadi nama file yang aman di semua platform.
///
/// Kunci berbentuk `v:<video_id>` dan `a:<collection_id>`. Titik dua ilegal di
/// Windows, jadi diganti `-`. Hasilnya: `v-9RfVp-GhKfs.jpg`.
fn nama_file_aman(key: &str) -> String {
    key.chars()
        .map(|c| match c {
            ':' | '/' | '\\' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect()
}

fn is_gambar_valid(bytes: &[u8]) -> bool {
    if bytes.len() < 8 {
        return false;
    }
    // JPEG: FF D8 FF
    if bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return true;
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if bytes[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nama_file_tidak_mengandung_titik_dua() {
        // Regresi: titik dua di nama file membuat std::fs::write gagal diam-diam
        // di Windows, sehingga semua unduhan cover tampak gagal.
        assert_eq!(nama_file_aman("v:9RfVp-GhKfs"), "v-9RfVp-GhKfs");
        assert_eq!(nama_file_aman("a:MPREb_abc"), "a-MPREb_abc");
        assert!(!nama_file_aman("v:x").contains(':'));
        assert!(!nama_file_aman(r"a:/b\c").contains(['/', '\\']));
    }

    #[test]
    fn deteksi_jpeg_dan_png() {
        assert!(is_gambar_valid(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));
        assert!(is_gambar_valid(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        assert!(!is_gambar_valid(&[0x00, 0x01]));
        assert!(!is_gambar_valid(b"bukan gambar"));
    }
}
