//! Tabel `favorites` dan `history`.
//!
//! Keduanya hanya menyimpan `video_id` + waktu; metadata lagu tinggal di
//! `tracks`. Pemisahan ini penting: satu lagu yang difavoritkan, diputar
//! sepuluh kali, dan ada di tiga playlist tetap punya satu baris metadata.

use rusqlite::params;

use crate::db::now_ms;
use crate::error::AppResult;
use crate::models::Track;

/// Tambahkan lagu ke favorit. Idempoten: memfavoritkan dua kali bukan error.
///
/// Mengembalikan `true` kalau baris baru benar-benar ditambahkan, `false` kalau
/// lagu sudah ada di favorit. UI memakai ini untuk memutuskan apakah akan
/// menampilkan "ditambahkan" atau "sudah ada".
pub fn add_favorite(db: &crate::db::Db, track: &Track) -> AppResult<bool> {
    crate::db::ensure_track(db, track)?;
    db.with(|c| {
        let n = c.execute(
            "INSERT INTO favorites (video_id, added_at) VALUES (?1, ?2)
             ON CONFLICT(video_id) DO NOTHING",
            params![track.video_id, now_ms()],
        )?;
        Ok(n > 0)
    })
}

/// Hapus lagu dari favorit. Mengembalikan `true` kalau memang ada yang dihapus.
pub fn remove_favorite(db: &crate::db::Db, video_id: &str) -> AppResult<bool> {
    db.with(|c| Ok(c.execute("DELETE FROM favorites WHERE video_id = ?1", [video_id])? > 0))
}

pub fn is_favorite(db: &crate::db::Db, video_id: &str) -> AppResult<bool> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT 1 FROM favorites WHERE video_id = ?1")?;
        Ok(stmt.exists([video_id])?)
    })
}

/// Daftar favorit, terbaru dulu.
pub fn list_favorites(db: &crate::db::Db) -> AppResult<Vec<Track>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT t.video_id, t.title, t.artist, t.album, t.duration_ms
             FROM favorites f
             JOIN tracks t ON t.video_id = f.video_id
             ORDER BY f.added_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Track {
                video_id: r.get(0)?,
                title: r.get(1)?,
                artist: r.get(2)?,
                album: r.get(3)?,
                duration_ms: r.get::<_, Option<i64>>(4)?.map(|d| d as u64),
                cover_key: Track::cover_key_for(&r.get::<_, String>(0)?),
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

/// Catat satu pemutaran ke `history`.
///
/// Ditulis saat lagu benar-benar mulai diputar, bukan saat diklik — pemutaran
/// yang gagal resolve tidak boleh mengotori riwayat.
pub fn record_play(db: &crate::db::Db, track: &Track) -> AppResult<()> {
    crate::db::ensure_track(db, track)?;
    db.with(|c| {
        c.execute(
            "INSERT INTO history (video_id, played_at) VALUES (?1, ?2)",
            params![track.video_id, now_ms()],
        )?;
        Ok(())
    })
}

/// Daftar riwayat, terbaru dulu, dengan lagu yang sama digabung.
///
/// `history` menyimpan setiap pemutaran (dibutuhkan statistik Fase 4), tapi
/// daftar untuk manusia harus unik — memutar satu lagu 20 kali tidak boleh
/// memenuhi seluruh layar. `MAX(played_at)` memberi waktu putar terakhir.
pub fn list_history(db: &crate::db::Db, limit: usize) -> AppResult<Vec<Track>> {
    let limit = limit.clamp(1, 500) as i64;
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT t.video_id, t.title, t.artist, t.album, t.duration_ms, MAX(h.played_at) AS terakhir
             FROM history h
             JOIN tracks t ON t.video_id = h.video_id
             GROUP BY t.video_id
             ORDER BY terakhir DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit], |r| {
            Ok(Track {
                video_id: r.get(0)?,
                title: r.get(1)?,
                artist: r.get(2)?,
                album: r.get(3)?,
                duration_ms: r.get::<_, Option<i64>>(4)?.map(|d| d as u64),
                cover_key: Track::cover_key_for(&r.get::<_, String>(0)?),
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

/// Hapus seluruh riwayat. Disediakan untuk pengaturan privasi.
pub fn clear_history(db: &crate::db::Db) -> AppResult<usize> {
    db.with(|c| Ok(c.execute("DELETE FROM history", [])?))
}

/// Jumlah baris riwayat (setiap pemutaran, bukan lagu unik).
pub fn history_count(db: &crate::db::Db) -> AppResult<i64> {
    db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn track(id: &str, title: &str) -> Track {
        Track {
            video_id: id.to_string(),
            title: title.to_string(),
            artist: "Artis".to_string(),
            album: None,
            duration_ms: Some(180_000),
            cover_key: Track::cover_key_for(id),
        }
    }

    #[test]
    fn favorit_tambah_idempoten_dan_hapus() {
        let db = Db::open_in_memory().unwrap();
        let t = track("a1", "Satu");

        assert!(add_favorite(&db, &t).unwrap(), "pertama kali = baru");
        assert!(
            !add_favorite(&db, &t).unwrap(),
            "kedua kali bukan baris baru"
        );
        assert_eq!(list_favorites(&db).unwrap().len(), 1, "tidak boleh ganda");
        assert!(is_favorite(&db, "a1").unwrap());

        assert!(remove_favorite(&db, "a1").unwrap());
        assert!(
            !remove_favorite(&db, "a1").unwrap(),
            "hapus dua kali bukan error"
        );
        assert!(!is_favorite(&db, "a1").unwrap());
    }

    #[test]
    fn favorit_otomatis_menulis_metadata_lagu() {
        let db = Db::open_in_memory().unwrap();
        // Lagu belum ada di `tracks`; add_favorite harus mengurusnya sendiri.
        add_favorite(&db, &track("baru", "Belum Dikenal")).unwrap();
        assert_eq!(crate::db::track_count(&db).unwrap(), 1);
    }

    #[test]
    fn favorit_urut_terbaru_dulu() {
        let db = Db::open_in_memory().unwrap();
        for (i, id) in ["a", "b", "c"].iter().enumerate() {
            add_favorite(&db, &track(id, &format!("Lagu {i}"))).unwrap();
            // `added_at` presisi milidetik; tanpa jeda, tiga baris bisa punya
            // waktu sama dan urutannya ditentukan SQLite secara sembarang.
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let list = list_favorites(&db).unwrap();
        assert_eq!(
            list.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["c", "b", "a"]
        );
    }

    #[test]
    fn history_mencatat_setiap_putar_tapi_daftar_unik() {
        let db = Db::open_in_memory().unwrap();
        let t = track("x", "Diulang");
        record_play(&db, &t).unwrap();
        record_play(&db, &t).unwrap();
        record_play(&db, &t).unwrap();

        assert_eq!(history_count(&db).unwrap(), 3, "setiap putar tercatat");
        assert_eq!(
            list_history(&db, 50).unwrap().len(),
            1,
            "daftar untuk user harus unik"
        );
    }

    #[test]
    fn history_menghormati_limit_dan_urutan() {
        let db = Db::open_in_memory().unwrap();
        for (i, id) in ["p", "q", "r"].iter().enumerate() {
            record_play(&db, &track(id, &format!("Lagu {i}"))).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let list = list_history(&db, 2).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].video_id, "r", "terbaru dulu");
    }

    #[test]
    fn history_bisa_dikosongkan() {
        let db = Db::open_in_memory().unwrap();
        record_play(&db, &track("z", "Z")).unwrap();
        assert_eq!(clear_history(&db).unwrap(), 1);
        assert_eq!(history_count(&db).unwrap(), 0);
        assert!(list_history(&db, 10).unwrap().is_empty());
    }
}
