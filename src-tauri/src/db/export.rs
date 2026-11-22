//! Ekspor dan impor JSON library (MVP.md Fase 1 Desktop polish).
//!
//! Format portabel: hanya metadata lagu, favorit, dan playlist (nama,
//! deskripsi, daftar lagu). Path cover lokal dan URL stream tidak diekspor
//! karena terikat perangkat / cepat kedaluwarsa.
//!
//! Impor bersifat **menggabungkan** (non-destruktif): tidak pernah menghapus
//! favorit atau playlist yang sudah ada, dan aman dijalankan berulang kali.

use serde::{Deserialize, Serialize};

use crate::db::{library, now_ms, playlist, Db};
use crate::error::{AppError, AppResult};
use crate::models::Track;

const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBackup {
    pub version: u32,
    pub exported_at: i64,
    #[serde(default)]
    pub favorites: Vec<Track>,
    #[serde(default)]
    pub playlists: Vec<ExportedPlaylist>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedPlaylist {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub favorites_added: usize,
    pub playlists_created: usize,
    pub tracks_added: usize,
}

/// Ekspor seluruh favorit dan playlist ke string JSON rapi.
pub fn export_json(db: &Db) -> AppResult<String> {
    let favorites = library::list_favorites(db)?;
    let daftar = playlist::list(db)?;
    let mut playlists = Vec::with_capacity(daftar.len());
    for p in daftar {
        let tracks = playlist::tracks(db, p.id)?;
        playlists.push(ExportedPlaylist {
            name: p.name,
            description: p.description,
            tracks,
        });
    }

    let backup = LibraryBackup {
        version: FORMAT_VERSION,
        exported_at: now_ms(),
        favorites,
        playlists,
    };
    Ok(serde_json::to_string_pretty(&backup)?)
}

/// Impor JSON cadangan ke database secara non-destruktif.
pub fn import_json(db: &Db, raw: &str) -> AppResult<ImportReport> {
    let backup: LibraryBackup = serde_json::from_str(raw)
        .map_err(|_| AppError::invalid("berkas JSON tidak valid atau rusak"))?;

    if backup.version != FORMAT_VERSION {
        return Err(AppError::invalid(format!(
            "versi cadangan {} tidak didukung",
            backup.version
        )));
    }

    let mut report = ImportReport {
        favorites_added: 0,
        playlists_created: 0,
        tracks_added: 0,
    };

    for t in &backup.favorites {
        if t.video_id.trim().is_empty() {
            continue;
        }
        if !library::is_favorite(db, &t.video_id)? {
            library::add_favorite(db, t)?;
            report.favorites_added += 1;
        }
    }

    let existing = playlist::list(db)?;
    let mut by_name: std::collections::HashMap<String, i64> =
        existing.into_iter().map(|p| (p.name, p.id)).collect();

    for ep in backup.playlists {
        let name: String = ep.name.trim().chars().take(80).collect();
        if name.is_empty() {
            continue;
        }

        let pid = if let Some(&id) = by_name.get(&name) {
            id
        } else {
            let created = playlist::create(db, &name)?;
            if let Some(desc) = ep.description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                let desc_cut: String = desc.chars().take(200).collect();
                let _ = playlist::update_details(
                    db,
                    created.id,
                    None,
                    Some(Some(&desc_cut)),
                    None,
                    None,
                );
            }
            by_name.insert(name, created.id);
            report.playlists_created += 1;
            created.id
        };

        let existing_ids: std::collections::HashSet<String> = playlist::tracks(db, pid)?
            .into_iter()
            .map(|t| t.video_id)
            .collect();

        for t in &ep.tracks {
            if t.video_id.trim().is_empty() || existing_ids.contains(&t.video_id) {
                continue;
            }
            playlist::add_track(db, pid, t)?;
            report.tracks_added += 1;
        }
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(id: &str, title: &str) -> Track {
        Track {
            video_id: id.to_string(),
            title: title.to_string(),
            artist: "Artis".to_string(),
            album: Some("Album".to_string()),
            duration_ms: Some(180_000),
            cover_key: Track::cover_key_for(id),
        }
    }

    #[test]
    fn export_lalu_import_ke_db_kosong_memulihkan_semua() {
        let asal = Db::open_in_memory().unwrap();
        library::add_favorite(&asal, &track("f1", "Fav Satu")).unwrap();
        let p = playlist::create(&asal, "Malam").unwrap();
        playlist::update_details(&asal, p.id, None, Some(Some("Untuk begadang")), None, None)
            .unwrap();
        playlist::add_track(&asal, p.id, &track("a", "Lagu A")).unwrap();
        playlist::add_track(&asal, p.id, &track("b", "Lagu B")).unwrap();

        let json = export_json(&asal).unwrap();

        let tujuan = Db::open_in_memory().unwrap();
        let rep = import_json(&tujuan, &json).unwrap();
        assert_eq!(
            rep,
            ImportReport {
                favorites_added: 1,
                playlists_created: 1,
                tracks_added: 2,
            }
        );

        let favs = library::list_favorites(&tujuan).unwrap();
        assert_eq!(favs.len(), 1);
        assert_eq!(favs[0].video_id, "f1");

        let pls = playlist::list(&tujuan).unwrap();
        assert_eq!(pls.len(), 1);
        assert_eq!(pls[0].name, "Malam");
        assert_eq!(pls[0].description.as_deref(), Some("Untuk begadang"));
        let tr = playlist::tracks(&tujuan, pls[0].id).unwrap();
        assert_eq!(
            tr.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn import_ulang_idempoten_tidak_menggandakan() {
        let db = Db::open_in_memory().unwrap();
        library::add_favorite(&db, &track("f1", "Fav")).unwrap();
        let p = playlist::create(&db, "Santai").unwrap();
        playlist::add_track(&db, p.id, &track("a", "A")).unwrap();

        let json = export_json(&db).unwrap();
        let rep = import_json(&db, &json).unwrap();
        assert_eq!(
            rep,
            ImportReport {
                favorites_added: 0,
                playlists_created: 0,
                tracks_added: 0,
            }
        );
        assert_eq!(playlist::list(&db).unwrap().len(), 1);
    }

    #[test]
    fn import_menolak_json_rusak_dan_versi_tidak_dikenal() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(import_json(&db, "{rusak"), Err(AppError::Invalid(_))));
        assert!(matches!(
            import_json(&db, r#"{"version":99,"exportedAt":0,"favorites":[],"playlists":[]}"#),
            Err(AppError::Invalid(_))
        ));
    }
}
