pub mod catalog;
pub mod commands;
pub mod db;
pub mod error;
pub mod import;
pub mod lyrics;
pub mod models;
pub mod paths;
pub mod playlist_cover;
pub mod queue;
pub mod resolver;
pub mod state;
#[cfg(desktop)]
pub mod media_keys;
#[cfg(desktop)]
pub mod tray;

use tauri::Manager;

/// Titik masuk yang dipanggil `main.rs`. Dipisah dari main supaya bisa diuji
/// dan supaya Android dapat memakai entri yang sama (ARCHITECTURE.md §9).
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kaset_lib=debug,warn".into()),
        )
        .init();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app_data_dir tidak tersedia: {e}"))?;
            // Dipasang lebih dulu supaya resolver bisa menemukan folder ini saat
            // mencari (dan mengunduh) yt-dlp.
            paths::set_data_dir(data_dir.clone());
            let state = state::AppState::new(data_dir)
                .map_err(|e| format!("gagal menyiapkan state: {e}"))?;
            tracing::info!(dir = %state.data_dir.display(), "Kaset mulai");
            let handle = app.handle().clone();
            app.manage(state);

            #[cfg(desktop)]
            if let Err(e) = tray::setup(&handle) {
                tracing::warn!(error = %e, "gagal memasang menu tray");
            }
            #[cfg(desktop)]
            media_keys::setup(&handle);

            // Upgrade katalog dan resolver di background: jendela tidak menunggu
            // jaringan. Kalau gagal, aplikasi tetap jalan dengan mock.
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<state::AppState>();
                state.upgrade_catalog().await;
                state.upgrade_resolver().await;
                // Pembersihan cadangan tidak butuh jaringan; jalankan setelah
                // resolver siap supaya tidak berebut disk saat unduhan.
                #[cfg(windows)]
                crate::resolver::ytdlp::bersihkan_cadangan_lama();
            });

            // Bersihkan cache cover sekali saat start, setelah katalog siap.
            // Dijalankan di task terpisah supaya eviction tidak menunda apa pun;
            // kalau gagal, cache hanya tetap besar — bukan alasan gagal buka app.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                let state = handle2.state::<state::AppState>();
                match commands::cover_evict(state.clone()).await {
                    Ok(r) if r.dihapus > 0 => {
                        tracing::info!(dihapus = r.dihapus, "cache cover dibersihkan saat start")
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!(error = %e, "eviction cover gagal saat start"),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::search,
            commands::search_suggestions,
            commands::search_history_list,
            commands::search_history_remove,
            commands::search_history_clear,
            commands::track,
            commands::catalog_status,
            commands::resolver_status,
            commands::resolver_preparing,
            commands::tracks_count,
            commands::resolve_stream,
            commands::cover_get,
            commands::cover_stats,
            commands::cover_download,
            commands::cover_evict,
            commands::setting_get,
            commands::setting_set,
            commands::queue_get,
            commands::queue_add,
            commands::queue_play_now,
            commands::queue_play_next,
            commands::queue_remove,
            commands::queue_move,
            commands::queue_clear,
            commands::queue_replace,
            commands::queue_jump,
            commands::queue_next,
            commands::queue_previous,
            commands::set_shuffle,
            commands::set_repeat,
            commands::toggle_favorite,
            commands::list_favorites,
            commands::is_favorite,
            commands::import_parse,
            commands::import_ekspor_tidak_masuk,
            commands::import_cocokkan,
            commands::import_batal,
            commands::import_simpan,
            commands::record_play,
            commands::listen_record,
            commands::listen_summary,
            commands::listen_clear,
            commands::listen_stats,
            commands::set_shuffle_pintar,
            commands::list_history,
            commands::clear_history,
            commands::history_count,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::playlist_update_details,
            commands::playlist_cover_set,
            commands::playlist_cover_clear,
            commands::playlist_cover_path,
            commands::list_playlists,
            commands::playlist_tracks,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::play_playlist,
            commands::export_library,
            commands::import_library,
            commands::lyrics_get,
            commands::lyrics_set_from_text,
            commands::lyrics_set_offset,
            commands::lyrics_delete,
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
            "search_history",
            "lyrics",
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
        assert_eq!(v.as_deref(), Some("0008"));
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
