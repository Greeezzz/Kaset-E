use crate::error::AppResult;

use super::{now_ms, Db};

/// Migrasi ditulis sebagai SQL inline dan dikirim berurutan. Migrasi yang sudah
/// dirilis tidak boleh diedit — tambahkan entri baru di akhir daftar.
struct Migration {
    version: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: "0001",
        sql: include_str!("../../migrations/0001_init.sql"),
    },
    Migration {
        version: "0002",
        sql: include_str!("../../migrations/0002_covers.sql"),
    },
    Migration {
        version: "0003",
        sql: include_str!("../../migrations/0003_search_history.sql"),
    },
    Migration {
        version: "0004",
        sql: include_str!("../../migrations/0004_playlist_details.sql"),
    },
    Migration {
        version: "0005",
        sql: include_str!("../../migrations/0005_listen_events.sql"),
    },
    Migration {
        version: "0006",
        sql: include_str!("../../migrations/0006_queue_prioritas.sql"),
    },
    Migration {
        version: "0007",
        sql: include_str!("../../migrations/0007_queue_sudah_diputar.sql"),
    },
];

pub fn run(db: &Db) -> AppResult<()> {
    db.with(|c| {
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version    TEXT PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );",
        )?;
        Ok(())
    })?;

    for m in MIGRATIONS {
        let applied: bool = db.with(|c| {
            let mut stmt = c.prepare("SELECT 1 FROM schema_migrations WHERE version = ?1")?;
            Ok(stmt.exists([m.version])?)
        })?;
        if applied {
            continue;
        }

        db.with(|c| {
            // Satu transaksi per migrasi: gagal di tengah tidak meninggalkan skema separuh jadi.
            let tx = c.unchecked_transaction()?;
            tx.execute_batch(m.sql)?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![m.version, now_ms()],
            )?;
            tx.commit()?;
            Ok(())
        })?;

        tracing::info!(version = m.version, "migrasi diterapkan");
    }

    Ok(())
}

#[cfg(test)]
pub fn versions() -> Vec<&'static str> {
    MIGRATIONS.iter().map(|m| m.version).collect()
}
