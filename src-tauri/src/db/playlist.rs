//! Tabel `playlists` dan `playlist_tracks`.
//!
//! Dua aturan yang menjaga tabel ini sehat:
//!
//! 1. `position` selalu rapat dari 0 tanpa lubang. Hapus di tengah harus
//!    menggeser sisanya, kalau tidak urutan akan berhenti bekerja setelah
//!    beberapa kali hapus.
//! 2. `(playlist_id, position)` adalah primary key, jadi dua lagu tidak boleh
//!    menempati posisi yang sama. Setiap penulisan posisi dilakukan dalam satu
//!    transaksi untuk menghindari tabrakan sementara.

use rusqlite::params;
use serde::Serialize;

use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use crate::models::Track;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub uuid: Option<String>,
    pub name: String,
    pub track_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// Kunci cover 4 lagu pertama, untuk mosaik di sidebar.
    ///
    /// Diambil dalam query yang sama dengan daftar playlist: kalau UI harus
    /// memanggil `playlist_tracks` untuk tiap playlist, membuka aplikasi
    /// dengan 30 playlist berarti 30 query tambahan sebelum sidebar selesai
    /// dirender.
    pub cover_keys: Vec<String>,
    /// Deskripsi bebas (maks 200 karakter di UI). NULL = tidak ada deskripsi.
    pub description: Option<String>,
    /// `auto` (mosaik), `custom` (upload), atau `generative` (placeholder).
    pub cover_mode: String,
    /// Nama file relatif di `<data_dir>/playlist_covers/`, bukan path absolut.
    pub cover_path: Option<String>,
}

pub fn create(db: &crate::db::Db, name: &str) -> AppResult<Playlist> {
    let now = now_ms();
    let pl_uuid = uuid::Uuid::new_v4().to_string();
    let uuid_copy = pl_uuid.clone();
    db.with(|c| {
        c.execute(
            "INSERT INTO playlists (name, created_at, updated_at, uuid) VALUES (?1, ?2, ?2, ?3)",
            params![name, now, pl_uuid],
        )?;
        let id = c.last_insert_rowid();
        Ok(Playlist {
            id,
            uuid: Some(uuid_copy),
            name: name.to_string(),
            track_count: 0,
            created_at: now,
            updated_at: now,
            cover_keys: Vec::new(),
            description: None,
            cover_mode: "auto".to_string(),
            cover_path: None,
        })
    })
}

pub fn rename(db: &crate::db::Db, id: i64, name: &str) -> AppResult<Playlist> {
    let now = now_ms();
    let berubah = db.with(|c| {
        let n = c.execute(
            "UPDATE playlists SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
        Ok(n > 0)
    })?;
    if !berubah {
        return Err(AppError::NotFound(format!("playlist {id} tidak ada")));
    }
    // Dibaca setelah lock dilepas: `get` mengambil lock yang sama, jadi
    // memanggilnya di dalam closure akan deadlock.
    get(db, id)
}

/// Hapus playlist. `playlist_tracks` ikut terhapus lewat `ON DELETE CASCADE`,
/// jadi tidak perlu pembersihan manual yang bisa lupa.
pub fn delete(db: &crate::db::Db, id: i64) -> AppResult<()> {
    db.with(|c| {
        let n = c.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
        if n == 0 {
            return Err(AppError::NotFound(format!("playlist {id} tidak ada")));
        }
        Ok(())
    })
}

/// Perbarui nama, deskripsi, mode cover, dan/atau nama file cover.
///
/// Semua argumen opsional: `None` berarti "jangan ubah". Ini menghindari UI
/// harus mengirim ulang semua field hanya untuk mengganti satu.
///
/// `cover_path` sengaja menerima `Option<Option<String>>` supaya bisa
/// membedakan "jangan sentuh" (`None`) dari "kosongkan" (`Some(None)`).
pub fn update_details(
    db: &crate::db::Db,
    id: i64,
    name: Option<&str>,
    description: Option<Option<&str>>,
    cover_mode: Option<&str>,
    cover_path: Option<Option<&str>>,
) -> AppResult<()> {
    let now = now_ms();
    db.with(|c| {
        let n = c.execute(
            "UPDATE playlists SET
                name        = COALESCE(?1, name),
                description = CASE WHEN ?2 THEN ?3 ELSE description END,
                cover_mode  = COALESCE(?4, cover_mode),
                cover_path  = CASE WHEN ?5 THEN ?6 ELSE cover_path END,
                updated_at  = ?7
             WHERE id = ?8",
            params![
                name,
                description.is_some(),
                description.flatten(),
                cover_mode,
                cover_path.is_some(),
                cover_path.flatten(),
                now,
                id
            ],
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("playlist {id} tidak ada")));
        }
        Ok(())
    })
}

fn cover_keys_for(c: &rusqlite::Connection, playlist_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = c.prepare(
        "SELECT video_id FROM playlist_tracks
         WHERE playlist_id = ?1 AND position < 4
         ORDER BY position",
    )?;
    let rows = stmt.query_map([playlist_id], |r| {
        let vid: String = r.get(0)?;
        Ok(Track::cover_key_for(&vid))
    })?;
    let mut keys = Vec::new();
    for row in rows {
        keys.push(row?);
    }
    Ok(keys)
}

pub fn get(db: &crate::db::Db, id: i64) -> AppResult<Playlist> {
    db.with(|c| {
        let mut pl = {
            let mut stmt = c.prepare(
                "SELECT p.id, p.name, p.created_at, p.updated_at,
                        (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id),
                        p.description, p.cover_mode, p.cover_path, p.uuid
                 FROM playlists p WHERE p.id = ?1",
            )?;
            let mut rows = stmt.query([id])?;
            match rows.next()? {
                Some(r) => Playlist {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    created_at: r.get(2)?,
                    updated_at: r.get(3)?,
                    track_count: r.get(4)?,
                    cover_keys: Vec::new(),
                    description: r.get(5)?,
                    cover_mode: r.get(6)?,
                    cover_path: r.get(7)?,
                    uuid: r.get(8)?,
                },
                None => return Err(AppError::NotFound(format!("playlist {id} tidak ada"))),
            }
        };
        pl.cover_keys = cover_keys_for(c, id)?;
        Ok(pl)
    })
}

pub fn list(db: &crate::db::Db) -> AppResult<Vec<Playlist>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT p.id, p.name, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id),
                    p.description, p.cover_mode, p.cover_path, p.uuid
             FROM playlists p ORDER BY p.updated_at DESC, p.id DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Playlist {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
                track_count: r.get(4)?,
                cover_keys: Vec::new(),
                description: r.get(5)?,
                cover_mode: r.get(6)?,
                cover_path: r.get(7)?,
                uuid: r.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }

        // Lengkapi cover_keys dengan satu query untuk semua playlist sekaligus.
        // Empat lagu pertama per playlist cukup untuk mosaik 2x2.
        if !out.is_empty() {
            let mut cov = c.prepare(
                "SELECT playlist_id, video_id FROM playlist_tracks
                 WHERE position < 4 ORDER BY playlist_id, position",
            )?;
            let mut rows = cov.query([])?;
            while let Some(r) = rows.next()? {
                let pid: i64 = r.get(0)?;
                let vid: String = r.get(1)?;
                if let Some(pl) = out.iter_mut().find(|p| p.id == pid) {
                    pl.cover_keys.push(Track::cover_key_for(&vid));
                }
            }
        }

        Ok(out)
    })
}

/// Tambah lagu di akhir playlist.
///
/// Lagu yang sudah ada di playlist itu dilewati (tidak digandakan) — playlist
/// musik hampir selalu berupa kumpulan unik, dan menggandakan tanpa sadar lebih
/// mengganggu daripada menguntungkan.
pub fn add_track(db: &crate::db::Db, playlist_id: i64, track: &Track) -> AppResult<()> {
    crate::db::ensure_track(db, track)?;
    db.with(|c| {
        // Pastikan playlist ada — kalau tidak, FK akan memberi pesan yang
        // membingungkan.
        let ada: bool = c
            .prepare("SELECT 1 FROM playlists WHERE id = ?1")?
            .exists([playlist_id])?;
        if !ada {
            return Err(AppError::NotFound(format!(
                "playlist {playlist_id} tidak ada"
            )));
        }

        let sudah: bool = c
            .prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND video_id = ?2")?
            .exists(params![playlist_id, track.video_id])?;
        if sudah {
            return Ok(());
        }

        let next: i64 = c.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?1",
            [playlist_id],
            |r| r.get(0),
        )?;
        c.execute(
            "INSERT INTO playlist_tracks (playlist_id, video_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, track.video_id, next, now_ms()],
        )?;
        c.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), playlist_id],
        )?;
        Ok(())
    })
}

/// Hapus lagu dari playlist, lalu rapikan posisi supaya tetap rapat.
pub fn remove_track(db: &crate::db::Db, playlist_id: i64, video_id: &str) -> AppResult<bool> {
    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        let n = tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND video_id = ?2",
            params![playlist_id, video_id],
        )?;
        if n == 0 {
            return Ok(false);
        }
        // Rapatkan posisi. Tanpa ini, setelah beberapa kali hapus akan ada
        // lubang dan urutan tidak lagi bisa diandalkan.
        tx.execute(
            "UPDATE playlist_tracks
             SET position = (
               SELECT COUNT(*) FROM playlist_tracks p2
               WHERE p2.playlist_id = playlist_tracks.playlist_id
                 AND p2.position < playlist_tracks.position
             )
             WHERE playlist_id = ?1",
            [playlist_id],
        )?;
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now_ms(), playlist_id],
        )?;
        tx.commit()?;
        Ok(true)
    })
}

pub fn tracks(db: &crate::db::Db, playlist_id: i64) -> AppResult<Vec<Track>> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT t.video_id, t.title, t.artist, t.album, t.duration_ms
             FROM playlist_tracks pt
             JOIN tracks t ON t.video_id = pt.video_id
             WHERE pt.playlist_id = ?1
             ORDER BY pt.position",
        )?;
        let rows = stmt.query_map([playlist_id], |r| {
            let video_id: String = r.get(0)?;
            Ok(Track {
                cover_key: Track::cover_key_for(&video_id),
                video_id,
                title: r.get(1)?,
                artist: r.get(2)?,
                album: r.get(3)?,
                duration_ms: r.get::<_, Option<i64>>(4)?.map(|d| d as u64),
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
}

/// Hasil menambahkan sekumpulan lagu ke playlist dalam satu transaksi.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HasilImpor {
    pub playlist_id: i64,
    pub ditambahkan: usize,
    /// Sudah ada di playlist tujuan (atau dobel di daftar sumber).
    pub dobel: usize,
}

/// Tambahkan banyak lagu ke playlist sekaligus, transaksional.
///
/// Dipakai impor dari tautan playlist YouTube, di mana satu playlist bisa
/// berisi ratusan lagu. Menulis satu per satu lewat `add_track` berarti ratusan
/// transaksi terpisah; kalau aplikasi ditutup di tengah jalan, playlist berisi
/// separuh data tanpa penjelasan. Di sini seluruh penulisan (playlist baru,
/// baris `playlist_tracks`, `updated_at`) berada dalam satu transaksi: berhasil
/// semua, atau tidak sama sekali.
///
/// `ensure_tracks` sengaja dipanggil SEBELUM lock diambil. Fungsi itu membuka
/// lock-nya sendiri, dan memanggilnya di dalam `db.with` akan membuat lock
/// bersarang — jalan buntu yang sudah pernah terjadi di proyek ini.
///
/// `playlist_id` kosong berarti playlist baru dibuat dari `nama`.
pub fn impor_lagu(
    db: &crate::db::Db,
    playlist_id: Option<i64>,
    nama: &str,
    lagu: &[Track],
) -> AppResult<HasilImpor> {
    if lagu.is_empty() {
        return Err(AppError::invalid("tidak ada lagu untuk disimpan"));
    }
    crate::db::ensure_tracks(db, lagu)?;

    let nama: String = nama.trim().chars().take(80).collect();
    let nama = if nama.is_empty() {
        "Hasil impor".to_string()
    } else {
        nama
    };

    db.with(|c| {
        let tx = c.unchecked_transaction()?;
        let now = now_ms();

        let pid = match playlist_id {
            Some(id) => {
                let ada: bool = tx
                    .prepare("SELECT 1 FROM playlists WHERE id = ?1")?
                    .exists([id])?;
                if !ada {
                    return Err(AppError::NotFound(format!("playlist {id} tidak ada")));
                }
                id
            }
            None => {
                let pl_uuid = uuid::Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO playlists (name, created_at, updated_at, uuid) VALUES (?1, ?2, ?2, ?3)",
                    params![nama, now, pl_uuid],
                )?;
                tx.last_insert_rowid()
            }
        };

        let mut posisi: i64 = tx.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?1",
            [pid],
            |r| r.get(0),
        )?;

        let mut ditambahkan = 0usize;
        let mut dobel = 0usize;
        {
            let mut sudah = tx.prepare(
                "SELECT 1 FROM playlist_tracks WHERE playlist_id = ?1 AND video_id = ?2",
            )?;
            let mut sisip = tx.prepare(
                "INSERT INTO playlist_tracks (playlist_id, video_id, position, added_at)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for t in lagu {
                if sudah.exists(params![pid, t.video_id])? {
                    dobel += 1;
                    continue;
                }
                sisip.execute(params![pid, t.video_id, posisi, now])?;
                posisi += 1;
                ditambahkan += 1;
            }
        }

        // Hanya sentuh `updated_at` kalau memang ada yang berubah; playlist
        // yang seluruh isinya dobel tidak perlu naik ke atas daftar terbaru.
        if ditambahkan > 0 {
            tx.execute(
                "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
                params![now, pid],
            )?;
        }

        tx.commit()?;
        Ok(HasilImpor {
            playlist_id: pid,
            ditambahkan,
            dobel,
        })
    })
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
            duration_ms: Some(200_000),
            cover_key: Track::cover_key_for(id),
        }
    }

    #[test]
    fn buat_daftar_ganti_nama_hapus() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Malam").unwrap();
        assert_eq!(p.name, "Malam");
        assert_eq!(p.track_count, 0);

        let p2 = rename(&db, p.id, "Malam Panjang").unwrap();
        assert_eq!(p2.name, "Malam Panjang");

        assert_eq!(list(&db).unwrap().len(), 1);
        delete(&db, p.id).unwrap();
        assert!(list(&db).unwrap().is_empty());
    }

    #[test]
    fn playlist_tidak_ada_menghasilkan_not_found() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(get(&db, 999), Err(AppError::NotFound(_))));
        assert!(matches!(delete(&db, 999), Err(AppError::NotFound(_))));
        assert!(matches!(rename(&db, 999, "x"), Err(AppError::NotFound(_))));
        assert!(matches!(
            add_track(&db, 999, &track("a", "A")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn tambah_lagu_berurutan_dan_tidak_ganda() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Urut").unwrap();
        add_track(&db, p.id, &track("a", "A")).unwrap();
        add_track(&db, p.id, &track("b", "B")).unwrap();
        add_track(&db, p.id, &track("a", "A")).unwrap(); // duplikat: dilewati

        let list = tracks(&db, p.id).unwrap();
        assert_eq!(
            list.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(get(&db, p.id).unwrap().track_count, 2);
    }

    /// Regresi paling penting di modul ini: setelah hapus di tengah, posisi
    /// harus tetap rapat. Kalau tidak, `(playlist_id, position)` bisa bentrok
    /// dan penambahan lagu berikutnya gagal.
    #[test]
    fn hapus_di_tengah_merapatkan_posisi() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Rapat").unwrap();
        for id in ["a", "b", "c", "d"] {
            add_track(&db, p.id, &track(id, id)).unwrap();
        }

        assert!(remove_track(&db, p.id, "b").unwrap());
        assert!(!remove_track(&db, p.id, "b").unwrap(), "hapus dua kali");

        let sisa = tracks(&db, p.id).unwrap();
        assert_eq!(
            sisa.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["a", "c", "d"]
        );

        let posisi: Vec<i64> = db
            .with(|c| {
                let mut stmt = c.prepare(
                    "SELECT position FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
                )?;
                let rows = stmt.query_map([p.id], |r| r.get(0))?;
                let mut v = Vec::new();
                for r in rows {
                    v.push(r?);
                }
                Ok(v)
            })
            .unwrap();
        assert_eq!(posisi, vec![0, 1, 2], "posisi harus rapat tanpa lubang");

        // Dan penambahan berikutnya harus tetap berhasil.
        add_track(&db, p.id, &track("e", "E")).unwrap();
        assert_eq!(tracks(&db, p.id).unwrap().len(), 4);
    }

    #[test]
    fn hapus_playlist_ikut_menghapus_isinya() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Sementara").unwrap();
        add_track(&db, p.id, &track("a", "A")).unwrap();
        delete(&db, p.id).unwrap();

        let sisa: i64 = db
            .with(|c| Ok(c.query_row("SELECT COUNT(*) FROM playlist_tracks", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(sisa, 0, "ON DELETE CASCADE harus membersihkan isi playlist");
    }

    #[test]
    fn cover_keys_maksimal_empat_dan_ikut_bergeser() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Mosaik").unwrap();
        assert!(p.cover_keys.is_empty());

        for id in ["a", "b", "c", "d", "e"] {
            add_track(&db, p.id, &track(id, id)).unwrap();
        }

        let expected = vec!["v:a", "v:b", "v:c", "v:d"];
        assert_eq!(get(&db, p.id).unwrap().cover_keys, expected);
        assert_eq!(list(&db).unwrap()[0].cover_keys, expected);

        // Hapus lagu pertama: posisi merapat dan lagu ke-5 masuk ke slot ke-4.
        assert!(remove_track(&db, p.id, "a").unwrap());
        let shifted = vec!["v:b", "v:c", "v:d", "v:e"];
        assert_eq!(get(&db, p.id).unwrap().cover_keys, shifted);
        assert_eq!(list(&db).unwrap()[0].cover_keys, shifted);
    }

    #[test]
    fn impor_lagu_membuat_playlist_dan_menghitung_dobel() {
        let db = Db::open_in_memory().unwrap();
        let lagu = vec![track("a", "A"), track("b", "B"), track("a", "A")];

        let hasil = impor_lagu(&db, None, "  Dari tautan  ", &lagu).unwrap();
        assert_eq!(hasil.ditambahkan, 2, "yang dobel di daftar sumber dihitung");
        assert_eq!(hasil.dobel, 1);

        let p = get(&db, hasil.playlist_id).unwrap();
        assert_eq!(p.name, "Dari tautan", "nama dirapikan dan dipotong");
        assert_eq!(p.track_count, 2);

        let isi = tracks(&db, hasil.playlist_id).unwrap();
        assert_eq!(
            isi.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }

    #[test]
    fn impor_lagu_menambah_setelah_lagu_lama_tanpa_menggandakan() {
        let db = Db::open_in_memory().unwrap();
        let p = create(&db, "Tujuan").unwrap();
        add_track(&db, p.id, &track("lama", "Lama")).unwrap();

        let hasil = impor_lagu(
            &db,
            Some(p.id),
            "diabaikan",
            &[track("lama", "Lama"), track("baru", "Baru")],
        )
        .unwrap();
        assert_eq!(hasil.playlist_id, p.id);
        assert_eq!(hasil.ditambahkan, 1);
        assert_eq!(hasil.dobel, 1);

        let isi = tracks(&db, p.id).unwrap();
        assert_eq!(
            isi.iter().map(|t| t.video_id.as_str()).collect::<Vec<_>>(),
            vec!["lama", "baru"]
        );
    }

    #[test]
    fn impor_lagu_menolak_playlist_tujuan_yang_tidak_ada() {
        let db = Db::open_in_memory().unwrap();
        let hasil = impor_lagu(&db, Some(999), "x", &[track("a", "A")]);
        assert!(matches!(hasil, Err(AppError::NotFound(_))));
        assert!(
            list(&db).unwrap().is_empty(),
            "tidak boleh ada playlist yatim"
        );
    }

    #[test]
    fn impor_lagu_menolak_daftar_kosong() {
        let db = Db::open_in_memory().unwrap();
        assert!(matches!(
            impor_lagu(&db, None, "x", &[]),
            Err(AppError::Invalid(_))
        ));
    }
}
