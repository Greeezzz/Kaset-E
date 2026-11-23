//! Statistik mendengar untuk layar Stats (Fase 4b).
//!
//! Semua perhitungan dikerjakan SQLite, bukan di Rust, karena datanya bisa
//! puluhan ribu baris dan yang dibutuhkan cuma agregat.
//!
//! ## Dua hal yang mudah salah di sini
//!
//! **1. Satu baris `listen_events` BUKAN satu kali putar.** Pencatat menulis
//! potongan tiap ~5 detik, jadi satu lagu 3 menit menghasilkan ~36 baris.
//! `COUNT(*)` akan melaporkan "36 kali putar" untuk satu lagu. Karena itu
//! potongan digabung dulu menjadi SESI: potongan berurutan untuk lagu yang sama
//! dianggap satu sesi selama jedanya kurang dari [`JEDA_SESI_MS`]. Baru sesi
//! yang dihitung sebagai putaran.
//!
//! **2. Waktu lokal bukan UTC.** `started_at` disimpan epoch ms UTC, tetapi
//! "mendengar jam 21:00" dan "streak harian" hanya bermakna dalam zona waktu
//! pengguna. Offset zona dikirim pemanggil (`tz_offset_min`, menit ke timur
//! UTC — WIB = 420) dan ditambahkan sebelum dipecah jadi hari/jam. Tanpa ini,
//! pengguna WIB akan melihat lagu tengah malamnya tercatat di hari sebelumnya.

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Jeda maksimum antar potongan agar masih dianggap satu sesi mendengar.
///
/// Pencatat menulis tiap 5 detik. Jeda 30 detik memberi ruang untuk pause
/// sebentar, seek, atau frame yang lambat tanpa memecah sesi — tapi cukup
/// ketat supaya memutar lagu yang sama besoknya dihitung sebagai sesi baru.
const JEDA_SESI_MS: i64 = 30_000;

/// Ambang minimum agar sesi dihitung sebagai satu "putaran".
///
/// Sama dengan definisi di `FEATURES-V2.md` §1.3: 30 detik, atau separuh
/// durasi lagu kalau lagunya lebih pendek dari 60 detik.
const AMBANG_PUTAR_MS: i64 = 30_000;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rentang {
    Hari,
    Minggu,
    Bulan,
    Tahun,
    Semua,
}

impl Rentang {
    /// Awal rentang dalam epoch ms, atau `None` untuk "semua".
    ///
    /// Dihitung mundur dari `sekarang` (dikirim pemanggil) supaya tes bisa
    /// memakai waktu tetap, bukan jam dinding.
    fn mulai(self, sekarang_ms: i64) -> Option<i64> {
        let hari_ms = 86_400_000;
        match self {
            Rentang::Semua => None,
            Rentang::Hari => Some(sekarang_ms - hari_ms),
            Rentang::Minggu => Some(sekarang_ms - 7 * hari_ms),
            Rentang::Bulan => Some(sekarang_ms - 30 * hari_ms),
            Rentang::Tahun => Some(sekarang_ms - 365 * hari_ms),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaguTeratas {
    pub video_id: String,
    pub judul: String,
    pub artis: String,
    pub total_ms: i64,
    pub putaran: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtisTeratas {
    pub artis: String,
    pub total_ms: i64,
    pub putaran: i64,
    pub jumlah_lagu: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JamSibuk {
    /// 0-23 dalam waktu LOKAL pengguna.
    pub jam: u8,
    pub total_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HariSibuk {
    /// Tanggal lokal `YYYY-MM-DD`.
    pub tanggal: String,
    pub total_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistik {
    pub total_ms: i64,
    pub total_putaran: i64,
    pub total_lagu_unik: i64,
    pub total_artis_unik: i64,
    /// Hari berturut-turut dengan aktivitas mendengar, dihitung mundur dari
    /// hari ini. Nol kalau hari ini belum ada aktivitas.
    pub streak_hari: i64,
    pub lagu_teratas: Vec<LaguTeratas>,
    pub artis_teratas: Vec<ArtisTeratas>,
    /// Selalu 24 entri, termasuk jam yang tidak pernah dipakai (total 0).
    pub per_jam: Vec<JamSibuk>,
    /// Hanya hari yang ada aktivitas, urut naik.
    pub per_hari: Vec<HariSibuk>,
}

/// Baris sesi hasil penggabungan potongan.
struct Sesi {
    video_id: String,
    mulai: i64,
    total_ms: i64,
}

/// CTE yang menggabungkan potongan menjadi sesi.
///
/// `?1` = batas awal (epoch ms) atau `NULL` untuk semua, `?2` = jeda sesi.
///
/// `LAG(...) OVER (PARTITION BY video_id ORDER BY started_at)` memberi akhir
/// potongan sebelumnya untuk lagu yang sama; selisihnya menentukan potongan itu
/// memulai sesi baru atau melanjutkan yang lama.
const SQL_SESI: &str = r"
WITH potongan AS (
    SELECT video_id, started_at, delta_ms,
           started_at + delta_ms AS berakhir
    FROM listen_events
    WHERE (?1 IS NULL OR started_at >= ?1)
),
bertanda AS (
    SELECT video_id, started_at, delta_ms,
           CASE
             WHEN LAG(berakhir) OVER (PARTITION BY video_id ORDER BY started_at) IS NULL
               THEN 1
             WHEN started_at - LAG(berakhir) OVER (PARTITION BY video_id ORDER BY started_at) > ?2
               THEN 1
             ELSE 0
           END AS sesi_baru
    FROM potongan
),
bernomor AS (
    SELECT video_id, started_at, delta_ms,
           SUM(sesi_baru) OVER (PARTITION BY video_id ORDER BY started_at
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sesi_id
    FROM bertanda
)
SELECT video_id,
       MIN(started_at) AS mulai,
       SUM(delta_ms)   AS total_ms
FROM bernomor
GROUP BY video_id, sesi_id
";

/// Ambil sesi dalam rentang, sudah digabung.
fn ambil_sesi(
    db: &crate::db::Db,
    mulai: Option<i64>,
) -> AppResult<Vec<Sesi>> {
    db.with(|c| {
        let mut stmt = c.prepare(SQL_SESI)?;
        let rows = stmt.query_map(rusqlite::params![mulai, JEDA_SESI_MS], |r| {
            Ok(Sesi {
                video_id: r.get(0)?,
                mulai: r.get(1)?,
                total_ms: r.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

/// Ubah epoch ms UTC menjadi tanggal lokal `YYYY-MM-DD`.
///
/// Implementasi sipil dari algoritma days-to-civil (Howard Hinnant), tanpa
/// dependensi `chrono` — kebutuhannya cuma memecah hari, bukan zona waktu
/// lengkap dengan DST.
fn tanggal_lokal(ms_utc: i64, offset_min: i32) -> String {
    tanggal_dari_nomor(hari_lokal(ms_utc, offset_min))
}

/// Jam lokal 0-23 dari epoch ms UTC.
fn jam_lokal(ms_utc: i64, offset_min: i32) -> u8 {
    let ms = ms_utc + i64::from(offset_min) * 60_000;
    (ms.rem_euclid(86_400_000) / 3_600_000) as u8
}

/// Algoritma days-to-civil (Hinnant). Hari 0 = 1970-01-01.
fn sipil_dari_hari(hari: i64) -> (i64, u32, u32) {
    let z = hari + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

/// Hitung seluruh statistik untuk satu rentang.
///
/// `sekarang_ms` dikirim pemanggil agar bisa diuji dengan waktu tetap; `limit`
/// membatasi panjang daftar teratas.
pub fn hitung(
    db: &crate::db::Db,
    rentang: Rentang,
    tz_offset_min: i32,
    sekarang_ms: i64,
    limit: usize,
) -> AppResult<Statistik> {
    let mulai = rentang.mulai(sekarang_ms);
    let sesi = ambil_sesi(db, mulai)?;

    // Hanya sesi yang cukup panjang dihitung sebagai "putaran". Total waktu
    // tetap menjumlahkan SEMUA sesi: mendengar 10 detik memang bukan putaran,
    // tapi waktunya benar-benar dipakai dan pantas tampil di total.
    let mut total_ms = 0i64;
    let mut total_putaran = 0i64;
    let mut per_lagu_ms: std::collections::HashMap<&str, i64> = Default::default();
    let mut per_lagu_putar: std::collections::HashMap<&str, i64> = Default::default();

    let mut per_jam_ms = [0i64; 24];
    let mut per_hari_ms: std::collections::BTreeMap<String, i64> = Default::default();
    let mut hari_unik: std::collections::BTreeSet<String> = Default::default();

    for s in &sesi {
        total_ms += s.total_ms;
        *per_lagu_ms.entry(s.video_id.as_str()).or_default() += s.total_ms;
        if s.total_ms >= AMBANG_PUTAR_MS {
            total_putaran += 1;
            *per_lagu_putar.entry(s.video_id.as_str()).or_default() += 1;
        }
        per_jam_ms[usize::from(jam_lokal(s.mulai, tz_offset_min))] += s.total_ms;
        let tgl = tanggal_lokal(s.mulai, tz_offset_min);
        *per_hari_ms.entry(tgl.clone()).or_default() += s.total_ms;
        hari_unik.insert(tgl);
    }

    // Metadata lagu diambil sekaligus dengan satu query IN, bukan satu query
    // per lagu — daftar teratas bisa 50 lagu dan N+1 di sini terasa.
    let ids: Vec<&str> = per_lagu_ms.keys().copied().collect();
    let meta = ambil_meta(db, &ids)?;

    let mut lagu: Vec<LaguTeratas> = per_lagu_ms
        .iter()
        .filter_map(|(vid, ms)| {
            let (judul, artis) = meta.get(*vid)?;
            Some(LaguTeratas {
                video_id: (*vid).to_string(),
                judul: judul.clone(),
                artis: artis.clone(),
                total_ms: *ms,
                putaran: per_lagu_putar.get(vid).copied().unwrap_or(0),
            })
        })
        .collect();
    lagu.sort_by_key(|l| std::cmp::Reverse(l.total_ms));
    lagu.truncate(limit);

    let mut per_artis: std::collections::HashMap<String, (i64, i64, std::collections::HashSet<&str>)> =
        Default::default();
    for (vid, ms) in &per_lagu_ms {
        if let Some((_, artis)) = meta.get(*vid) {
            let e = per_artis.entry(artis.clone()).or_insert((0, 0, Default::default()));
            e.0 += ms;
            e.1 += per_lagu_putar.get(vid).copied().unwrap_or(0);
            e.2.insert(*vid);
        }
    }
    // Dihitung dari set yang SAMA dengan `artis_teratas`. Sebelumnya memakai
    // query terpisah yang menjumlahkan artis semua lagu di tabel `tracks`,
    // sehingga angkanya bisa lebih besar daripada isi daftar teratas — dua
    // angka di layar yang sama tidak boleh saling bertentangan.
    let total_artis_unik = per_artis.len() as i64;

    let mut artis: Vec<ArtisTeratas> = per_artis
        .into_iter()
        .map(|(artis, (total_ms, putaran, lagu))| ArtisTeratas {
            artis,
            total_ms,
            putaran,
            jumlah_lagu: lagu.len() as i64,
        })
        .collect();
    artis.sort_by_key(|a| std::cmp::Reverse(a.total_ms));
    artis.truncate(limit);

    Ok(Statistik {
        total_ms,
        total_putaran,
        total_lagu_unik: per_lagu_ms.len() as i64,
        total_artis_unik,
        streak_hari: hitung_streak(&hari_unik, tz_offset_min, sekarang_ms),
        lagu_teratas: lagu,
        artis_teratas: artis,
        per_jam: (0..24u8)
            .map(|j| JamSibuk {
                jam: j,
                total_ms: per_jam_ms[usize::from(j)],
            })
            .collect(),
        per_hari: per_hari_ms
            .into_iter()
            .map(|(tanggal, total_ms)| HariSibuk { tanggal, total_ms })
            .collect(),
    })
}

/// Judul + artis untuk sekumpulan `video_id`.
///
/// SQLite membatasi jumlah parameter (default 999), jadi id diambil bertahap.
fn ambil_meta(
    db: &crate::db::Db,
    ids: &[&str],
) -> AppResult<std::collections::HashMap<String, (String, String)>> {
    let mut out = std::collections::HashMap::new();
    if ids.is_empty() {
        return Ok(out);
    }
    db.with(|c| {
        for bagian in ids.chunks(500) {
            let tanda = vec!["?"; bagian.len()].join(",");
            let sql = format!("SELECT video_id, title, artist FROM tracks WHERE video_id IN ({tanda})");
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(bagian.iter()), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
                ))
            })?;
            for r in rows {
                let (vid, meta) = r?;
                out.insert(vid, meta);
            }
        }
        Ok(out)
    })
}

/// Hari berturut-turut dengan aktivitas, dihitung mundur dari hari ini.
///
/// Kalau hari ini belum ada aktivitas, streak tetap dihitung dari kemarin —
/// kalau tidak, streak pengguna akan tampak 0 setiap pagi sebelum ia memutar
/// lagu, dan itu menyesatkan.
fn hitung_streak(
    hari_unik: &std::collections::BTreeSet<String>,
    tz_offset_min: i32,
    sekarang_ms: i64,
) -> i64 {
    if hari_unik.is_empty() {
        return 0;
    }
    // Bekerja dengan NOMOR HARI, bukan string tanggal dan bukan penambahan
    // offset berulang. Versi sebelumnya menggeser `sekarang` lalu menggeser
    // lagi di dalam loop, sehingga offset WIB terhitung dua kali (7+7 jam) dan
    // streak selalu 0. Nomor hari tidak bisa salah seperti itu.
    let hari_ini = hari_lokal(sekarang_ms, tz_offset_min);
    let ada_hari_ini = hari_unik.contains(&tanggal_lokal(sekarang_ms, tz_offset_min));

    // Kalau hari ini belum ada aktivitas, mulai dari kemarin: streak pengguna
    // tidak boleh tampak 0 hanya karena ia belum memutar lagu pagi ini.
    let mut mulai = if ada_hari_ini { hari_ini } else { hari_ini - 1 };

    let mut n = 0;
    while n <= 3650 && hari_unik.contains(&tanggal_dari_nomor(mulai)) {
        n += 1;
        mulai -= 1;
    }
    n
}

/// Nomor hari sejak 1970-01-01 menurut waktu LOKAL.
fn hari_lokal(ms_utc: i64, offset_min: i32) -> i64 {
    (ms_utc + i64::from(offset_min) * 60_000).div_euclid(86_400_000)
}

/// Kebalikan `hari_lokal`: nomor hari lokal -> string tanggal lokal.
fn tanggal_dari_nomor(hari: i64) -> String {
    let (y, m, d) = sipil_dari_hari(hari);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tanggal_lokal_wib_bergeser_seven_hours() {
        // 2026-11-15 17:30 UTC = 2026-11-16 00:30 WIB.
        let ms = 1_763_227_800_000;
        assert_eq!(tanggal_lokal(ms, 0), "2025-11-15");
        assert_eq!(jam_lokal(ms, 0), 17);
        // +7 jam melewati batas hari.
        assert_eq!(jam_lokal(ms, 420), 0);
        assert_eq!(tanggal_lokal(ms, 420), "2025-11-16");
    }

    #[test]
    fn tanggal_sebelum_epoch_tidak_panik() {
        // -1 ms = 1969-12-31 23:59:59.999 UTC. `div_euclid` menjaga tetap benar
        // walau negatif; pembagian biasa akan membulat ke arah nol dan salah.
        assert_eq!(tanggal_lokal(-1, 0), "1969-12-31");
        assert_eq!(jam_lokal(-1, 0), 23);
    }

    #[test]
    fn streak_putus_saat_ada_hari_kosong() {
        let mut h = std::collections::BTreeSet::new();
        h.insert("2026-11-15".to_string());
        h.insert("2026-11-14".to_string());
        h.insert("2026-11-12".to_string()); // 13 bolong
        // Sekarang: 2026-11-15 10:00 WIB.
        let sekarang = 1_794_711_600_000; // 2026-11-15 10:00 WIB
        assert_eq!(hitung_streak(&h, 420, sekarang), 2);
    }

    #[test]
    fn streak_tetap_dihitung_pagi_sebelum_memutar_lagu() {
        let mut h = std::collections::BTreeSet::new();
        h.insert("2026-11-15".to_string());
        h.insert("2026-11-14".to_string());
        // Sekarang 2026-11-16 06:00 WIB, hari ini belum ada aktivitas.
        let sekarang = 1_794_783_600_000; // 2026-11-16 06:00 WIB
        assert_eq!(hitung_streak(&h, 420, sekarang), 2);
    }

    #[test]
    fn rentang_semua_tidak_membatasi() {
        assert!(Rentang::Semua.mulai(1_000_000).is_none());
        assert_eq!(Rentang::Hari.mulai(100_000_000), Some(100_000_000 - 86_400_000));
    }

    #[test]
    fn sipil_cocok_untuk_tanggal_yang_dikenal() {
        assert_eq!(sipil_dari_hari(0), (1970, 1, 1));
        assert_eq!(sipil_dari_hari(20_000), (2024, 10, 4));
    }
}