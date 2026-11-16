pub mod catalog;
pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod resolver;
pub mod state;

use tauri::Manager;

/// Titik masuk yang dipanggil `main.rs`. Dipisah dari main supaya bisa diuji
/// dan supaya Android dapat memakai entri yang sama (ARCHITECTURE.md §9).
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kaset_lib=info,warn".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir tidak tersedia: {e}"))?;
            let state = state::AppState::new(data_dir)
                .map_err(|e| format!("gagal menyiapkan state: {e}"))?;
            tracing::info!(dir = %state.data_dir.display(), "Kaset mulai");
            let handle = app.handle().clone();
            app.manage(state);

            // Upgrade ke katalog nyata di background: jendela tidak menunggu
            // jaringan, dan kalau gagal aplikasi tetap jalan dengan mock.
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<state::AppState>();
                state.upgrade_catalog().await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::search,
            commands::search_suggestions,
            commands::track,
            commands::catalog_status,
            commands::resolve_stream,
            commands::cover_get,
            commands::cover_stats,
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan Kaset");
}

#[cfg(test)]
mod tests {
    use super::db::{get_setting, set_setting, table_names, Db};

    #[test]
    fn migrasi_membuat_semua_tabel_inti() {
        let db = Db::open_in_memory().expect("buka db in-memory");
        let tables = table_names(&db).expect("daftar tabel");
        for expected in [
            "tracks",
            "playlists",
            "playlist_tracks",
            "favorites",
            "history",
            "queue_items",
            "settings",
            "covers",
        ] {
            assert!(
                tables.iter().any(|t| t == expected),
                "tabel {expected} hilang; yang ada: {tables:?}"
            );
        }
    }

    #[test]
    fn migrasi_idempoten() {
        let db = Db::open_in_memory().expect("buka db in-memory");
        // Menjalankan ulang migrasi tidak boleh error dan tidak menggandakan baris.
        super::db::migrations::run(&db).expect("migrasi kedua harus no-op");
        let count: i64 = db
            .with(|c| Ok(c.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))?))
            .expect("hitung migrasi");
        assert_eq!(count as usize, super::db::migrations::versions().len());
    }

    #[test]
    fn versi_skema_terakhir_tercatat() {
        let db = Db::open_in_memory().expect("buka db in-memory");
        let v = db.schema_version().expect("versi");
        assert_eq!(v.as_deref(), Some("0002"));
    }

    #[test]
    fn settings_roundtrip() {
        let db = Db::open_in_memory().expect("buka db in-memory");
        assert_eq!(get_setting(&db, "tema").expect("get"), None);
        set_setting(&db, "tema", "gelap").expect("set");
        assert_eq!(
            get_setting(&db, "tema").expect("get"),
            Some("gelap".to_string())
        );
        set_setting(&db, "tema", "terang").expect("update");
        assert_eq!(
            get_setting(&db, "tema").expect("get"),
            Some("terang".to_string())
        );
    }

    #[test]
    fn foreign_key_aktif() {
        let db = Db::open_in_memory().expect("buka db in-memory");
        // playlist_tracks.video_id mereferensikan tracks — harus ditolak.
        let res = db.with(|c| {
            c.execute(
                "INSERT INTO playlist_tracks (playlist_id, video_id, position, added_at)
                 VALUES (1, 'tidak-ada', 0, 1)",
                [],
            )?;
            Ok(())
        });
        assert!(
            res.is_err(),
            "FK seharusnya menolak video_id yang tidak ada"
        );
    }
}
