//! Persistensi antrean ke SQLite.
//!
//! Tabel `queue_items` menyimpan urutan **asli** (`items`), bukan urutan
//! pemutaran. Saat memulihkan, `QueueManager::restore` yang membangun ulang
//! urutan shuffle. Menyimpan urutan shuffle ke database akan salah: shuffle
//! harus bisa dibatalkan ke urutan asli.
//!
//! Cursor dan mode shuffle/repeat disimpan di tabel `settings` karena keduanya
//! nilai tunggal, bukan bagian dari daftar.

use rusqlite::params;

use crate::db::{get_setting, set_setting, Db};
use crate::error::AppResult;
use crate::models::{QueueItem, RepeatMode, Track};
use crate::queue::QueueManager;

const KEY_CURSOR: &str = "queue.cursor";
const KEY_SHUFFLE: &str = "queue.shuffle";
const KEY_REPEAT: &str = "queue.repeat";

/// Simpan seluruh antrean. Selalu menimpa isi lama dalam satu transaksi supaya
/// tidak ada keadaan setengah tersimpan kalau aplikasi mati di tengah.
pub fn save(db: &Db, queue: &QueueManager) -> AppResult<()> {
    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        tx.execute("DELETE FROM queue_items", [])?;
        {
            // Simpan dalam urutan ASLI, dengan `original_order` sebagai penanda
            // urutan yang stabil.
            let mut stmt = tx.prepare(
                "INSERT INTO queue_items
                    (position, video_id, original_order, prioritas, prioritas_urut, sudah_diputar)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?;
            let mut sorted: Vec<&QueueItem> = queue.items().iter().collect();
            sorted.sort_by_key(|i| i.original_order);
            for (idx, it) in sorted.iter().enumerate() {
                stmt.execute(params![
                    idx as i64,
                    it.track.video_id,
                    it.original_order,
                    i64::from(it.prioritas),
                    it.prioritas_urut,
                    i64::from(it.sudah_diputar),
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;

    // Simpan indeks ITEMS, bukan posisi di `order`. Posisi order berubah saat
    // shuffle dinyalakan ulang, jadi memakainya membuat lagu aktif salah setelah
    // aplikasi dibuka lagi.
    set_setting(db, KEY_CURSOR, &queue.active_item_index().to_string())?;
    set_setting(
        db,
        KEY_SHUFFLE,
        if queue.shuffle_enabled() { "1" } else { "0" },
    )?;
    set_setting(db, KEY_REPEAT, repeat_to_str(queue.repeat()))?;
    Ok(())
}

/// Muat antrean. Mengembalikan `None` kalau tidak ada yang tersimpan.
///
/// Track di-join dengan `tracks` supaya metadata yang ditampilkan tetap benar
/// walau lagu itu belum pernah muncul di sesi ini.
pub fn load(db: &Db) -> AppResult<Option<QueueManager>> {
    let items: Vec<QueueItem> = db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT q.position, q.original_order,
                    t.video_id, t.title, t.artist, t.album, t.duration_ms,
                    q.prioritas, q.prioritas_urut, q.sudah_diputar
             FROM queue_items q
             JOIN tracks t ON t.video_id = q.video_id
             ORDER BY q.original_order",
        )?;
        let rows = stmt.query_map([], |r| {
            let video_id: String = r.get(2)?;
            Ok(QueueItem {
                position: r.get(0)?,
                original_order: r.get(1)?,
                prioritas: r.get::<_, i64>(7)? != 0,
                prioritas_urut: r.get(8)?,
                // Antrean lama (sebelum migrasi 0007) otomatis 0 = belum diputar.
                sudah_diputar: r.get::<_, i64>(9)? != 0,
                track: Track {
                    cover_key: Track::cover_key_for(&video_id),
                    video_id,
                    title: r.get(3)?,
                    artist: r.get(4)?,
                    album: r.get(5)?,
                    duration_ms: r.get::<_, Option<i64>>(6)?.map(|d| d as u64),
                },
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })?;

    if items.is_empty() {
        return Ok(None);
    }

    let cursor: usize = get_setting(db, KEY_CURSOR)?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let shuffle = get_setting(db, KEY_SHUFFLE)?.as_deref() == Some("1");
    let repeat = get_setting(db, KEY_REPEAT)?
        .as_deref()
        .map(str_to_repeat)
        .unwrap_or(RepeatMode::Off);

    Ok(Some(QueueManager::restore(items, cursor, shuffle, repeat)))
}

/// Hapus antrean tersimpan.
pub fn clear(db: &Db) -> AppResult<()> {
    db.with(|c| {
        c.execute("DELETE FROM queue_items", [])?;
        Ok(())
    })?;
    set_setting(db, KEY_CURSOR, "0")?;
    Ok(())
}

fn repeat_to_str(mode: RepeatMode) -> &'static str {
    match mode {
        RepeatMode::Off => "off",
        RepeatMode::One => "one",
        RepeatMode::All => "all",
    }
}

fn str_to_repeat(s: &str) -> RepeatMode {
    match s {
        "one" => RepeatMode::One,
        "all" => RepeatMode::All,
        _ => RepeatMode::Off,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ensure_track, Db};

    fn track(id: &str) -> Track {
        Track {
            video_id: id.to_string(),
            title: format!("Lagu {id}"),
            artist: "Artis".into(),
            album: Some("Album".into()),
            duration_ms: Some(180_000),
            cover_key: Track::cover_key_for(id),
        }
    }

    /// FK `queue_items.video_id` -> `tracks` mengharuskan lagu ditulis dulu.
    fn seeded() -> Db {
        let db = Db::open_in_memory().unwrap();
        for id in ["a", "b", "c", "d"] {
            ensure_track(&db, &track(id)).unwrap();
        }
        db
    }

    #[test]
    fn simpan_dan_muat_antrean() {
        let db = seeded();
        let mut q = QueueManager::new(1);
        for id in ["a", "b", "c"] {
            q.add(track(id));
        }
        q.advance(); // aktif = b
        save(&db, &q).unwrap();

        let loaded = load(&db).unwrap().expect("harus ada antrean tersimpan");
        let ids: Vec<String> = loaded
            .play_order()
            .iter()
            .map(|i| i.track.video_id.clone())
            .collect();
        assert_eq!(ids, vec!["a", "b", "c"]);
        assert_eq!(loaded.current().unwrap().track.video_id, "b");
    }

    #[test]
    fn mode_shuffle_dan_repeat_ikut_tersimpan() {
        let db = seeded();
        let mut q = QueueManager::new(5);
        for id in ["a", "b", "c", "d"] {
            q.add(track(id));
        }
        q.set_shuffle(true);
        q.set_repeat(RepeatMode::All);
        save(&db, &q).unwrap();

        let loaded = load(&db).unwrap().unwrap();
        assert!(loaded.shuffle_enabled(), "shuffle harus ikut tersimpan");
        assert_eq!(
            loaded.repeat(),
            RepeatMode::All,
            "repeat harus ikut tersimpan"
        );
        assert_eq!(loaded.len(), 4, "shuffle tidak boleh kehilangan lagu");
    }

    #[test]
    fn simpan_diulang_menimpa_bukan_menumpuk() {
        let db = seeded();
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        q.add(track("b"));
        save(&db, &q).unwrap();
        q.add(track("c"));
        save(&db, &q).unwrap();

        let n: i64 = db
            .with(|c| Ok(c.query_row("SELECT COUNT(*) FROM queue_items", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(n, 3, "menyimpan ulang harus menimpa, bukan menumpuk");
    }

    #[test]
    fn muat_tanpa_data_mengembalikan_none() {
        let db = seeded();
        assert!(load(&db).unwrap().is_none());
    }

    #[test]
    fn clear_menghapus_antrean_tersimpan() {
        let db = seeded();
        let mut q = QueueManager::new(1);
        q.add(track("a"));
        save(&db, &q).unwrap();
        clear(&db).unwrap();
        assert!(load(&db).unwrap().is_none());
    }

    /// Regresi "antrean prioritas hantu" pada lapisan persistensi.
    ///
    /// Skenario nyata: isi antrean, tambah dua lagu prioritas, putar keduanya
    /// sampai lewat, tutup aplikasi. Setelah `save` → `load`, lagu yang sudah
    /// diputar tidak boleh muncul lagi sebagai "berikutnya". Diuji untuk shuffle
    /// mati dan nyala karena keduanya membangun ulang `order` dengan cara
    /// berbeda.
    #[test]
    fn muat_antrean_tidak_menghidupkan_lagu_prioritas_yang_sudah_diputar() {
        let db = seeded();
        for id in ["pl0", "pl1", "pl2", "pilihA", "pilihB"] {
            ensure_track(&db, &track(id)).unwrap();
        }

        for shuffle in [false, true] {
            let mut q = QueueManager::new(7);
            q.replace(vec![track("pl0"), track("pl1"), track("pl2")], 0);
            q.set_shuffle(shuffle);
            q.add(track("pilihA"));
            q.add(track("pilihB"));

            // Putar kedua lagu prioritas sampai lewat, tanpa mengasumsikan
            // posisinya: posisi bergantung pada shuffle.
            let pos = q
                .play_order()
                .iter()
                .position(|i| i.track.video_id == "pilihA")
                .expect("pilihA harus ada di antrean");
            assert!(q.jump_to(pos));
            assert_eq!(q.advance().unwrap().track.video_id, "pilihB");

            save(&db, &q).unwrap();
            let loaded = load(&db).unwrap().expect("antrean harus tersimpan");

            assert_eq!(
                loaded.current().unwrap().track.video_id,
                "pilihB",
                "lagu aktif harus tetap sama (shuffle={shuffle})"
            );
            let sisa: Vec<String> = loaded
                .play_order()
                .iter()
                .skip(loaded.cursor() + 1)
                .map(|i| i.track.video_id.clone())
                .collect();
            assert!(
                !sisa.contains(&"pilihA".to_string()),
                "lagu prioritas yang sudah diputar muncul lagi di BERIKUTNYA (shuffle={shuffle}): {sisa:?}"
            );
            assert_eq!(loaded.len(), 5, "tidak boleh ada lagu yang hilang");
        }
    }

    #[test]
    fn urutan_asli_dipulihkan_walau_shuffle_aktif() {
        let db = seeded();
        let mut q = QueueManager::new(3);
        q.add(track("a"));
        q.add(track("b"));
        q.add(track("c"));
        let asli: Vec<String> = q.items().iter().map(|i| i.track.video_id.clone()).collect();
        q.set_shuffle(true);
        save(&db, &q).unwrap();

        let loaded = load(&db).unwrap().unwrap();
        // Mematikan shuffle setelah dimuat harus mengembalikan urutan asli,
        // membuktikan yang disimpan memang urutan asli.
        let mut loaded = loaded;
        loaded.set_shuffle(false);
        let setelah: Vec<String> = loaded
            .play_order()
            .iter()
            .map(|i| i.track.video_id.clone())
            .collect();
        assert_eq!(setelah, asli);
    }
}
