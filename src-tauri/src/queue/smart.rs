//! Smart shuffle lokal berbobot (Fase 4b).
//!
//! Shuffle biasa mengacak rata: setiap lagu punya peluang sama, termasuk lagu
//! yang selalu kamu lewati dan lagu yang baru saja diputar. Smart shuffle
//! menyusun urutan berdasarkan kebiasaan mendengar:
//!
//! - lagu yang sering diselesaikan naik peluangnya,
//! - lagu yang sering di-skip turun,
//! - lagu yang baru diputar diturunkan supaya tidak repetitif,
//! - artis yang sama diberi jarak,
//! - lagu tanpa riwayat **tidak dihukum** — kalau dihukum, lagu baru tidak
//!   akan pernah muncul dan koleksi tidak pernah berkembang.
//!
//! Modul ini **murni**: tanpa database, tanpa jam, tanpa Tauri. Statistik
//! dikirim pemanggil. Dua alasan: bisa diuji tanpa menyalakan aplikasi, dan
//! nanti bisa dipakai ulang di engine Android.
//!
//! ## Kenapa weighted random, bukan sortir
//!
//! Sortir berdasarkan bobot menghasilkan urutan yang SAMA setiap kali — lagu
//! favorit selalu di depan, yang berarti shuffle-nya tidak terasa acak lagi.
//! Weighted random (roulette wheel) mempertahankan peluang tanpa kehilangan
//! keacakan.

use std::collections::HashMap;

/// Statistik satu lagu, dikirim pemanggil dari tabel `listen_events`.
#[derive(Debug, Clone, Copy, Default)]
pub struct RiwayatLagu {
    /// Berapa kali lagu ini diselesaikan (≥90% durasi).
    pub selesai: u32,
    /// Berapa kali lagu ini ditinggalkan sebelum ambang putar.
    pub skip: u32,
    /// Total milidetik yang benar-benar didengar.
    pub total_ms: i64,
    /// Total durasi lagu untuk semua sesi (penyebut rasio penyelesaian).
    pub durasi_ms: i64,
    /// Jumlah sesi mendengar lagu ini.
    ///
    /// Dibutuhkan untuk menafsirkan `skip` dengan benar: 1 skip dari 1 sesi
    /// berarti lagu itu selalu dilewati, tapi 1 skip dari 10 sesi berarti lagu
    /// favorit yang kebetulan sekali di-skip. Tanpa angka ini keduanya sama.
    pub sesi: u32,
    /// Epoch ms terakhir lagu ini diputar.
    pub terakhir_ms: i64,
}

impl RiwayatLagu {
    /// Rata-rata bagian lagu yang benar-benar didengar, 0.0–1.0.
    ///
    /// Ini sinyal paling kuat yang dimiliki pengguna. Lagu yang kamu dengarkan
    /// 80% jelas lebih kamu sukai daripada lagu yang belum pernah dibuka —
    /// tetapi tanpa rasio ini keduanya berbobot sama, dan smart shuffle tidak
    /// punya alasan untuk mendahulukan yang pertama.
    fn rasio_dengar(&self) -> f64 {
        if self.durasi_ms <= 0 {
            return 0.0;
        }
        (self.total_ms as f64 / self.durasi_ms as f64).clamp(0.0, 1.0)
    }
}

/// Masukan untuk menyusun ulang urutan.
pub struct Masukan<'a> {
    /// `video_id` per posisi di antrean asli.
    pub ids: &'a [String],
    /// Artis per posisi, sejajar dengan `ids`. Dipakai untuk memberi jarak
    /// antar lagu artis yang sama.
    pub artis: &'a [String],
    /// Indeks lagu yang sedang diputar; selalu ditaruh paling depan.
    pub aktif: usize,
    /// Riwayat per `video_id`. Id yang tidak ada di sini dianggap lagu baru.
    pub riwayat: &'a HashMap<String, RiwayatLagu>,
    /// Waktu sekarang, epoch ms — dikirim supaya hasil bisa direproduksi.
    pub sekarang_ms: i64,
    /// Seed pengacak; seed sama + masukan sama = urutan sama.
    pub seed: u64,
}

/// Bobot dasar tiap lagu sebelum dikoreksi riwayat.
const BOBOT_DASAR: f64 = 1.0;
/// Lagu yang selalu diselesaikan mendapat tambahan ini per penyelesaian.
const BOOST_SELESAI: f64 = 0.5;
/// Batas tambahan dari penyelesaian.
///
/// Dinaikkan dari 1.0 ke 2.0 setelah diuji pada data nyata: dengan batas lama,
/// lagu favorit (2x selesai) berbobot 1.5 lalu dikali 0.6 karena baru diputar
/// = 0.9, LEBIH RENDAH daripada lagu yang belum pernah didengar (1.0). Hasilnya
/// lagu favorit justru terlempar ke belakang — kebalikan dari gunanya fitur ini.
const MAKS_BOOST_SELESAI: f64 = 2.0;
/// Tambahan bobot dari rasio mendengar (0.0-1.0 -> 0..nilai ini).
const BOOST_RASIO_DENGAR: f64 = 0.8;
/// Pengali kalau lagu sering di-skip. `1/(1+skip)` tidak pernah nol: lagu yang
/// pernah di-skip masih mungkin muncul, hanya lebih jarang.
const PENALTI_SKIP: f64 = 0.7;
/// Lagu yang diputar dalam 10 menit terakhir diturunkan berat.
const PENALTI_BARU_MS: i64 = 10 * 60_000;
/// Lagu yang diputar dalam 24 jam terakhir diturunkan sedikit.
const PENALTI_SEHARI_MS: i64 = 86_400_000;
/// Pengali untuk lagu yang baru saja diputar (10 menit).
const PENGALI_BARU: f64 = 0.3;
/// Pengali untuk lagu yang diputar dalam 24 jam.
///
/// Sengaja ringan (0.85, bukan 0.6): tujuannya mencegah pengulangan langsung,
/// bukan menghukum lagu yang kamu sukai. Dengan 0.6, lagu favorit yang kamu
/// dengar pagi ini kalah dari lagu yang belum pernah kamu buka.
const PENGALI_SEHARI: f64 = 0.85;

/// Pengacak xorshift64*, sama seperti yang dipakai `QueueManager`.
///
/// Disalin, bukan diimpor, karena modul ini harus tetap murni dan mandiri —
/// `queue::Rng` privat untuk modul queue.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(if seed == 0 { 0x9E3779B97F4A7C15 } else { seed })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }

    /// Bilangan pecahan [0, 1).
    fn next_f64(&mut self) -> f64 {
        // 53 bit mantissa: cukup untuk roulette wheel tanpa bias berarti.
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Bobot satu lagu. Semakin besar, semakin awal/ceria muncul.
///
/// Publik supaya bisa diuji langsung — memeriksa bobot jauh lebih mudah
/// daripada menyimpulkan dari urutan acak.
pub fn bobot(riwayat: Option<&RiwayatLagu>, sekarang_ms: i64) -> f64 {
    let Some(r) = riwayat else {
        // Lagu baru: netral. Jangan dihukum, jangan juga dinaikkan — kita
        // belum tahu pengguna suka atau tidak.
        return BOBOT_DASAR;
    };

    let mut w = BOBOT_DASAR;

    // Sering diselesaikan = disukai.
    w += (f64::from(r.selesai) * BOOST_SELESAI).min(MAKS_BOOST_SELESAI);

    // Seberapa banyak lagu ini benar-benar didengar. Ini menangkap kasus yang
    // tidak tertangkap `selesai`: lagu yang selalu didengar 70-80% (suka, tapi
    // tidak sampai habis) tetap harus lebih tinggi dari lagu yang belum pernah
    // dibuka sama sekali.
    w += r.rasio_dengar() * BOOST_RASIO_DENGAR;

    // Sering di-skip = tidak disukai. Penyebutnya JUMLAH SESI, bukan
    // `selesai + skip`.
    //
    // Versi sebelumnya membagi dengan `selesai + skip`, sehingga sesi yang
    // "hanya didengar" (80%, tidak sampai habis, tidak di-skip) tidak masuk
    // hitungan sama sekali. Akibatnya lagu yang didengar penuh 80% lalu sekali
    // di-skip mendapat rasio skip 1/1 = 100% dan hukumannya penuh. Penyebut
    // yang benar adalah semua sesi.
    if r.sesi > 0 && r.skip > 0 {
        let rasio = f64::from(r.skip) / f64::from(r.sesi);
        w *= 1.0 - rasio * PENALTI_SKIP;
    }

    // Baru diputar = turunkan, supaya tidak mengulang lagu yang sama.
    if r.terakhir_ms > 0 {
        let sejak = sekarang_ms.saturating_sub(r.terakhir_ms);
        if sejak < PENALTI_BARU_MS {
            w *= PENGALI_BARU;
        } else if sejak < PENALTI_SEHARI_MS {
            w *= PENGALI_SEHARI;
        }
    }

    // Jangan pernah nol: lagu dengan bobot 0 tidak akan pernah muncul lagi,
    // dan itu membuat koleksi perlahan menyusut.
    w.max(0.05)
}

/// Susun ulang urutan antrean secara berbobot.
///
/// Hasil selalu dimulai dengan lagu aktif (kalau `ids` tidak kosong), lalu sisa
/// lagu dipilih satu per satu secara proporsional terhadap bobotnya. Artis yang
/// baru saja muncul diturunkan sementara supaya tidak beruntun.
///
/// Mengembalikan urutan indeks ke dalam `ids` — pemanggil yang memetakan ke
/// item antrean, sehingga modul ini tidak perlu tahu soal `QueueItem`.
pub fn susun(m: &Masukan<'_>) -> Vec<usize> {
    let n = m.ids.len();
    if n == 0 {
        return Vec::new();
    }
    let aktif = m.aktif.min(n - 1);

    let mut sisa: Vec<usize> = (0..n).filter(|&i| i != aktif).collect();
    let mut hasil = Vec::with_capacity(n);
    hasil.push(aktif);

    // Hitung bobot dasar sekali; pengali artis diterapkan per langkah karena
    // bergantung pada apa yang baru saja diputar.
    let bobot_dasar: Vec<f64> = (0..n)
        .map(|i| bobot(m.riwayat.get(&m.ids[i]), m.sekarang_ms))
        .collect();

    let mut rng = Rng::new(m.seed);
    let mut artis_terakhir: Vec<&str> = Vec::new();

    while !sisa.is_empty() {
        // Bobot efektif tiap kandidat, sudah dikoreksi jarak artis.
        let bobot_eff: Vec<f64> = sisa
            .iter()
            .map(|&i| {
                let artis = m.artis.get(i).map(String::as_str).unwrap_or("");
                let pengali = if artis_terakhir.first() == Some(&artis) {
                    0.1 // artis sama dengan lagu tepat sebelumnya
                } else if artis_terakhir.contains(&artis) {
                    0.5 // artis muncul dalam 3 lagu terakhir
                } else {
                    1.0
                };
                bobot_dasar[i] * pengali
            })
            .collect();

        let total: f64 = bobot_eff.iter().sum();
        let pilih = if total <= 0.0 {
            // Semua kandidat berbobot nol (praktis mustahil karena ada batas
            // minimum 0.05, tapi jangan sampai membagi nol).
            rng.next_f64() * sisa.len() as f64
        } else {
            let r = rng.next_f64() * total;
            let mut akum = 0.0;
            let mut idx = sisa.len() - 1;
            for (k, w) in bobot_eff.iter().enumerate() {
                akum += w;
                if r < akum {
                    idx = k;
                    break;
                }
            }
            idx as f64
        };

        let posisi = (pilih as usize).min(sisa.len() - 1);
        let item = sisa.remove(posisi);
        hasil.push(item);

        let artis = m.artis.get(item).map(String::as_str).unwrap_or("");
        artis_terakhir.insert(0, artis);
        artis_terakhir.truncate(3);
    }

    hasil
}

#[cfg(test)]
mod tests {
    use super::*;

    fn riwayat(selesai: u32, skip: u32, terakhir_ms: i64) -> RiwayatLagu {
        RiwayatLagu {
            selesai,
            skip,
            total_ms: 0,
            durasi_ms: 0,
            sesi: 0,
            terakhir_ms,
        }
    }

    /// Riwayat dengan rasio mendengar nyata, seperti data sungguhan.
    fn riwayat_dengar(bagian: f64, terakhir_ms: i64) -> RiwayatLagu {
        let durasi = 240_000i64;
        RiwayatLagu {
            selesai: 0,
            skip: 0,
            total_ms: (durasi as f64 * bagian) as i64,
            durasi_ms: durasi,
            sesi: 1,
            terakhir_ms,
        }
    }

    fn masukan<'a>(
        ids: &'a [String],
        artis: &'a [String],
        riwayat: &'a HashMap<String, RiwayatLagu>,
        seed: u64,
    ) -> Masukan<'a> {
        Masukan {
            ids,
            artis,
            aktif: 0,
            riwayat,
            sekarang_ms: 1_000_000_000,
            seed,
        }
    }

    #[test]
    fn lagu_baru_tidak_dihukum() {
        // Lagu baru harus berbobot sama dengan lagu netral tanpa riwayat.
        assert_eq!(bobot(None, 1_000_000_000), BOBOT_DASAR);
    }

    #[test]
    fn sering_selesai_menaikkan_bobot() {
        let jarang = bobot(Some(&riwayat(1, 0, 0)), 1_000_000_000);
        let sering = bobot(Some(&riwayat(4, 0, 0)), 1_000_000_000);
        assert!(sering > jarang, "{sering} harus > {jarang}");
    }

    #[test]
    fn sering_skip_menurunkan_bobot() {
        let disukai = bobot(Some(&riwayat(10, 0, 0)), 1_000_000_000);
        let dilewati = bobot(Some(&riwayat(0, 10, 0)), 1_000_000_000);
        assert!(dilewati < disukai, "{dilewati} harus < {disukai}");
    }

    #[test]
    fn lagu_yang_baru_diputar_diturunkan() {
        let sekarang = 1_000_000_000;
        let baru = bobot(Some(&riwayat(0, 0, sekarang - 60_000)), sekarang);
        let lama = bobot(Some(&riwayat(0, 0, sekarang - 7 * 86_400_000)), sekarang);
        assert!(baru < lama, "baru {baru} harus < lama {lama}");
    }

    /// Inti gunanya smart shuffle: lagu favorit HARUS lebih mungkin muncul
    /// daripada lagu yang belum pernah didengar.
    ///
    /// Tes ini menangkap bug nyata dari data pengguna: dengan penalti "baru
    /// diputar" 0.6 dan bonus selesai maksimal 1.0, favorit yang diputar tadi
    /// berbobot 0.9 < 1.0 milik lagu asing — jadi fitur ini justru menjauhkan
    /// lagu kesukaan.
    #[test]
    fn favorit_masih_lebih_tinggi_dari_lagu_asing_walau_baru_diputar() {
        let sekarang = 1_000_000_000;
        let favorit_baru = bobot(Some(&riwayat(3, 0, sekarang - 3_600_000)), sekarang);
        let asing = bobot(None, sekarang);
        assert!(
            favorit_baru > asing,
            "favorit yang diputar sejam lalu ({favorit_baru}) harus > lagu asing ({asing})"
        );
    }

    /// Tapi lagu yang BARU SAJA diputar (10 menit) tetap harus diturunkan,
    /// supaya tidak mengulang lagu yang sama terus-menerus.
    #[test]
    fn lagu_baru_saja_diputar_turun_di_bawah_lagu_asing() {
        let sekarang = 1_000_000_000;
        let baru_saja = bobot(Some(&riwayat(0, 0, sekarang - 60_000)), sekarang);
        let asing = bobot(None, sekarang);
        assert!(baru_saja < asing, "{baru_saja} harus < {asing}");
    }

    /// Kasus nyata dari database pengguna: banyak lagu didengar 70-80%
    /// (tidak pernah "selesai", tidak pernah "skip"). Tanpa rasio mendengar,
    /// lagu-lagu itu berbobot persis sama dengan lagu yang belum pernah dibuka,
    /// sehingga smart shuffle tidak punya alasan mendahulukannya.
    #[test]
    fn didengar_sebagian_lebih_tinggi_dari_belum_pernah_dibuka() {
        let sekarang = 1_000_000_000;
        let sering = bobot(Some(&riwayat_dengar(0.8, 0)), sekarang);
        let asing = bobot(None, sekarang);
        assert!(sering > asing, "didengar 80% ({sering}) harus > asing ({asing})");
    }

    #[test]
    fn rasio_mendengar_naik_sebanding() {
        let sekarang = 1_000_000_000;
        let sedikit = bobot(Some(&riwayat_dengar(0.3, 0)), sekarang);
        let banyak = bobot(Some(&riwayat_dengar(0.9, 0)), sekarang);
        assert!(banyak > sedikit, "{banyak} harus > {sedikit}");
    }

    /// Kasus nyata dari database: satu lagu didengar 80% di satu sesi, lalu
    /// di-skip cepat di dua sesi lain (total 3 sesi, 1 skip).
    ///
    /// Versi lama membagi skip dengan `selesai + skip` = 1/1 = 100%, sehingga
    /// lagu itu dihukum penuh dan bobotnya jatuh ke 0.38 — jauh di bawah lagu
    /// yang belum pernah dibuka (1.0), padahal jelas pernah didengar lama.
    /// Dengan penyebut jumlah sesi, hukumannya 1/3 dan bobotnya ~0.97: dekat
    /// netral, bukan terpuruk. Itu yang dikunci di sini.
    #[test]
    fn sekali_skip_tidak_menenggelamkan_lagu_yang_didengar_lama() {
        let sekarang = 1_000_000_000;
        let durasi = 240_000i64;
        let lagu = RiwayatLagu {
            selesai: 0,
            skip: 1,
            // 80% sesi pertama + dua sesi pendek yang di-skip.
            total_ms: (durasi as f64 * 0.85) as i64,
            durasi_ms: durasi * 3,
            sesi: 3,
            terakhir_ms: 0,
        };
        let w = bobot(Some(&lagu), sekarang);
        let asing = bobot(None, sekarang);
        assert!(
            w > 0.9,
            "harus dekat netral setelah satu skip dari tiga sesi, dapat {w:.2} (asing {asing:.2})"
        );
        assert!(w > 0.38, "tidak boleh kembali ke perilaku bug lama (0.38)");
    }

    /// Kalau SEMUA sesi di-skip, hukumannya memang penuh — itu lagu yang
    /// benar-benar tidak disukai.
    #[test]
    fn semua_sesi_diskip_tetap_dihukum_berat() {
        let sekarang = 1_000_000_000;
        let durasi = 240_000i64;
        let lagu = RiwayatLagu {
            selesai: 0,
            skip: 3,
            total_ms: 60_000,
            durasi_ms: durasi * 3,
            sesi: 3,
            terakhir_ms: 0,
        };
        let w = bobot(Some(&lagu), sekarang);
        assert!(w < 0.5, "semua sesi di-skip harus jauh di bawah netral, dapat {w:.2}");
    }

    #[test]
    fn bobot_tidak_pernah_nol() {
        // Lagu yang di-skip 1000 kali masih harus punya peluang muncul.
        let w = bobot(Some(&riwayat(0, 1000, 0)), 1_000_000_000);
        assert!(w > 0.0, "bobot harus > 0, dapat {w}");
    }

    #[test]
    fn urutan_dimulai_lagu_aktif() {
        let ids: Vec<String> = (0..6).map(|i| format!("v{i}")).collect();
        let artis: Vec<String> = (0..6).map(|i| format!("a{i}")).collect();
        let r = HashMap::new();
        let mut m = masukan(&ids, &artis, &r, 7);
        m.aktif = 3;
        assert_eq!(susun(&m)[0], 3);
    }

    #[test]
    fn seed_sama_menghasilkan_urutan_sama() {
        let ids: Vec<String> = (0..12).map(|i| format!("v{i}")).collect();
        let artis: Vec<String> = (0..12).map(|i| format!("a{i}")).collect();
        let r = HashMap::new();
        assert_eq!(susun(&masukan(&ids, &artis, &r, 42)), susun(&masukan(&ids, &artis, &r, 42)));
    }

    #[test]
    fn seed_beda_menghasilkan_urutan_beda() {
        let ids: Vec<String> = (0..20).map(|i| format!("v{i}")).collect();
        let artis: Vec<String> = (0..20).map(|i| format!("a{i}")).collect();
        let r = HashMap::new();
        assert_ne!(susun(&masukan(&ids, &artis, &r, 1)), susun(&masukan(&ids, &artis, &r, 999)));
    }

    #[test]
    fn semua_lagu_muncul_tepat_sekali() {
        let ids: Vec<String> = (0..15).map(|i| format!("v{i}")).collect();
        let artis: Vec<String> = (0..15).map(|i| format!("a{i}")).collect();
        let r = HashMap::new();
        let hasil = susun(&masukan(&ids, &artis, &r, 5));
        let mut urut = hasil.clone();
        urut.sort_unstable();
        assert_eq!(urut, (0..15).collect::<Vec<_>>());
    }

    #[test]
    fn antrean_kosong_tidak_panik() {
        let ids: Vec<String> = Vec::new();
        let artis: Vec<String> = Vec::new();
        let r = HashMap::new();
        assert!(susun(&masukan(&ids, &artis, &r, 1)).is_empty());
    }

    #[test]
    fn satu_lagu_tidak_panik() {
        let ids = vec!["v0".to_string()];
        let artis = vec!["a0".to_string()];
        let r = HashMap::new();
        assert_eq!(susun(&masukan(&ids, &artis, &r, 1)), vec![0]);
    }

    #[test]
    fn artis_sama_diberi_jarak() {
        // Semua lagu satu artis. Pengali jarak menurunkan yang beruntun, tapi
        // karena semua sama-sama diturunkan hasilnya tetap semua lagu muncul.
        let ids: Vec<String> = (0..6).map(|i| format!("v{i}")).collect();
        let artis: Vec<String> = (0..6).map(|_| "Artis Sama".to_string()).collect();
        let r = HashMap::new();
        let hasil = susun(&masukan(&ids, &artis, &r, 3));
        assert_eq!(hasil.len(), 6);
        let mut urut = hasil;
        urut.sort_unstable();
        assert_eq!(urut, (0..6).collect::<Vec<_>>());
    }
}