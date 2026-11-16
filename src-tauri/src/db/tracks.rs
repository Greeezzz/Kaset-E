//! Tabel `tracks` — lagu yang dikenal aplikasi.
//!
//! PENTING: tanpa ini, semua tabel lain yang mereferensikan `tracks(video_id)`
//! (`favorites`, `history`, `queue_items`, `playlist_tracks`, dan nanti
//! `listen_events`) akan gagal dengan `FOREIGN KEY constraint failed`. Hasil
//! pencarian hanya hidup di memori, jadi lagu harus ditulis dulu ke sini.

use rusqlite::params;

use crate::db::now_ms;
use crate::error::AppResult;
use crate::models::Track;

/// Tulis lagu ke `tracks`, atau perbarui metadatanya kalau sudah ada.
///
/// Wajib dipanggil sebelum menulis baris apa pun yang mereferensikan
/// `tracks(video_id)`. Aman dipanggil berkali-kali: metadata YouTube bisa
/// berubah (judul diedit, durasi diperbaiki), jadi menimpa dengan data terbaru
/// adalah perilaku yang benar.
pub fn ensure_track(db: &crate::db::Db, track: &Track) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO tracks (video_id, title, artist, album, duration_ms, thumbnail, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
             ON CONFLICT(video_id) DO UPDATE SET
               title       = excluded.title,
               artist      = excluded.artist,
               album       = excluded.album,
               duration_ms = excluded.duration_ms,
               updated_at  = excluded.updated_at",
            params![
                track.video_id,
                track.title,
                track.artist,
                track.album,
                track.duration_ms.map(|d| d as i64),
                now_ms(),
            ],
        )?;
        Ok(())
    })
}

/// Tulis banyak lagu sekaligus dalam satu transaksi.
///
/// Dipakai saat menyimpan hasil pencarian ke library, supaya N lagu tidak
/// berarti N transaksi terpisah.
pub fn ensure_tracks(db: &crate::db::Db, tracks: &[Track]) -> AppResult<()> {
    if tracks.is_empty() {
        return Ok(());
    }
    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        let now = now_ms();
        {
            let mut stmt = tx.prepare(
                "INSERT INTO tracks (video_id, title, artist, album, duration_ms, thumbnail, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)
                 ON CONFLICT(video_id) DO UPDATE SET
                   title       = excluded.title,
                   artist      = excluded.artist,
                   album       = excluded.album,
                   duration_ms = excluded.duration_ms,
                   updated_at  = excluded.updated_at",
            )?;
            for t in tracks {
                stmt.execute(params![
                    t.video_id,
                    t.title,
                    t.artist,
                    t.album,
                    t.duration_ms.map(|d| d as i64),
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

/// Apakah lagu ini sudah dikenal database.
pub fn track_exists(db: &crate::db::Db, video_id: &str) -> AppResult<bool> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT 1 FROM tracks WHERE video_id = ?1")?;
        Ok(stmt.exists([video_id])?)
    })
}

/// Jumlah lagu yang tersimpan — dipakai test dan Settings.
pub fn track_count(db: &crate::db::Db) -> AppResult<i64> {
    db.with(|c| Ok(c.query_row("SELECT COUNT(*) FROM tracks", [], |r| r.get(0))?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn sample(video_id: &str, title: &str) -> Track {
        Track {
            video_id: video_id.to_string(),
            title: title.to_string(),
            artist: "Artis Contoh".to_string(),
            album: Some("Album Contoh".to_string()),
            duration_ms: Some(213_000),
            cover_key: Track::cover_key_for(video_id),
        }
    }

    #[test]
    fn ensure_track_menulis_lagu_baru() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(track_count(&db).unwrap(), 0);

        ensure_track(&db, &sample("abc123", "Lagu Satu")).unwrap();

        assert_eq!(track_count(&db).unwrap(), 1);
        assert!(track_exists(&db, "abc123").unwrap());
    }

    #[test]
    fn ensure_track_idempoten_dan_memperbarui_metadata() {
        let db = Db::open_in_memory().unwrap();
        ensure_track(&db, &sample("abc123", "Judul Lama")).unwrap();
        // Panggil kedua kali dengan judul baru: harus update, bukan error/duplikat.
        ensure_track(&db, &sample("abc123", "Judul Baru")).unwrap();

        assert_eq!(
            track_count(&db).unwrap(),
            1,
            "tidak boleh ada baris duplikat"
        );
        let title: String = db
            .with(|c| {
                Ok(c.query_row(
                    "SELECT title FROM tracks WHERE video_id = 'abc123'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(
            title, "Judul Baru",
            "metadata harus ditimpa dengan yang terbaru"
        );
    }

    #[test]
    fn ensure_tracks_batch_dan_kosong() {
        let db = Db::open_in_memory().unwrap();
        // Daftar kosong harus aman (tidak membuka transaksi sia-sia).
        ensure_tracks(&db, &[]).unwrap();
        assert_eq!(track_count(&db).unwrap(), 0);

        let batch = vec![
            sample("v1", "Satu"),
            sample("v2", "Dua"),
            sample("v3", "Tiga"),
        ];
        ensure_tracks(&db, &batch).unwrap();
        assert_eq!(track_count(&db).unwrap(), 3);
    }

    /// Regresi untuk blocker Fase 1/Fase 4: FK ke `tracks` gagal kalau lagu
    /// belum ditulis. Test ini mengunci urutan yang benar.
    #[test]
    fn foreign_key_gagal_sebelum_track_ditulis() {
        let db = Db::open_in_memory().unwrap();

        let gagal = db.with(|c| {
            c.execute(
                "INSERT INTO favorites (video_id, added_at) VALUES ('belum-ada', 1)",
                [],
            )?;
            Ok(())
        });
        assert!(gagal.is_err(), "FK harus menolak lagu yang belum terdaftar");

        // Setelah ensure_track, insert yang sama harus berhasil.
        ensure_track(&db, &sample("belum-ada", "Lagu")).unwrap();
        db.with(|c| {
            c.execute(
                "INSERT INTO favorites (video_id, added_at) VALUES ('belum-ada', 1)",
                [],
            )?;
            Ok(())
        })
        .expect("setelah ensure_track, FK harus lolos");
    }
}
