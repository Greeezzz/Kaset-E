use crate::db::{now_ms, Db};
use crate::error::AppResult;

/// Satu baris riwayat pencarian.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchHistoryItem {
    pub query: String,
    pub hits: i64,
    pub last_used_at: i64,
}

/// Bentuk normalisasi untuk kunci unik: huruf kecil + spasi dirapatkan.
///
/// Tanpa ini "Radiohead", "radiohead", dan "radiohead  " akan tersimpan sebagai
/// tiga baris berbeda dan memenuhi daftar saran dengan hal yang sama.
pub fn normalisasi(query: &str) -> String {
    query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Simpan satu pencarian. Query yang sudah ada hanya diperbarui waktunya dan
/// dihitung sebagai satu pemakaian lagi — bukan duplikat.
pub fn catat(db: &Db, query: &str) -> AppResult<()> {
    let norm = normalisasi(query);
    if norm.is_empty() {
        return Ok(());
    }
    // Jangan simpan query yang tidak masuk akal panjangnya; ini juga mencegah
    // tabel dipenuhi string aneh dari input yang salah.
    if norm.chars().count() > 256 {
        return Ok(());
    }

    db.with(|c| {
        c.execute(
            "INSERT INTO search_history (query_norm, query, hits, last_used_at)
             VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(query_norm) DO UPDATE SET
               query = excluded.query,
               hits = hits + 1,
               last_used_at = excluded.last_used_at",
            rusqlite::params![norm, query.trim(), now_ms()],
        )?;
        Ok(())
    })
}

/// Ambil riwayat terbaru.
pub fn daftar(db: &Db, limit: i64) -> AppResult<Vec<SearchHistoryItem>> {
    let limit = limit.clamp(1, 200);
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT query, hits, last_used_at FROM search_history
             ORDER BY last_used_at DESC LIMIT ?1",
        )?;
        let mut rows = stmt.query([limit])?;
        let mut out = Vec::new();
        while let Some(r) = rows.next()? {
            out.push(SearchHistoryItem {
                query: r.get(0)?,
                hits: r.get(1)?,
                last_used_at: r.get(2)?,
            });
        }
        Ok(out)
    })
}

/// Hapus satu entri berdasarkan teks aslinya (dinormalisasi dulu).
pub fn hapus(db: &Db, query: &str) -> AppResult<bool> {
    let norm = normalisasi(query);
    let n = db.with(|c| {
        Ok(c.execute("DELETE FROM search_history WHERE query_norm = ?1", [&norm])?)
    })?;
    Ok(n > 0)
}

/// Kosongkan seluruh riwayat. Mengembalikan jumlah baris yang terhapus.
pub fn kosongkan(db: &Db) -> AppResult<i64> {
    db.with(|c| Ok(c.execute("DELETE FROM search_history", [])? as i64))
}

/// Buang entri terlama supaya tabel tidak tumbuh selamanya.
///
/// UI hanya menampilkan ~10 baris; menyimpan 200 sudah berlebihan. Dipanggil
/// setelah insert, bukan saat baca, supaya biayanya jatuh pada operasi yang
/// jarang (user menekan Cari) bukan pada render.
pub fn pangkas(db: &Db, simpan: i64) -> AppResult<i64> {
    let simpan = simpan.max(1);
    db.with(|c| {
        Ok(c.execute(
            "DELETE FROM search_history WHERE query_norm NOT IN (
               SELECT query_norm FROM search_history
               ORDER BY last_used_at DESC LIMIT ?1
             )",
            [simpan],
        )? as i64)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn db() -> Db {
        Db::open_in_memory().expect("db")
    }

    #[test]
    fn normalisasi_merapikan_kapital_dan_spasi() {
        assert_eq!(normalisasi("Radiohead"), "radiohead");
        assert_eq!(normalisasi("  radio   head  "), "radio head");
        assert_eq!(normalisasi("\tDaft\nPunk "), "daft punk");
        assert_eq!(normalisasi("   "), "");
    }

    #[test]
    fn query_sama_dinormalisasi_tidak_menggandakan_baris() {
        let d = db();
        catat(&d, "Radiohead").expect("catat");
        catat(&d, "radiohead").expect("catat");
        catat(&d, "  RADIOHEAD  ").expect("catat");

        let items = daftar(&d, 10).expect("daftar");
        assert_eq!(items.len(), 1, "harus satu baris, dapat: {items:?}");
        assert_eq!(items[0].hits, 3, "tiga kali dicari");
    }

    #[test]
    fn yang_terbaru_muncul_duluan() {
        let d = db();
        catat(&d, "pertama").expect("catat");
        // now_ms() bisa sama dalam satu milidetik; beri jeda eksplisit.
        d.with(|c| {
            c.execute(
                "UPDATE search_history SET last_used_at = 1000 WHERE query_norm = 'pertama'",
                [],
            )?;
            Ok(())
        })
        .expect("set waktu");
        catat(&d, "kedua").expect("catat");
        d.with(|c| {
            c.execute(
                "UPDATE search_history SET last_used_at = 2000 WHERE query_norm = 'kedua'",
                [],
            )?;
            Ok(())
        })
        .expect("set waktu");

        let items = daftar(&d, 10).expect("daftar");
        assert_eq!(items[0].query, "kedua");
        assert_eq!(items[1].query, "pertama");
    }

    #[test]
    fn query_kosong_tidak_disimpan() {
        let d = db();
        catat(&d, "   ").expect("catat");
        assert!(daftar(&d, 10).expect("daftar").is_empty());
    }

    #[test]
    fn hapus_dan_kosongkan() {
        let d = db();
        catat(&d, "satu").expect("catat");
        catat(&d, "dua").expect("catat");

        assert!(!hapus(&d, "tidak-ada").expect("hapus"), "tidak ada = false");
        assert!(hapus(&d, "SATU").expect("hapus"), "normalisasi saat hapus");
        assert_eq!(daftar(&d, 10).expect("daftar").len(), 1);

        assert_eq!(kosongkan(&d).expect("kosongkan"), 1);
        assert!(daftar(&d, 10).expect("daftar").is_empty());
    }

    #[test]
    fn pangkas_menyisakan_yang_terbaru() {
        let d = db();
        for i in 0..8 {
            catat(&d, &format!("q{i}")).expect("catat");
            d.with(|c| {
                c.execute(
                    "UPDATE search_history SET last_used_at = ?1 WHERE query_norm = ?2",
                    rusqlite::params![1000 + i, format!("q{i}")],
                )?;
                Ok(())
            })
            .expect("set waktu");
        }

        let dibuang = pangkas(&d, 3).expect("pangkas");
        assert_eq!(dibuang, 5, "8 - 3 = 5");

        let items = daftar(&d, 10).expect("daftar");
        assert_eq!(items.len(), 3);
        // Yang bertahan harus yang paling baru: q7, q6, q5.
        assert_eq!(items[0].query, "q7");
        assert_eq!(items[2].query, "q5");
    }
}
