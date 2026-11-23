//! Pencatat waktu mendengar (Fase 4a).
//!
//! Kenapa DELTA dan bukan "satu baris per lagu yang selesai":
//! sesi mendengar sering berakhir karena app ditutup, lagu di-skip, atau
//! playlist diganti di tengah jalan. Kalau baru menulis saat lagu selesai,
//! semua sesi yang terputus hilang. Dengan menyimpan potongan waktu yang
//! benar-benar diputar, tidak ada yang hilang.
//!
//! Aturan yang dipegang di sini:
//!
//! 1. **Seek tidak dihitung sebagai waktu mendengar.** Loncat dari 0:10 ke
//!    3:00 bukan berarti menikmati 2:50. Pencatat menerima `posisi` sekarang
//!    dan menghitung delta dari posisi sebelumnya; loncatan besar ditolak.
//! 2. **Pause tidak menambah waktu.** Delta = perubahan posisi pada elemen
//!    audio, bukan perubahan jam dinding.
//! 3. **Ada ambang minimum.** Geser 1 detik tidak layak jadi baris database.
//!
//! Logika akumulasi (`Akumulator`) sengaja murni — tanpa database, tanpa
//! Tauri — supaya bisa dipakai ulang oleh engine Android nanti dan diuji
//! tanpa menyentuh SQLite.

use rusqlite::params;
use serde::Serialize;

use crate::db::now_ms;
use crate::error::AppResult;

/// Geser posisi di bawah ini dianggap kelanjutan pemutaran biasa.
///
/// `timeupdate` datang ~4x/detik, jadi delta normal 200-300 ms. Loncatan
/// di atas 2 detik hampir selalu berarti seek (atau stall jaringan yang
/// tidak boleh dihitung sebagai waktu mendengar).
const AMBANG_SEEK_MS: i64 = 2_000;

/// Potongan waktu di bawah ini tidak disimpan. Menyimpan setiap 200 ms akan
/// menghasilkan ~18.000 baris per jam untuk satu lagu.
const MIN_SIMPAN_MS: i64 = 5_000;

/// Satu potongan waktu mendengar yang siap ditulis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Potongan {
    pub video_id: String,
    pub started_at: i64,
    pub delta_ms: i64,
}

/// Akumulator delta murni: tanpa database, tanpa jam dinding.
///
/// Pemakaian: panggil `catat(posisi_ms, sekarang_ms)` setiap event posisi.
/// Hasilnya `Some(Potongan)` kalau sudah cukup untuk disimpan, atau `None`
/// kalau masih terkumpul / ternyata seek.
#[derive(Debug, Default)]
pub struct Akumulator {
    video_id: Option<String>,
    posisi_terakhir: Option<i64>,
    /// Awal potongan yang sedang dikumpulkan (epoch ms dari pemanggil).
    mulai: i64,
    terkumpul: i64,
}

impl Akumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Ganti lagu: potongan yang sedang berjalan dikembalikan supaya tidak
    /// hilang saat lagu di-skip di tengah.
    pub fn ganti_lagu(&mut self, video_id: &str, sekarang_ms: i64) -> Option<Potongan> {
        let sisa = self.ambil();
        if self.video_id.as_deref() != Some(video_id) {
            self.video_id = Some(video_id.to_string());
            self.posisi_terakhir = None;
            self.mulai = sekarang_ms;
            self.terkumpul = 0;
        }
        sisa
    }

    /// Catat posisi saat ini. Mengembalikan potongan kalau ambang simpan
    /// tercapai.
    ///
    /// `sekarang_ms` dipakai sebagai `started_at` potongan — bukan waktu
    /// perangkat saat menulis, supaya potongan yang tertunda beberapa detik
    /// tetap tercatat pada waktu mendengarnya.
    pub fn catat(&mut self, posisi_ms: i64, sekarang_ms: i64) -> Option<Potongan> {
        let sebelum = self.posisi_terakhir;
        self.posisi_terakhir = Some(posisi_ms);

        let Some(sebelum) = sebelum else {
            // Titik pertama: belum ada delta yang bisa dihitung.
            if self.mulai == 0 {
                self.mulai = sekarang_ms;
            }
            return None;
        };

        let delta = posisi_ms - sebelum;
        // Delta negatif (mundur) atau terlalu besar (seek) tidak dihitung.
        // Pemutaran normal selalu maju sedikit-sedikit.
        if delta <= 0 || delta > AMBANG_SEEK_MS {
            // Seek: potongan yang terkumpul tetap disimpan, lalu mulai lagi
            // dari posisi baru supaya waktu setelah seek tetap tercatat.
            let selesai = self.ambil();
            self.mulai = sekarang_ms;
            return selesai;
        }

        self.terkumpul += delta;
        if self.terkumpul >= MIN_SIMPAN_MS {
            return self.ambil();
        }
        None
    }

    /// Ambil potongan yang terkumpul (kalau ada) dan reset penghitung.
    fn ambil(&mut self) -> Option<Potongan> {
        let vid = self.video_id.clone()?;
        let terkumpul = self.terkumpul;
        // Reset selalu, termasuk saat tidak ada yang dikembalikan — kalau
        // tidak, sisa lama akan ikut terhitung di potongan berikutnya.
        self.terkumpul = 0;
        if terkumpul <= 0 {
            return None;
        }
        Some(Potongan {
            video_id: vid,
            started_at: self.mulai,
            delta_ms: terkumpul,
        })
    }
}

/// Tulis satu potongan ke database.
pub fn simpan(db: &crate::db::Db, p: &Potongan) -> AppResult<()> {
    db.with(|c| {
        c.execute(
            "INSERT INTO listen_events (video_id, started_at, delta_ms) VALUES (?1, ?2, ?3)",
            params![p.video_id, p.started_at, p.delta_ms],
        )?;
        Ok(())
    })
}

/// Hitung dan simpan delta dalam satu langkah untuk pemanggil yang tidak mau
/// mengurus akumulator sendiri.
pub fn catat_delta(
    db: &crate::db::Db,
    video_id: &str,
    delta_ms: i64,
    started_at: i64,
) -> AppResult<()> {
    if delta_ms <= 0 || video_id.trim().is_empty() {
        return Ok(());
    }
    simpan(
        db,
        &Potongan {
            video_id: video_id.to_string(),
            started_at,
            delta_ms,
        },
    )
}

/// Apakah pencatatan diaktifkan pengguna (Fase 4b mengekspos toggle ini).
pub fn aktif(db: &crate::db::Db) -> bool {
    crate::db::get_setting(db, "listen_stats")
        .ok()
        .flatten()
        .map(|v| v != "0")
        .unwrap_or(true)
}

/// Hapus seluruh data statistik.
pub fn hapus_semua(db: &crate::db::Db) -> AppResult<usize> {
    db.with(|c| {
        let n = c.execute("DELETE FROM listen_events", [])?;
        Ok(n)
    })
}

/// Ringkasan yang dikirim ke UI (dipakai Fase 4b).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ringkasan {
    pub total_ms: i64,
    pub jumlah_lagu_unik: i64,
    pub jumlah_putar: i64,
}

pub fn ringkasan(db: &crate::db::Db) -> AppResult<Ringkasan> {
    db.with(|c| {
        let mut stmt = c.prepare(
            "SELECT COALESCE(SUM(delta_ms), 0),
                    COUNT(DISTINCT video_id),
                    COUNT(*)
             FROM listen_events",
        )?;
        let r = stmt.query_row([], |r| {
            Ok(Ringkasan {
                total_ms: r.get(0)?,
                jumlah_lagu_unik: r.get(1)?,
                jumlah_putar: r.get(2)?,
            })
        })?;
        Ok(r)
    })
}

/// Riwayat ringkas per lagu untuk smart shuffle.
///
/// Memakai penggabungan sesi yang SAMA dengan `db::stats` (potongan berurutan
/// untuk lagu yang sama digabung bila jedanya < 30 detik). Tanpa itu, satu lagu
/// 3 menit yang dicatat tiap 5 detik akan terlihat seperti 36 "putaran", dan
/// semuanya di bawah 30 detik sehingga dianggap skip — kebalikan dari
/// kenyataan.
///
/// Definisi konsisten dengan `FEATURES-V2.md` §1.3:
/// - **selesai**: sesi mencapai >=90% durasi lagu
/// - **skip**: sesi berhenti sebelum 30 detik
/// - di antaranya tidak dihitung ke keduanya: itu mendengar biasa, bukan bukti
///   suka atau benci, jadi tidak boleh menggeser bobot.
pub fn riwayat_untuk_shuffle(
    db: &crate::db::Db,
) -> AppResult<std::collections::HashMap<String, crate::queue::smart::RiwayatLagu>> {
    use crate::queue::smart::RiwayatLagu;
    let mut out: std::collections::HashMap<String, RiwayatLagu> = Default::default();
    db.with(|c| {
        // Durasi 0/NULL tidak pernah memenuhi 90%, jadi lagu tanpa durasi tidak
        // pernah terhitung "selesai". Lebih baik begitu daripada menganggapnya
        // selesai padahal tidak diketahui.
        let mut stmt = c.prepare(
            "WITH potongan AS (
                SELECT video_id, started_at, delta_ms,
                       started_at + delta_ms AS berakhir
                FROM listen_events
             ),
             bertanda AS (
                SELECT video_id, started_at, delta_ms, berakhir,
                       CASE
                         WHEN LAG(berakhir) OVER (PARTITION BY video_id ORDER BY started_at) IS NULL
                           THEN 1
                         WHEN started_at - LAG(berakhir) OVER (PARTITION BY video_id ORDER BY started_at) > 30000
                           THEN 1
                         ELSE 0
                       END AS sesi_baru
                FROM potongan
             ),
             sesi AS (
                SELECT video_id,
                       started_at, delta_ms,
                       SUM(sesi_baru) OVER (PARTITION BY video_id ORDER BY started_at
                                            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS sesi_id
                FROM bertanda
             ),
             gabung AS (
                SELECT video_id,
                       SUM(delta_ms) AS total,
                       MAX(started_at + delta_ms) AS akhir
                FROM sesi
                GROUP BY video_id, sesi_id
             )
             SELECT g.video_id,
                    SUM(CASE WHEN t.duration_ms > 0 AND g.total >= t.duration_ms * 0.9
                             THEN 1 ELSE 0 END) AS selesai,
                    SUM(CASE WHEN g.total < 30000 THEN 1 ELSE 0 END) AS skip,
                    SUM(g.total)  AS total_dengar,
                    -- Durasi lagu diulang per sesi supaya penyebutnya sepadan
                    -- dengan `total_dengar` (yang juga menjumlah antar sesi).
                    SUM(t.duration_ms) AS total_durasi,
                    COUNT(*)          AS jumlah_sesi,
                    MAX(g.akhir) AS terakhir
             FROM gabung g
             JOIN tracks t ON t.video_id = g.video_id
             GROUP BY g.video_id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                RiwayatLagu {
                    selesai: r.get::<_, i64>(1)? as u32,
                    skip: r.get::<_, i64>(2)? as u32,
                    total_ms: r.get::<_, i64>(3)?,
                    durasi_ms: r.get::<_, i64>(4)?,
                    sesi: r.get::<_, i64>(5)? as u32,
                    terakhir_ms: r.get::<_, i64>(6)?,
                },
            ))
        })?;
        for r in rows {
            let (vid, ri) = r?;
            out.insert(vid, ri);
        }
        Ok(())
    })?;
    Ok(out)
}

/// Waktu sekarang untuk pemanggil yang perlu `started_at`.
pub fn sekarang_ms() -> i64 {
    now_ms()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pemutaran normal maju sedikit-sedikit harus terkumpul.
    #[test]
    fn akumulasi_normal_terkumpul() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 1_000);
        assert_eq!(a.catat(0, 1_000), None);
        // 5 detik terkumpul dalam potongan 250 ms.
        let mut hasil = None;
        for i in 1..=20 {
            hasil = a.catat(i * 250, 1_000 + i * 250);
        }
        let p = hasil.expect("harus ada potongan setelah 5 detik");
        assert_eq!(p.video_id, "vid");
        assert_eq!(p.delta_ms, 5_000);
    }

    /// Seek ke depan TIDAK boleh dihitung sebagai waktu mendengar.
    #[test]
    fn seek_tidak_dihitung() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 0);
        a.catat(10_000, 0);
        // Loncat ke 3 menit: delta 170 detik, jelas seek.
        let p = a.catat(180_000, 100);
        // Tidak ada delta yang dicatat dari loncatan itu.
        assert!(p.is_none(), "seek tidak boleh menghasilkan potongan");
    }

    /// Mundur (replay) juga bukan waktu mendengar.
    #[test]
    fn mundur_tidak_dihitung() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 0);
        a.catat(60_000, 0);
        assert_eq!(a.catat(5_000, 100), None);
    }

    /// Pause: posisi tidak berubah, jadi tidak ada delta. Ini yang membuat
    /// waktu jeda tidak ikut terhitung sebagai "mendengar".
    #[test]
    fn pause_tidak_menambah_waktu() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 0);
        a.catat(30_000, 0);
        // Sepuluh event posisi sama (pause 10 detik).
        for i in 0..10 {
            assert_eq!(a.catat(30_000, i * 250), None);
        }
    }

    /// Ganti lagu di tengah harus mengembalikan sisa potongan supaya tidak
    /// hilang — inilah alasan utama memakai delta.
    #[test]
    fn ganti_lagu_mengembalikan_sisa() {
        let mut a = Akumulator::new();
        a.ganti_lagu("lagu-a", 0);
        a.catat(0, 0);
        for i in 1..=24 {
            a.catat(i * 250, i * 250); // 6 detik
        }
        // Skip ke lagu lain sebelum ambang simpan berikutnya.
        let sisa = a.ganti_lagu("lagu-b", 7_000).expect("sisa harus dikembalikan");
        assert_eq!(sisa.video_id, "lagu-a");
        assert_eq!(sisa.delta_ms, 1_000, "sisa 1 detik setelah potongan 5 detik");
    }

    /// Delta di bawah ambang simpan tidak menghasilkan baris.
    #[test]
    fn delta_kecil_tidak_disimpan() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 0);
        a.catat(0, 0);
        assert_eq!(a.catat(250, 250), None);
        assert_eq!(a.catat(500, 500), None);
    }

    /// Seek juga menyimpan waktu yang terkumpul SEBELUM seek, lalu mulai
    /// hitungan baru dari posisi setelah seek.
    #[test]
    fn seek_menyimpan_yang_terkumpul_dulu() {
        let mut a = Akumulator::new();
        a.ganti_lagu("vid", 0);
        a.catat(0, 0);

        // Akumulator mem-flush tiap 5 detik, jadi kumpulkan potongan yang
        // keluar sambil menabung sisa terakhir.
        let mut total_tersimpan = 0;
        let mut terakhir = None;
        for i in 1..=24 {
            if let Some(p) = a.catat(i * 250, i * 250) {
                total_tersimpan += p.delta_ms;
                terakhir = Some(p);
            }
        }
        assert_eq!(total_tersimpan, 5_000, "satu flush di detik ke-5");

        // Saat seek, sisa 1 detik yang belum ter-flush harus dikembalikan —
        // bukan dibuang.
        let p = a.catat(120_000, 6_000).expect("sisa sebelum seek");
        assert_eq!(p.delta_ms, 1_000, "sisa setelah flush terakhir");
        assert_eq!(terakhir.unwrap().delta_ms, 5_000);

        // Setelah seek, hitungan mulai lagi dari posisi baru dan tetap
        // ter-flush saat mencapai 5 detik.
        assert_eq!(a.catat(120_250, 6_250), None);
        let mut setelah_seek = 0;
        for i in 1..=20 {
            if let Some(p) = a.catat(120_250 + i * 250, 6_250 + i * 250) {
                setelah_seek += p.delta_ms;
            }
        }
        assert_eq!(
            setelah_seek, 5_000,
            "waktu setelah seek harus tercatat penuh, bukan hilang"
        );
    }
}