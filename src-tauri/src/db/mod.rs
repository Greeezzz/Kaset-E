pub mod library;
pub(crate) mod migrations;
pub mod playlist;
pub mod queue;
pub mod search_history;
pub mod tracks;

use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::Path;

use crate::error::{AppError, AppResult};

pub use tracks::{ensure_track, ensure_tracks, track_count, track_exists};

/// Pembungkus koneksi SQLite. Satu koneksi di belakang Mutex cukup untuk beban
/// aplikasi desktop; operasi DB tidak pernah menahan lock saat menunggu jaringan.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Buka (atau buat) database di path yang diberikan, lalu terapkan migrasi.
    pub fn open<P: AsRef<Path>>(path: P) -> AppResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::prepare(conn)
    }

    /// Database in-memory — dipakai unit test.
    pub fn open_in_memory() -> AppResult<Self> {
        Self::prepare(Connection::open_in_memory()?)
    }

    fn prepare(conn: Connection) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        migrations::run(&db)?;
        Ok(db)
    }

    /// Jalankan closure dengan koneksi terkunci.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let conn = self.conn.lock();
        f(&conn)
    }

    /// Versi skema tertinggi yang sudah diterapkan.
    pub fn schema_version(&self) -> AppResult<Option<String>> {
        self.with(|c| {
            let mut stmt =
                c.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")?;
            let mut rows = stmt.query([])?;
            Ok(rows.next()?.map(|r| r.get::<_, String>(0)).transpose()?)
        })
    }
}

/// Timestamp unix ms sekarang.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Helper: baca satu nilai settings.
pub fn get_setting(db: &Db, key: &str) -> AppResult<Option<String>> {
    db.with(|c| {
        let mut stmt = c.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query([key])?;
        Ok(rows.next()?.map(|r| r.get::<_, String>(0)).transpose()?)
    })
}

/// Helper: tulis satu nilai settings.
pub fn set_setting(db: &Db, key: &str, value: &str) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [key, value],
        )?;
        Ok(())
    })
}

/// Jumlah tabel aplikasi — dipakai test smoke migrasi.
pub fn table_names(db: &Db) -> AppResult<Vec<String>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Validasi nama tabel sederhana (menghindari SQL dinamis mentah).
pub fn require_table(db: &Db, name: &str) -> AppResult<()> {
    if table_names(db)?.iter().any(|t| t == name) {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("tabel {name} tidak ada")))
    }
}
