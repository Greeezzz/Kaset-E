//! Akses basis data SQLite untuk lirik (FEATURES-V3 §4 L1).

use serde::{Deserialize, Serialize};

use crate::db::{now_ms, Db};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackLyrics {
    pub video_id: String,
    pub lrc: String,
    pub sumber: String,
    pub offset_ms: i64,
    pub diambil_pada: i64,
}

/// Mengambil lirik untuk video_id tertentu.
pub fn get_lyrics(db: &Db, video_id: &str) -> AppResult<Option<TrackLyrics>> {
    db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT video_id, lrc, sumber, offset_ms, diambil_pada
             FROM lyrics
             WHERE video_id = ?1",
        )?;

        let mut rows = stmt.query([video_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(TrackLyrics {
                video_id: row.get(0)?,
                lrc: row.get(1)?,
                sumber: row.get(2)?,
                offset_ms: row.get(3)?,
                diambil_pada: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    })
}

/// Menyimpan atau memperbarui lirik dari string teks/LRC.
pub fn set_lyrics_text(
    db: &Db,
    video_id: &str,
    lrc_text: &str,
    sumber: &str,
    offset_ms: Option<i64>,
) -> AppResult<()> {
    let now = now_ms();
    let offset = offset_ms.unwrap_or(0);

    db.with(|conn| {
        conn.execute(
            "INSERT INTO lyrics (video_id, lrc, sumber, offset_ms, diambil_pada)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(video_id) DO UPDATE SET
                lrc = excluded.lrc,
                sumber = excluded.sumber,
                offset_ms = excluded.offset_ms,
                diambil_pada = excluded.diambil_pada",
            rusqlite::params![video_id, lrc_text, sumber, offset, now],
        )?;
        Ok(())
    })
}

/// Mengubah offset_ms lirik tertentu.
pub fn set_lyrics_offset(db: &Db, video_id: &str, offset_ms: i64) -> AppResult<bool> {
    db.with(|conn| {
        let affected = conn.execute(
            "UPDATE lyrics SET offset_ms = ?1 WHERE video_id = ?2",
            rusqlite::params![offset_ms, video_id],
        )?;
        Ok(affected > 0)
    })
}

/// Menghapus lirik untuk video_id tertentu.
pub fn delete_lyrics(db: &Db, video_id: &str) -> AppResult<bool> {
    db.with(|conn| {
        let affected = conn.execute("DELETE FROM lyrics WHERE video_id = ?1", [video_id])?;
        Ok(affected > 0)
    })
}
