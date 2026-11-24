//! Penskoran kecocokan lagu impor → hasil pencarian YouTube (Fase 5).
//!
//! Modul ini MURNI: tanpa jaringan, tanpa database. Masukannya satu lagu impor
//! dan beberapa kandidat hasil pencarian; keluarannya skor 0..1 plus alasan.
//! Pemisahan ini penting karena bagian inilah yang paling mudah salah, dan
//! kesalahannya paling mahal: pengguna mendapat lagu yang bukan maksudnya.
//!
//! Kenapa tidak "ambil hasil teratas saja": pencarian "Creep" mengembalikan
//! versi studio, acoustic, live, dan cover Glee bersamaan. Mengambil yang
//! teratas kadang benar, kadang tidak — dan pengguna tidak akan tahu sampai
//! lagunya berbunyi. Skor eksplisit + ambang review membuat kesalahan itu
//! terlihat sebelum diimpor.

use serde::{Deserialize, Serialize};

/// Ambang skor untuk diterima otomatis.
///
/// 0,80 dipilih dari pengujian nyata: judul+artis persis memberi ~1,0; judul
/// persis dengan artis sedikit berbeda ~0,85; versi berbeda (live/remix) jatuh
/// di bawah 0,70. Di antara 0,60 dan 0,80 lagu masuk daftar REVIEW, bukan
/// dibuang dan bukan diterima diam-diam.
pub const AMBANG_OTOMATIS: f32 = 0.80;
/// Di bawah ini dianggap tidak ditemukan.
pub const AMBANG_MINIMUM: f32 = 0.60;

/// Satu kandidat dari pencarian katalog.
#[derive(Debug, Clone)]
pub struct Kandidat {
    pub video_id: String,
    pub judul: String,
    pub artis: String,
    pub durasi_ms: Option<i64>,
}

/// Hasil penskoran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Keputusan {
    /// Skor >= AMBANG_OTOMATIS: pakai tanpa bertanya.
    Otomatis,
    /// Skor antara AMBANG_MINIMUM..AMBANG_OTOMATIS: pengguna memutuskan.
    Review,
    /// Skor < AMBANG_MINIMUM: dianggap tidak ada.
    TidakAda,
}

/// Penilaian satu kandidat.
#[derive(Debug, Clone)]
pub struct Penilaian {
    pub skor: f32,
    pub keputusan: Keputusan,
    /// Rincian untuk ditampilkan di layar review.
    pub alasan: Vec<String>,
}

/// Normalisasi teks untuk perbandingan.
///
/// Yang dibuang: tanda baca, kurung, penanda versi dalam kurung, dan spasi
/// berlebih. Yang DIPERTAHANKAN: huruf non-ASCII, karena judul Jepang/Korea
/// harus tetap bisa dicocokkan apa adanya.
fn normal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut dalam_kurung = false;
    for ch in s.chars() {
        match ch {
            '(' | '[' => dalam_kurung = true,
            ')' | ']' => dalam_kurung = false,
            _ if dalam_kurung => {}
            c if c.is_alphanumeric() => out.extend(c.to_lowercase()),
            c if c.is_whitespace() => out.push(' '),
            // Tanda baca lain dibuang, bukan dijadikan spasi: "Do I Wanna Know?"
            // harus jadi "do i wanna know", bukan "do i wanna know ".
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Penanda versi yang membedakan rekaman satu sama lain.
const PENANDA_VERSI: &[&str] = &[
    "live",
    "remix",
    "acoustic",
    "instrumental",
    "karaoke",
    "cover",
    "sped up",
    "slowed",
    "nightcore",
    "remaster",
    "remastered",
    "version",
    "edit",
    "demo",
];

fn punya_penanda_versi(s: &str) -> Option<&'static str> {
    let l = s.to_lowercase();
    PENANDA_VERSI.iter().find(|p| l.contains(*p)).copied()
}

/// Kemiripan dua string 0..1 berbasis kesamaan token (Jaccard) + bonus
/// substring.
///
/// Kenapa token, bukan Levenshtein: judul lagu sering berbeda panjang drastis
/// ("Creep" vs "Creep (Acoustic Version)"), dan Levenshtein menghukum itu
/// sebagai sangat berbeda padahal kata intinya sama.
fn kemiripan(a: &str, b: &str) -> f32 {
    let (na, nb) = (normal(a), normal(b));
    if na.is_empty() || nb.is_empty() {
        return 0.0;
    }
    if na == nb {
        return 1.0;
    }

    // Spasi tidak boleh membuat nama artis dianggap berbeda.
    //
    // Bukti dari impor nyata: Spotify menulis "PornoGraffitti", katalog YouTube
    // menulis "Porno Graffitti"; Spotify "Sukima Switch", katalog "SUKIMASWITCH".
    // Tanpa ini skor artis = 0, dan lagu yang judulnya sudah cocok persis tetap
    // gagal (skor total 0,42 < ambang 0,80).
    if na.replace(' ', "") == nb.replace(' ', "") {
        return 1.0;
    }

    let ta: std::collections::HashSet<&str> = na.split(' ').collect();
    let tb: std::collections::HashSet<&str> = nb.split(' ').collect();
    let irisan = ta.intersection(&tb).count() as f32;
    let gabungan = ta.union(&tb).count() as f32;
    let jaccard = if gabungan > 0.0 { irisan / gabungan } else { 0.0 };

    // Satu judul memuat judul lain ("creep" di dalam "creep acoustic"):
    // beri bonus supaya tidak dihukum oleh token tambahan.
    let substring = f32::from(na.contains(&nb) || nb.contains(&na));

    (jaccard * 0.7 + substring * 0.3).min(1.0)
}

/// Nilai satu kandidat terhadap lagu impor.
pub fn nilai(
    judul_impor: &str,
    artis_impor: &str,
    artis_lengkap: &str,
    durasi_impor: Option<i64>,
    k: &Kandidat,
) -> Penilaian {
    let mut alasan = Vec::new();

    let mut skor_judul = kemiripan(judul_impor, &k.judul);

    // Judul impor yang termuat UTUH di judul kandidat dianggap cocok penuh —
    // tapi HANYA kalau kandidat tidak membawa penanda versi yang tidak ada di
    // sumber.
    //
    // Kasus nyata yang ingin ditolong: katalog menambah terjemahan romaji
    // setelah judul asli, "メリッサ" menjadi "メリッサ - Melissa". Token
    // Jaccard menghukum token tambahan itu (0,65) padahal judul intinya utuh.
    //
    // Kasus yang TIDAK boleh ikut lolos: "Creep" vs "Creep (Acoustic Version)".
    // Di situ token tambahannya justru penanda versi — rekaman yang berbeda.
    // Tanpa penjagaan ini, substring bonus meloloskan versi acoustic/live
    // secara otomatis, dan tes regresinya langsung gagal.
    {
        let (ni, nk) = (normal(judul_impor), normal(&k.judul));
        let versi_impor = punya_penanda_versi(judul_impor);
        let versi_kandidat = punya_penanda_versi(&k.judul);
        let tambahan_bukan_versi = versi_impor == versi_kandidat;
        if !ni.is_empty()
            && !nk.is_empty()
            && ni != nk
            && (ni.contains(&nk) || nk.contains(&ni))
            && tambahan_bukan_versi
        {
            skor_judul = 1.0;
        }
    }
    let skor_artis = {
        // Bandingkan terhadap artis pertama DAN daftar lengkap; lagu feat
        // sering ditulis berbeda di YouTube ("X feat. Y" vs "X; Y").
        let a1 = kemiripan(artis_impor, &k.artis);
        let a2 = kemiripan(artis_lengkap, &k.artis);
        a1.max(a2)
    };

    // Judul lebih menentukan daripada artis: banyak kanal mengunggah ulang lagu
    // dengan nama artis yang sedikit berbeda, tapi judulnya tetap.
    let mut skor = skor_judul * 0.65 + skor_artis * 0.35;

    if skor_judul >= 0.99 {
        alasan.push("judul sama".into());
    } else if skor_judul >= 0.8 {
        alasan.push("judul mirip".into());
    } else {
        alasan.push("judul berbeda".into());
    }
    if skor_artis >= 0.99 {
        alasan.push("artis sama".into());
    } else if skor_artis >= 0.7 {
        alasan.push("artis mirip".into());
    } else {
        alasan.push("artis berbeda".into());
    }

    // Durasi: pembeda paling andal antara versi studio dan live/remix.
    // Selisih > 20 detik dari lagu asli hampir selalu rekaman berbeda.
    //
    // Bonus durasi TIDAK diberikan kalau penanda versi berbeda. Alasannya
    // terukur: "Creep" (239 s) vs "Creep (Acoustic Version)" (239 s) punya
    // durasi identik, jadi dapat +0,10 yang menutupi penalti versi -0,20 dan
    // skor akhirnya 0,90 — lolos otomatis padahal itu rekaman berbeda.
    // Durasi sama bukan bukti versi sama; penanda versi lebih menentukan.
    let versi_berbeda = {
        let vi = punya_penanda_versi(judul_impor);
        let vk = punya_penanda_versi(&k.judul);
        vi != vk
            && !matches!(vi, Some("remaster") | Some("remastered"))
            && !matches!(vk, Some("remaster") | Some("remastered"))
    };
    if let (Some(di), Some(dk)) = (durasi_impor, k.durasi_ms) {
        let selisih = (di - dk).abs();
        if selisih <= 5_000 && !versi_berbeda {
            skor += 0.10;
            alasan.push("durasi cocok".into());
        } else if selisih > 20_000 {
            skor -= 0.15;
            alasan.push(format!("durasi beda {}s", selisih / 1000));
        }
    }

    // Penanda versi: hanya diturunkan kalau penandanya BERBEDA.
    //
    // Versi sebelumnya menurunkan skor setiap kali salah satu pihak punya
    // penanda apa pun. Akibatnya "Exit Music (For A Film) - Remastered" yang
    // cocok persis dengan "Exit Music (For A Film)" hanya dapat 0,75 — padahal
    // remastered dan versi asli adalah rekaman yang sama untuk keperluan
    // mendengar. Yang benar-benar berbahaya adalah beda JENIS: studio vs live,
    // atau asli vs cover.
    let v_impor = punya_penanda_versi(judul_impor);
    let v_kandidat = punya_penanda_versi(&k.judul);
    if v_impor != v_kandidat {
        // "remaster" pada satu sisi saja tidak dihukum: itu varian rekaman
        // yang sama, bukan lagu berbeda.
        let hanya_remaster = matches!(v_impor, Some("remaster") | Some("remastered"))
            || matches!(v_kandidat, Some("remaster") | Some("remastered"));
        if !hanya_remaster {
            // 0,35 bukan 0,20: dengan judul dan artis sempurna (skor 1,0),
            // penalti 0,20 menyisakan 0,80 — tepat di ambang otomatis, jadi
            // versi acoustic/live tetap lolos. 0,35 menyisakan 0,65: masuk
            // "perlu diperiksa", bukan diterima diam-diam. Itu perilaku yang
            // benar — pengguna boleh memilihnya, tapi bukan otomatis.
            skor -= 0.35;
            alasan.push(match (v_impor, v_kandidat) {
                (None, Some(p)) => format!("kandidat versi {p}"),
                (Some(p), None) => format!("impor versi {p}, kandidat bukan"),
                _ => "penanda versi berbeda".into(),
            });
        }
    }

    let skor = skor.clamp(0.0, 1.0);
    let keputusan = if skor >= AMBANG_OTOMATIS {
        Keputusan::Otomatis
    } else if skor >= AMBANG_MINIMUM {
        Keputusan::Review
    } else {
        Keputusan::TidakAda
    };

    Penilaian {
        skor,
        keputusan,
        alasan,
    }
}

/// Nama keputusan dalam bahasa Indonesia, untuk log dan layar review.
pub fn sebut_keputusan(k: Keputusan) -> &'static str {
    match k {
        Keputusan::Otomatis => "otomatis",
        Keputusan::Review => "review",
        Keputusan::TidakAda => "tidak ada",
    }
}

/// Pilih kandidat terbaik dari daftar hasil pencarian.
pub fn pilih_terbaik(
    judul_impor: &str,
    artis_impor: &str,
    artis_lengkap: &str,
    durasi_impor: Option<i64>,
    kandidat: &[Kandidat],
) -> Option<(Kandidat, Penilaian)> {
    kandidat
        .iter()
        .map(|k| (k.clone(), nilai(judul_impor, artis_impor, artis_lengkap, durasi_impor, k)))
        .max_by(|a, b| {
            a.1.skor
                .partial_cmp(&b.1.skor)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kandidat(judul: &str, artis: &str, durasi: Option<i64>) -> Kandidat {
        Kandidat {
            video_id: "v".into(),
            judul: judul.into(),
            artis: artis.into(),
            durasi_ms: durasi,
        }
    }

    #[test]
    fn normalisasi_membuang_kurung_dan_tanda_baca() {
        assert_eq!(normal("Do I Wanna Know?"), "do i wanna know");
        assert_eq!(normal("Creep (Acoustic Version)"), "creep");
        assert_eq!(normal("Message In A Bottle (Taylor's Version) (From The Vault)"), "message in a bottle");
    }

    #[test]
    fn normalisasi_mempertahankan_non_ascii() {
        assert_eq!(normal("オトノケ - Otonoke"), "オトノケ otonoke");
    }

    #[test]
    fn judul_dan_artis_persis_skor_tinggi() {
        let k = kandidat("Creep", "Radiohead", Some(239_000));
        let p = nilai("Creep", "Radiohead", "Radiohead", Some(239_000), &k);
        assert!(p.skor >= 0.95, "skor {}", p.skor);
        assert_eq!(p.keputusan, Keputusan::Otomatis);
    }

    #[test]
    fn versi_live_tidak_diterima_otomatis() {
        // Yang diimpor versi studio, kandidat teratas versi live.
        let k = kandidat("Creep - Live at Coachella", "Radiohead", Some(267_000));
        let p = nilai("Creep", "Radiohead", "Radiohead", Some(239_000), &k);
        assert!(
            p.keputusan != Keputusan::Otomatis,
            "versi live tidak boleh lolos otomatis (skor {})",
            p.skor
        );
    }

    #[test]
    fn artis_berbeda_jatuh_ke_review_atau_tidak_ada() {
        let k = kandidat("Creep", "Glee Cast", Some(239_000));
        let p = nilai("Creep", "Radiohead", "Radiohead", Some(239_000), &k);
        assert!(p.skor < AMBANG_OTOMATIS);
    }

    #[test]
    fn durasi_beda_jauh_menurunkan_skor() {
        let cocok = nilai(
            "Creep",
            "Radiohead",
            "Radiohead",
            Some(239_000),
            &kandidat("Creep", "Radiohead", Some(240_000)),
        );
        let beda = nilai(
            "Creep",
            "Radiohead",
            "Radiohead",
            Some(239_000),
            &kandidat("Creep", "Radiohead", Some(330_000)),
        );
        assert!(cocok.skor > beda.skor, "durasi cocok harus lebih tinggi");
    }

    #[test]
    fn lagu_indonesia_cocok() {
        let k = kandidat("Secukupnya", "Hindia", Some(252_000));
        let p = nilai("Secukupnya", "Hindia", "Hindia", Some(252_000), &k);
        assert_eq!(p.keputusan, Keputusan::Otomatis);
    }

    #[test]
    fn judul_jepang_cocok() {
        let k = kandidat("オトノケ - Otonoke", "Creepy Nuts", Some(194_000));
        let p = nilai(
            "オトノケ - Otonoke",
            "Creepy Nuts",
            "Creepy Nuts",
            Some(194_000),
            &k,
        );
        assert_eq!(p.keputusan, Keputusan::Otomatis);
    }

    #[test]
    fn pilih_terbaik_memilih_skor_tertinggi() {
        let ks = vec![
            kandidat("Creep", "Glee Cast", Some(239_000)),
            kandidat("Creep", "Radiohead", Some(239_000)),
            kandidat("Creep (Live)", "Radiohead", Some(300_000)),
        ];
        let (k, p) = pilih_terbaik("Creep", "Radiohead", "Radiohead", Some(239_000), &ks).unwrap();
        assert_eq!(k.artis, "Radiohead");
        assert_eq!(p.keputusan, Keputusan::Otomatis);
    }

    #[test]
    fn judul_benar_benar_beda_tidak_ditemukan() {
        let k = kandidat("Blinding Lights", "The Weeknd", Some(200_000));
        let p = nilai("Secukupnya", "Hindia", "Hindia", Some(252_000), &k);
        assert_eq!(p.keputusan, Keputusan::TidakAda);
    }
    /// Regresi dari impor nyata: Spotify "PornoGraffitti" vs katalog
    /// "Porno Graffitti". Skor artis dulu 0 sehingga lagu yang judulnya sudah
    /// cocok persis tetap gagal (0,42 < ambang 0,80).
    #[test]
    fn artis_beda_spasi_dianggap_sama() {
        assert_eq!(kemiripan("PornoGraffitti", "Porno Graffitti"), 1.0);
        assert_eq!(kemiripan("Sukima Switch", "SUKIMASWITCH"), 1.0);
        let k = kandidat("メリッサ - Melissa", "Porno Graffitti", None);
        let p = nilai("メリッサ", "PornoGraffitti", "PornoGraffitti", None, &k);
        assert!(
            p.keputusan == Keputusan::Otomatis,
            "harus lolos otomatis, dapat {:?} skor {}",
            p.keputusan,
            p.skor
        );
    }

    /// Regresi: katalog menambah terjemahan romaji setelah judul asli.
    /// Jaccard menghukum token tambahan itu (0,65) padahal judul intinya utuh.
    #[test]
    fn judul_kanji_dengan_terjemahan_romaji_cocok() {
        let k = kandidat("ゴールデンタイムラバー - Golden Time Rubber", "SUKIMASWITCH", None);
        let p = nilai("ゴールデンタイムラバー", "Sukima Switch", "Sukima Switch", None, &k);
        assert!(
            p.keputusan == Keputusan::Otomatis,
            "harus lolos otomatis, dapat {:?} skor {}",
            p.keputusan,
            p.skor
        );
    }

    /// Yang TIDAK boleh berubah: substring tidak boleh meloloskan versi salah.
    /// "creep" termuat di "creep acoustic", tapi penanda versi tetap dihukum.
    #[test]
    fn substring_tidak_melonggarkan_penanda_versi() {
        let k = kandidat("Creep (Acoustic Version)", "Radiohead", Some(239_000));
        let p = nilai("Creep", "Radiohead", "Radiohead", Some(239_000), &k);
        assert!(
            p.keputusan != Keputusan::Otomatis,
            "versi acoustic tidak boleh lolos otomatis hanya karena substring (skor {})",
            p.skor
        );
    }

    /// Judul yang benar-benar berbeda tetap tidak cocok, walau salah satu
    /// memuat yang lain sebagai kebetulan token.
    #[test]
    fn judul_berbeda_tetap_skor_rendah() {
        let s = kemiripan("Tokio", "誰我為");
        assert!(s < 0.5, "judul berbeda harus skor rendah, dapat {s}");
    }

}