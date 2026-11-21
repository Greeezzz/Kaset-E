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

/// Jalankan eviction LRU pada cache cover (THUMBNAILS.md §5).
///
/// Batas: 250 MB atau 3000 file, mana yang tercapai dulu. Cover yang masih
/// dirujuk playlist/favorit/antrean dipertahankan — menghapusnya berarti user
/// melihat placeholder untuk lagu yang jelas-jelas masih ada di library-nya.
/// Cover lagu yang sedang diputar tidak pernah dihapus.
#[tauri::command]
pub async fn cover_evict(state: State<'_, AppState>) -> AppResult<CoverEvictResult> {
    evict(state.db.as_ref(), &state.covers_dir(), MAX_BYTES, MAX_FILES)
}

/// Batas cache cover: 250 MB atau 3000 file, mana yang tercapai dulu.
const MAX_BYTES: i64 = 250 * 1024 * 1024;
const MAX_FILES: i64 = 3000;

/// Inti eviction, dipisah dari Tauri `State` supaya bisa diuji dengan DB
/// in-memory dan folder sementara.
fn evict(
    db: &crate::db::Db,
    covers_dir: &std::path::Path,
    max_bytes: i64,
    max_files: i64,
) -> AppResult<CoverEvictResult> {

    // Kunci yang masih dirujuk: favorit, isi playlist, dan antrean aktif.
    // `video_id` di tabel-tabel itu dipetakan ke kunci `v:<id>`.
    let dilindungi: std::collections::HashSet<String> = db.with(|c| {
        let mut set = std::collections::HashSet::new();
        for sql in [
            "SELECT 'v:' || video_id FROM favorites",
            "SELECT 'v:' || video_id FROM playlist_tracks",
            "SELECT 'v:' || video_id FROM queue_items",
            "SELECT 'v:' || video_id FROM history ORDER BY played_at DESC LIMIT 200",
        ] {
            let mut stmt = c.prepare(sql)?;
            let mut rows = stmt.query([])?;
            while let Some(r) = rows.next()? {
                set.insert(r.get::<_, String>(0)?);
            }
        }
        Ok(set)
    })?;

    let stats = db.with(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*), COALESCE(SUM(bytes), 0) FROM covers WHERE status = 'ok'",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )?)
    })?;

    let (mut jumlah, mut total_bytes) = stats;
    if jumlah <= max_files && total_bytes <= max_bytes {
        return Ok(CoverEvictResult {
            dihapus: 0,
            bytes_dibebaskan: 0,
            tersisa: jumlah,
            bytes_tersisa: total_bytes,
        });
    }

    // Urut dari paling lama tidak dipakai. `fetched_at` NULL dianggap paling tua
    // supaya baris rusak ikut dibersihkan.
    let kandidat: Vec<(String, Option<String>, i64)> = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT key, path, COALESCE(bytes, 0) FROM covers
             WHERE status = 'ok'
             ORDER BY COALESCE(fetched_at, 0) ASC",
        )?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push((r.get(0)?, r.get(1)?, r.get(2)?));
        }
        Ok(out)
    })?;

    let mut dihapus = 0i64;
    let mut bytes_dibebaskan = 0i64;

    for (key, path, bytes) in kandidat {
        if jumlah <= max_files && total_bytes <= max_bytes {
            break;
        }
        if dilindungi.contains(&key) {
            continue;
        }

        if let Some(rel) = &path {
            let abs = covers_dir.join(rel);
            if std::fs::remove_file(&abs).is_ok() {
                bytes_dibebaskan += bytes;
                total_bytes -= bytes;
                jumlah -= 1;
                dihapus += 1;
            }
        }

        // Baris tetap dihapus walau file sudah tidak ada: DB tidak boleh
        // menyimpan rujukan ke file yang sudah lenyap.
        db.with(|c| {
            c.execute("DELETE FROM covers WHERE key = ?1", [&key])?;
            Ok(())
        })?;
    }

    tracing::info!(
        dihapus,
        bytes_dibebaskan,
        tersisa = jumlah,
        "eviction cache cover selesai"
    );

    Ok(CoverEvictResult {
        dihapus,
        bytes_dibebaskan,
        tersisa: jumlah,
        bytes_tersisa: total_bytes,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverEvictResult {
    pub dihapus: i64,
    pub bytes_dibebaskan: i64,
    pub tersisa: i64,
    pub bytes_tersisa: i64,
}

/// Ubah kunci cover jadi nama file yang aman di semua platform.
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

    /// Siapkan DB in-memory + folder cover sementara berisi N baris & file.
    fn siapkan(n: i64, ukuran: i64) -> (crate::db::Db, std::path::PathBuf) {
        let db = crate::db::Db::open_in_memory().expect("db");
        // Nama folder harus unik per pemanggilan: tes berjalan paralel, dan
        // now_ms() saja bisa sama sehingga dua tes berbagi folder lalu saling
        // menghapus file — hasilnya gagal acak yang menyesatkan.
        static URUTAN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let unik = URUTAN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "kaset_cover_test_{}_{unik}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("folder");
        for i in 0..n {
            let key = format!("v:uji{i}");
            let rel = format!("{}.jpg", nama_file_aman(&key));
            std::fs::write(dir.join(&rel), vec![0u8; ukuran as usize]).expect("tulis");
            db.with(|c| {
                c.execute(
                    "INSERT INTO covers (key, kind, path, bytes, status, attempts, fetched_at)
                     VALUES (?1, 'track', ?2, ?3, 'ok', 1, ?4)",
                    rusqlite::params![key, rel, ukuran, 1000 + i],
                )?;
                Ok(())
            })
            .expect("insert");
        }
        (db, dir)
    }

    fn jumlah_baris(db: &crate::db::Db) -> i64 {
        db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM covers", [], |r| r.get(0))?))
            .expect("hitung")
    }

    #[test]
    fn eviction_menghapus_yang_paling_lama_sampai_batas() {
        let (db, dir) = siapkan(10, 1000);
        // Batas 6 file: 4 tertua harus pergi.
        let r = evict(&db, &dir, i64::MAX, 6).expect("evict");
        assert_eq!(r.dihapus, 4, "harus menghapus 4 file");
        assert_eq!(jumlah_baris(&db), 6, "sisanya harus tepat 6");
        // Yang tersisa harus yang fetched_at paling baru (uji4..uji9).
        let sisa: Vec<String> = db
            .with(|c| {
                let mut s = c.prepare("SELECT key FROM covers ORDER BY fetched_at")?;
                let mut rows = s.query([])?;
                let mut out = Vec::new();
                while let Some(row) = rows.next()? {
                    out.push(row.get::<_, String>(0)?);
                }
                Ok(out)
            })
            .expect("baca");
        assert_eq!(sisa.first().map(String::as_str), Some("v:uji4"));
        // File yang dihapus benar-benar hilang dari disk.
        assert!(!dir.join("v-uji0.jpg").exists());
        assert!(dir.join("v-uji9.jpg").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn eviction_mempertahankan_cover_yang_masih_dirujuk() {
        let (db, dir) = siapkan(10, 1000);
        // uji0 paling tua TAPI jadi favorit -> tidak boleh dihapus.
        db.with(|c| {
            c.execute(
                "INSERT INTO tracks (video_id, title, artist, updated_at) VALUES ('uji0', 'Judul', 'Artis', 1)",
                [],
            )?;
            c.execute("INSERT INTO favorites (video_id, added_at) VALUES ('uji0', 1)", [])?;
            Ok(())
        })
        .expect("favorit");

        let r = evict(&db, &dir, i64::MAX, 6).expect("evict");
        assert_eq!(r.dihapus, 4);
        assert!(
            dir.join("v-uji0.jpg").exists(),
            "cover favorit tidak boleh dihapus"
        );
        // Yang pergi adalah uji1..uji4 (paling tua setelah uji0 dilindungi).
        assert!(!dir.join("v-uji1.jpg").exists());
        assert!(dir.join("v-uji5.jpg").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn eviction_tidak_menyentuh_apa_pun_di_bawah_batas() {
        let (db, dir) = siapkan(5, 1000);
        let r = evict(&db, &dir, i64::MAX, 3000).expect("evict");
        assert_eq!(r.dihapus, 0);
        assert_eq!(jumlah_baris(&db), 5);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn eviction_menghormati_batas_byte() {
        let (db, dir) = siapkan(10, 1000);
        // Batas 3500 byte: harus menyisakan 3 file.
        let r = evict(&db, &dir, 3500, 3000).expect("evict");
        assert!(r.dihapus >= 7, "harus menghapus minimal 7, dapat {}", r.dihapus);
        assert!(r.bytes_tersisa <= 3500, "harus di bawah batas byte");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deteksi_jpeg_dan_png() {
        assert!(is_gambar_valid(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));
        assert!(is_gambar_valid(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
        assert!(!is_gambar_valid(&[0x00, 0x01]));
        assert!(!is_gambar_valid(b"bukan gambar"));
    }
}
