//! Klien LRCLIB (FEATURES-V3 §4 L5).
//!
//! Spesifikasi LRCLIB (https://lrclib.net/docs):
//! - Endpoint GET `/api/get` (pencocokan persis): `track_name`, `artist_name`, `duration` (detik).
//! - Endpoint GET `/api/search`: pencarian fleksibel (`q`, atau `track_name` + `artist_name`).
//! - Aturan privasi: jalur otomatis HANYA dipanggil saat setting `lirik.lrclib` bernilai `"1"`.
//!   Pencarian manual dipicu klik user, jadi tidak butuh setting itu.
//! - User-Agent sopan dan jujur: `Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)`.
//! - Timeout pendek per permintaan + anggaran total, penanganan error jinak.
//!
//! ## Kenapa modul ini punya lapisan sanitasi
//!
//! Track YouTube biasa (bukan `- Topic`) punya judul kotor dan nama channel yang
//! bukan nama artis: `【MV】Artis - Judul (Official Music Video)` diunggah channel
//! re-upload. `/api/get` dengan judul + channel seperti itu hampir selalu 404,
//! sementara nama artis asli justru ada di dalam judul. Modul ini membersihkan
//! metadata dulu, menurunkan beberapa kandidat kueri, lalu memilih hasil
//! `/api/search` lewat skor — bukan mengambil elemen pertama.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::time::{Duration, Instant};

const LRCLIB_API_BASE: &str = "https://lrclib.net/api";
const USER_AGENT: &str = "Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)";
const TIMEOUT_PERMINTAAN: Duration = Duration::from_secs(5);
/// Anggaran total untuk satu resolusi otomatis, supaya UI tidak menunggu terlalu lama.
const ANGGARAN_TOTAL: Duration = Duration::from_secs(12);
/// Batas jumlah permintaan HTTP per resolusi (termasuk dedup).
const MAKS_PERMINTAAN: usize = 10;
/// Skor minimum supaya kandidat `/api/search` dianggap layak dipakai.
const SKOR_MINIMUM: i32 = 40;
/// Batas hasil untuk panel pencarian manual.
const MAKS_HASIL_MANUAL: usize = 20;

#[derive(Debug, Clone, Deserialize)]
pub struct LrclibResponse {
    pub id: Option<i64>,
    #[serde(rename = "trackName")]
    pub track_name: Option<String>,
    #[serde(rename = "artistName")]
    pub artist_name: Option<String>,
    #[serde(rename = "albumName")]
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: Option<bool>,
    #[serde(rename = "plainLyrics")]
    pub plain_lyrics: Option<String>,
    #[serde(rename = "syncedLyrics")]
    pub synced_lyrics: Option<String>,
}

/// Metadata yang sudah dibersihkan, siap dipakai untuk membangun kueri.
#[derive(Debug, Clone, Serialize)]
pub struct MetadataLagu {
    /// Judul setelah tag video dibuang (masih mungkin memuat `Artis - `).
    pub judul_bersih: String,
    /// Nama channel setelah akhiran YouTube dibuang.
    pub artis_bersih: String,
    /// Artis hasil parser `Artis - Judul`, kalau ada.
    pub parsed_artist: Option<String>,
    /// Judul hasil parser `Artis - Judul`, kalau ada.
    pub parsed_title: Option<String>,
    /// Judul tanpa nama artis; ini yang dibandingkan saat skor.
    pub judul_saja: String,
}

/// Satu kandidat lirik untuk panel pencarian manual.
#[derive(Debug, Clone, Serialize)]
pub struct KandidatLirik {
    pub id: Option<i64>,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: Option<String>,
    pub duration: Option<f64>,
    pub instrumental: bool,
    /// `true` kalau lirik punya timestamp (LRC), `false` kalau teks polos.
    pub synced: bool,
    pub lrc: String,
}

/// Kata kunci yang menandai isi kurung sebagai noise video, bukan bagian judul.
const KATA_NOISE: &[&str] = &[
    "official",
    "music video",
    "mv",
    "m/v",
    "pv",
    "amv",
    "lyric",
    "lyrics",
    "audio",
    "visualizer",
    "hd",
    "4k",
    "hq",
    "full",
    "ver",
    "version",
    "short",
    "tv size",
    "live",
    "cover",
    "sub",
    "eng",
    "indo",
    "romaji",
    "kanji",
    "color coded",
    "ost",
    "ep",
    "theme",
    "teaser",
    "trailer",
];

/// Pasangan kurung yang dipakai judul YouTube: ASCII dan CJK.
const PASANGAN_KURUNG: &[(char, char)] = &[
    ('(', ')'),
    ('[', ']'),
    ('【', '】'),
    ('〔', '〕'),
    ('（', '）'),
];

/// Akhiran nama channel YouTube yang bukan bagian nama artis.
const AKHIRAN_ARTIS: &[&str] = &[
    "- topic",
    "official channel",
    "official",
    "vevo",
    "channel",
    "records",
    "music",
];

/// Pemisah `Artis - Judul` yang lazim, berurutan dari yang paling aman.
const PEMISAH: &[&str] = &[" - ", " – ", " — ", " | ", "｜"];

// ---------------------------------------------------------------------------
// 1. Sanitasi metadata
// ---------------------------------------------------------------------------

/// Membersihkan nama channel: `Artist - Topic` -> `Artist`, `Artist VEVO` -> `Artist`.
pub fn bersihkan_artis(mentah: &str) -> String {
    let mut hasil = mentah.trim().to_string();

    // Ulangi supaya "Artist Official Channel" ikut bersih, bukan cuma satu akhiran.
    for _ in 0..3 {
        let kecil = hasil.to_lowercase();
        let mut dipotong = false;
        for akhiran in AKHIRAN_ARTIS {
            if kecil.ends_with(akhiran) && kecil.len() > akhiran.len() {
                let sisa = &hasil[..hasil.len() - akhiran.len()];
                hasil = sisa.trim().to_string();
                dipotong = true;
                break;
            }
        }
        if !dipotong {
            break;
        }
    }

    rapikan_separator(&hasil)
}

/// Membersihkan judul video: buang kurung yang isinya noise, rapikan separator.
pub fn bersihkan_judul(judul: &str) -> String {
    rapikan_separator(&hapus_kurung_noise(judul))
}

/// Versi fallback: buang semua kurung, apa pun isinya.
pub fn bersihkan_judul_tanpa_kurung(judul: &str) -> String {
    rapikan_separator(&hapus_kurung(judul, None))
}

/// Membuang segmen berkurung yang isinya mengandung salah satu kata noise.
fn hapus_kurung_noise(judul: &str) -> String {
    hapus_kurung(judul, Some(KATA_NOISE))
}

/// `kata_kunci = None` berarti buang semua kurung tanpa memeriksa isinya.
fn hapus_kurung(judul: &str, kata_kunci: Option<&[&str]>) -> String {
    let chars: Vec<char> = judul.chars().collect();
    let mut out = String::with_capacity(judul.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        let pasangan = PASANGAN_KURUNG.iter().find(|(buka, _)| *buka == c);

        if let Some((_, tutup)) = pasangan {
            if let Some(offset) = chars[i + 1..].iter().position(|x| x == tutup) {
                let akhir = i + 1 + offset;
                let isi: String = chars[i + 1..akhir].iter().collect();
                let noise = match kata_kunci {
                    None => true,
                    Some(kunci) => {
                        let kecil = isi.to_lowercase();
                        kunci.iter().any(|k| kecil.contains(k))
                    }
                };
                if noise {
                    i = akhir + 1;
                    continue;
                }
            }
        }

        out.push(c);
        i += 1;
    }

    out
}

/// Membuang separator menggantung di pinggir dan merapikan spasi ganda.
fn rapikan_separator(teks: &str) -> String {
    let hasil = teks
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| {
            matches!(
                c,
                '|' | '-' | '–' | '—' | '~' | '/' | '\\' | ':' | '·' | '"' | '\'' | '「' | '」'
            )
        })
        .trim()
        .to_string();

    hasil.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Mencari pasangan `(artis, judul)` dari judul video.
///
/// Dua pola yang ditangani: `Artis - Judul` (pemisah ASCII) dan
/// `Artis「Judul」` (pola unggahan Jepang/Tiongkok).
pub fn parse_artis_judul(judul: &str) -> Option<(String, String)> {
    // Pola kutipan Jepang/Tiongkok: アーティスト「曲名」
    for (buka, tutup) in [('「', '」'), ('『', '』')] {
        if let Some(awal) = judul.find(buka) {
            if let Some(akhir_rel) = judul[awal..].find(tutup) {
                let akhir = awal + akhir_rel;
                let artis = judul[..awal].trim();
                let judul_lagu = judul[awal + buka.len_utf8()..akhir].trim();
                if sah_artis(artis) && !judul_lagu.is_empty() {
                    return Some((artis.to_string(), bersihkan_judul(judul_lagu)));
                }
            }
        }
    }

    for pemisah in PEMISAH {
        if let Some((kiri, kanan)) = judul.split_once(pemisah) {
            let artis = kiri.trim();
            let judul_lagu = kanan.trim();
            if sah_artis(artis) && !judul_lagu.is_empty() {
                return Some((artis.to_string(), bersihkan_judul(judul_lagu)));
            }
        }
    }

    None
}

/// Nama artis yang masuk akal: tidak kosong, tidak kepanjangan, dan bukan deskripsi.
fn sah_artis(artis: &str) -> bool {
    let jumlah = artis.chars().count();
    !artis.is_empty() && jumlah <= 60 && !artis.contains("http")
}

/// Membangun metadata lengkap dari judul + nama channel mentah.
pub fn metadata_lagu(judul: &str, artis: &str) -> MetadataLagu {
    let judul_bersih = bersihkan_judul(judul);
    let artis_bersih = bersihkan_artis(artis);
    let parsed = parse_artis_judul(&judul_bersih);

    let (parsed_artist, parsed_title) = match parsed {
        Some((a, t)) => (Some(a), Some(t)),
        None => (None, None),
    };

    let judul_saja = parsed_title.clone().unwrap_or_else(|| judul_bersih.clone());

    MetadataLagu {
        judul_bersih,
        artis_bersih,
        parsed_artist,
        parsed_title,
        judul_saja,
    }
}

// ---------------------------------------------------------------------------
// 2. Kandidat kueri
// ---------------------------------------------------------------------------

/// Kandidat pasangan `(judul, artis)` untuk `/api/get` dan `/api/search`.
///
/// Urutannya sengaja begini: track resmi YTM dulu, lalu hasil parser, lalu versi
/// terbalik (unggahan JP/KR/CN yang menaruh judul di depan).
pub fn kandidat_pasangan(meta: &MetadataLagu) -> Vec<(String, String)> {
    let mut hasil: Vec<(String, String)> = Vec::new();
    let mut kunci: HashSet<String> = HashSet::new();

    let mut tambah = |judul: &str, artis: &str| {
        let judul = judul.trim();
        let artis = artis.trim();
        if judul.is_empty() || artis.is_empty() {
            return;
        }
        let k = format!("{}\u{1}{}", judul.to_lowercase(), artis.to_lowercase());
        if kunci.insert(k) {
            hasil.push((judul.to_string(), artis.to_string()));
        }
    };

    // 1. Jalur resmi YouTube Music.
    tambah(&meta.judul_bersih, &meta.artis_bersih);

    // 2. Hasil parser `Artis - Judul`.
    if let (Some(a), Some(t)) = (&meta.parsed_artist, &meta.parsed_title) {
        tambah(t, a);
        // 3. Versi terbalik untuk unggahan yang menaruh judul lebih dulu.
        tambah(a, t);
        // 4. Judul bersih + artis hasil parser (channel uploader tetap dipakai
        //    kalau judulnya tidak memuat nama artis).
        tambah(&meta.judul_bersih, a);
    }

    // 5. Judul tanpa semua kurung, sebagai upaya terakhir.
    let tanpa_kurung = bersihkan_judul_tanpa_kurung(&meta.judul_bersih);
    if tanpa_kurung != meta.judul_bersih {
        tambah(&tanpa_kurung, &meta.artis_bersih);
        if let Some(a) = &meta.parsed_artist {
            tambah(&tanpa_kurung, a);
        }
    }

    hasil
}

/// Kueri bebas `q=` untuk `/api/search`, dari yang paling spesifik.
pub fn kandidat_kueri(meta: &MetadataLagu) -> Vec<String> {
    let mut hasil: Vec<String> = Vec::new();
    let mut kunci: HashSet<String> = HashSet::new();

    let mut tambah = |teks: String| {
        let teks = teks.split_whitespace().collect::<Vec<_>>().join(" ");
        if teks.is_empty() {
            return;
        }
        if kunci.insert(teks.to_lowercase()) {
            hasil.push(teks);
        }
    };

    tambah(format!("{} {}", meta.artis_bersih, meta.judul_bersih));

    if let (Some(a), Some(t)) = (&meta.parsed_artist, &meta.parsed_title) {
        tambah(format!("{t} {a}"));
        tambah(format!("{a} {t}"));
    }

    // Judul saja: penting untuk channel uploader/game yang namanya tidak relevan.
    tambah(meta.judul_saja.clone());
    if meta.judul_saja != meta.judul_bersih {
        tambah(meta.judul_bersih.clone());
    }

    hasil
}

// ---------------------------------------------------------------------------
// 3. Skor kandidat
// ---------------------------------------------------------------------------

/// Menormalkan teks untuk perbandingan: huruf kecil, tanpa tanda baca, spasi rapi.
fn normalisasi(teks: &str) -> String {
    let mut out = String::with_capacity(teks.len());
    for c in teks.chars() {
        if c.is_alphanumeric() {
            for kecil in c.to_lowercase() {
                out.push(kecil);
            }
        } else if c.is_whitespace() {
            out.push(' ');
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn teks_lirik(item: &LrclibResponse) -> Option<(&str, bool)> {
    if let Some(synced) = item.synced_lyrics.as_deref() {
        if !synced.trim().is_empty() {
            return Some((synced, true));
        }
    }
    if let Some(plain) = item.plain_lyrics.as_deref() {
        if !plain.trim().is_empty() {
            return Some((plain, false));
        }
    }
    None
}

/// Skor kelayakan kandidat `/api/search`.
///
/// Format lirik menang dulu (synced > plain), lalu kemiripan judul/artis, lalu
/// durasi sebagai penalti lunak — MV dengan intro/outro panjang tidak dibuang,
/// hanya turun peringkat.
pub fn skor_kandidat(item: &LrclibResponse, meta: &MetadataLagu, durasi: Option<f64>) -> i32 {
    let Some((_, synced)) = teks_lirik(item) else {
        return i32::MIN;
    };

    let mut skor = if synced { 50 } else { 15 };

    if item.instrumental == Some(true) {
        skor -= 60;
    }

    let judul = normalisasi(item.track_name.as_deref().unwrap_or(""));
    let target_saja = normalisasi(&meta.judul_saja);
    let target_penuh = normalisasi(&meta.judul_bersih);

    if !judul.is_empty() {
        if judul == target_saja || judul == target_penuh {
            skor += 40;
        } else if cocok_sebagian(&judul, &target_saja) || cocok_sebagian(&judul, &target_penuh) {
            skor += 25;
        }
    }

    let artis = normalisasi(item.artist_name.as_deref().unwrap_or(""));
    if !artis.is_empty() {
        let target_artis = [
            normalisasi(&meta.artis_bersih),
            meta.parsed_artist
                .as_deref()
                .map(normalisasi)
                .unwrap_or_default(),
        ];
        if target_artis.iter().any(|t| !t.is_empty() && *t == artis) {
            skor += 25;
        } else if target_artis.iter().any(|t| cocok_sebagian(&artis, t)) {
            skor += 15;
        }
    }

    if let (Some(target), Some(kandidat)) = (durasi, item.duration) {
        if target > 0.0 && kandidat > 0.0 {
            let selisih = (target - kandidat).abs();
            skor += if selisih <= 5.0 {
                25
            } else if selisih <= 15.0 {
                10
            } else if selisih <= 35.0 {
                0
            } else if selisih > 60.0 {
                -30
            } else {
                0
            };
        }
    }

    skor
}

/// Kecocokan longgar, tapi tidak untuk target kosong.
fn cocok_sebagian(a: &str, b: &str) -> bool {
    !a.is_empty() && !b.is_empty() && (a.contains(b) || b.contains(a))
}

/// Pilih kandidat terbaik. Instrumental diabaikan selama masih ada pilihan lain.
fn pilih_terbaik<'a>(
    items: &'a [LrclibResponse],
    meta: &MetadataLagu,
    durasi: Option<f64>,
    abaikan_instrumental: bool,
) -> Option<&'a LrclibResponse> {
    items
        .iter()
        .filter(|it| !abaikan_instrumental || it.instrumental != Some(true))
        .map(|it| (skor_kandidat(it, meta, durasi), it))
        .filter(|(skor, _)| *skor >= SKOR_MINIMUM)
        .max_by_key(|(skor, it)| (*skor, it.synced_lyrics.is_some() as i32))
        .map(|(_, it)| it)
}

fn cari_yang_layak<'a>(
    items: &'a [LrclibResponse],
    meta: &MetadataLagu,
    durasi: Option<f64>,
) -> Option<&'a LrclibResponse> {
    pilih_terbaik(items, meta, durasi, true).or_else(|| pilih_terbaik(items, meta, durasi, false))
}

// ---------------------------------------------------------------------------
// 4. Waterfall resolusi otomatis
// ---------------------------------------------------------------------------

/// Mengambil lirik dari LRCLIB untuk satu track.
///
/// Bertingkat: `/api/get` (track resmi) -> `/api/search` per pasangan -> `q=`
/// bebas. Berhenti di tahap pertama yang menghasilkan kandidat layak.
pub async fn fetch_lrclib(
    title: &str,
    artist: &str,
    duration_secs: Option<f64>,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT_PERMINTAAN)
        .build()
        .map_err(|e| format!("Gagal inisialisasi HTTP client: {e}"))?;

    let meta = metadata_lagu(title, artist);
    let mulai = Instant::now();
    let mut jumlah = 0usize;
    let mut sudah: HashSet<String> = HashSet::new();

    // Tahap 1: /api/get, pencocokan persis dengan durasi bulat.
    for (judul, artis) in kandidat_pasangan(&meta) {
        if jumlah >= MAKS_PERMINTAAN || mulai.elapsed() > ANGGARAN_TOTAL {
            break;
        }
        jumlah += 1;

        let durasi_teks;
        let mut query: Vec<(&str, &str)> = vec![("track_name", &judul), ("artist_name", &artis)];
        if let Some(d) = duration_secs.filter(|d| *d > 0.0) {
            durasi_teks = format!("{}", d.round() as i64);
            query.push(("duration", &durasi_teks));
        }

        let kunci = format!("get?{judul}\u{1}{artis}");
        if !sudah.insert(kunci) {
            continue;
        }

        let Ok(res) = client
            .get(format!("{LRCLIB_API_BASE}/get"))
            .query(&query)
            .send()
            .await
        else {
            continue;
        };
        if !res.status().is_success() {
            continue;
        }
        let Ok(data) = res.json::<LrclibResponse>().await else {
            continue;
        };
        if let Some((teks, _)) = teks_lirik(&data) {
            return Ok(Some(teks.trim().to_string()));
        }
    }

    // Tahap 2: /api/search dengan track_name + artist_name (tanpa durasi ketat).
    for (judul, artis) in kandidat_pasangan(&meta) {
        if let Some(teks) = cari_dan_pilih(
            &client,
            &[("track_name", &judul), ("artist_name", &artis)],
            &meta,
            duration_secs,
            &mut sudah,
            &mut jumlah,
            mulai,
        )
        .await
        {
            return Ok(Some(teks));
        }
    }

    // Tahap 3: kueri bebas `q=`, termasuk judul saja tanpa nama channel.
    for q in kandidat_kueri(&meta) {
        if let Some(teks) = cari_dan_pilih(
            &client,
            &[("q", &q)],
            &meta,
            duration_secs,
            &mut sudah,
            &mut jumlah,
            mulai,
        )
        .await
        {
            return Ok(Some(teks));
        }
    }

    Ok(None)
}

#[allow(clippy::too_many_arguments)]
async fn cari_dan_pilih(
    client: &reqwest::Client,
    params: &[(&str, &str)],
    meta: &MetadataLagu,
    durasi: Option<f64>,
    sudah: &mut HashSet<String>,
    jumlah: &mut usize,
    mulai: Instant,
) -> Option<String> {
    if *jumlah >= MAKS_PERMINTAAN || mulai.elapsed() > ANGGARAN_TOTAL {
        return None;
    }

    let kunci = format!(
        "search?{}",
        params
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("&")
    );
    if !sudah.insert(kunci) {
        return None;
    }
    *jumlah += 1;

    let res = client
        .get(format!("{LRCLIB_API_BASE}/search"))
        .query(params)
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let items = res.json::<Vec<LrclibResponse>>().await.ok()?;

    cari_yang_layak(&items, meta, durasi)
        .and_then(teks_lirik)
        .map(|(teks, _)| teks.trim().to_string())
}

// ---------------------------------------------------------------------------
// 5. Pencarian manual (panel CARI LIRIK)
// ---------------------------------------------------------------------------

/// Mencari kandidat lirik untuk panel manual.
///
/// Dipicu klik user, jadi tidak butuh setting opt-in. Hasil sudah diurutkan
/// dengan skor yang sama seperti jalur otomatis, sehingga item teratas adalah
/// yang paling mungkin cocok.
pub async fn cari_lrclib(
    query: &str,
    duration_secs: Option<f64>,
) -> Result<Vec<KandidatLirik>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(TIMEOUT_PERMINTAAN)
        .build()
        .map_err(|e| format!("Gagal inisialisasi HTTP client: {e}"))?;

    let res = client
        .get(format!("{LRCLIB_API_BASE}/search"))
        .query(&[("q", q)])
        .send()
        .await
        .map_err(|e| format!("Gagal menghubungi LRCLIB: {e}"))?;

    if !res.status().is_success() {
        return Err(format!(
            "LRCLIB menolak permintaan (HTTP {})",
            res.status().as_u16()
        ));
    }

    let items = res
        .json::<Vec<LrclibResponse>>()
        .await
        .map_err(|e| format!("Respons LRCLIB tidak dapat dibaca: {e}"))?;

    // Metadata dari kueri dipakai sebagai pembanding skor.
    let meta = metadata_lagu(q, "");

    let mut hasil: Vec<(i32, KandidatLirik)> = items
        .into_iter()
        .filter_map(|item| {
            let (teks, synced) = teks_lirik(&item)?;
            // Kloning dulu supaya pinjaman ke `item` berakhir sebelum field-nya dipindah.
            let lrc = teks.trim().to_string();
            let skor = skor_kandidat(&item, &meta, duration_secs);
            Some((
                skor,
                KandidatLirik {
                    id: item.id,
                    track_name: item.track_name.unwrap_or_default(),
                    artist_name: item.artist_name.unwrap_or_default(),
                    album_name: item.album_name,
                    duration: item.duration,
                    instrumental: item.instrumental.unwrap_or(false),
                    synced,
                    lrc,
                },
            ))
        })
        .collect();

    hasil.sort_by_key(|(skor, _)| -skor);
    hasil.truncate(MAKS_HASIL_MANUAL);

    Ok(hasil.into_iter().map(|(_, k)| k).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kandidat(
        judul: &str,
        artis: &str,
        durasi: f64,
        synced: Option<&str>,
        instrumental: bool,
    ) -> LrclibResponse {
        LrclibResponse {
            id: None,
            track_name: Some(judul.to_string()),
            artist_name: Some(artis.to_string()),
            album_name: None,
            duration: Some(durasi),
            instrumental: Some(instrumental),
            plain_lyrics: if synced.is_none() {
                Some("lirik polos".to_string())
            } else {
                None
            },
            synced_lyrics: synced.map(str::to_string),
        }
    }

    #[test]
    fn test_bersihkan_artis() {
        assert_eq!(bersihkan_artis("Artist - Topic"), "Artist");
        assert_eq!(bersihkan_artis("Artist VEVO"), "Artist");
        assert_eq!(bersihkan_artis("Artist Official"), "Artist");
        assert_eq!(bersihkan_artis("Artist Official Channel"), "Artist");
        assert_eq!(bersihkan_artis("Sony Music"), "Sony");
        assert_eq!(bersihkan_artis("  mr kitty  "), "mr kitty");
    }

    #[test]
    fn test_bersihkan_judul() {
        assert_eq!(
            bersihkan_judul("【MV】YOASOBI - Racing into the Night (Official Music Video)"),
            "YOASOBI - Racing into the Night"
        );
        assert_eq!(
            bersihkan_judul("house of memories [4K] [Lyrics]"),
            "house of memories"
        );
        assert_eq!(bersihkan_judul("Song (Short Ver.)"), "Song");
        assert_eq!(bersihkan_judul("Song 〔TV size〕"), "Song");
        // Kurung yang bukan noise dipertahankan.
        assert_eq!(
            bersihkan_judul("Song (feat. Hatsune Miku)"),
            "Song (feat. Hatsune Miku)"
        );
        assert_eq!(bersihkan_judul("| Song |"), "Song");
    }

    #[test]
    fn test_bersihkan_judul_tanpa_kurung() {
        assert_eq!(
            bersihkan_judul_tanpa_kurung("Song (feat. Hatsune Miku) [MV]"),
            "Song"
        );
    }

    #[test]
    fn test_parse_artis_judul() {
        assert_eq!(
            parse_artis_judul("YOASOBI - Racing into the Night"),
            Some(("YOASOBI".to_string(), "Racing into the Night".to_string()))
        );
        assert_eq!(
            parse_artis_judul("Panic! At The Disco — House of Memories"),
            Some((
                "Panic! At The Disco".to_string(),
                "House of Memories".to_string()
            ))
        );
        assert_eq!(
            parse_artis_judul("YOASOBI「夜に駆ける」"),
            Some(("YOASOBI".to_string(), "夜に駆ける".to_string()))
        );
        assert_eq!(parse_artis_judul("Just a Title"), None);
    }

    #[test]
    fn test_kandidat_pasangan_urutan() {
        let meta = metadata_lagu(
            "【MV】mr kitty - after dark (Official Music Video)",
            "bluuthetic",
        );
        let pasangan = kandidat_pasangan(&meta);
        // Jalur resmi dulu: judul bersih + nama channel.
        assert_eq!(
            pasangan[0],
            (
                "mr kitty - after dark".to_string(),
                "bluuthetic".to_string()
            )
        );
        // Lalu hasil parser, lalu versi terbalik.
        assert!(pasangan.contains(&("after dark".to_string(), "mr kitty".to_string())));
        assert!(pasangan.contains(&("mr kitty".to_string(), "after dark".to_string())));
    }

    #[test]
    fn test_kandidat_kueri_menyertakan_judul_saja() {
        let meta = metadata_lagu("Mr Kitty - After Dark [MV]", "Some Game Channel");
        let kueri: Vec<String> = kandidat_kueri(&meta)
            .into_iter()
            .map(|k| k.to_lowercase())
            .collect();
        assert!(kueri.contains(&"after dark".to_string()));
        assert!(kueri.contains(&"mr kitty after dark".to_string()));
    }

    #[test]
    fn test_skor_synced_menang_atas_plain() {
        let meta = metadata_lagu("Artist - Song", "Artist - Topic");
        let durasi = Some(200.0);
        let synced = kandidat("Song", "Artist", 201.0, Some("[00:01.00]lirik"), false);
        let plain = kandidat("Song", "Artist", 201.0, None, false);
        assert!(skor_kandidat(&synced, &meta, durasi) > skor_kandidat(&plain, &meta, durasi));
    }

    #[test]
    fn test_skor_durasi_lunak_bukan_tolak() {
        let meta = metadata_lagu("Artist - Song", "Artist");
        let dekat = kandidat("Song", "Artist", 200.0, Some("[00:01.00]x"), false);
        let mv = kandidat("Song", "Artist", 225.0, Some("[00:01.00]x"), false);
        let jauh = kandidat("Song", "Artist", 300.0, Some("[00:01.00]x"), false);
        let skor_dekat = skor_kandidat(&dekat, &meta, Some(200.0));
        let skor_mv = skor_kandidat(&mv, &meta, Some(200.0));
        let skor_jauh = skor_kandidat(&jauh, &meta, Some(200.0));
        assert!(skor_dekat > skor_mv);
        assert!(skor_mv > skor_jauh);
        // MV dengan intro 25 detik tetap layak.
        assert!(skor_mv >= SKOR_MINIMUM);
    }

    #[test]
    fn test_instrumental_diabaikan() {
        let meta = metadata_lagu("Artist - Song", "Artist");
        let items = vec![
            kandidat("Song", "Artist", 200.0, Some("[00:01.00]x"), true),
            kandidat("Song", "Artist", 200.0, None, false),
        ];
        let terpilih = cari_yang_layak(&items, &meta, Some(200.0)).expect("ada kandidat");
        assert_eq!(terpilih.instrumental, Some(false));
    }

    #[test]
    fn test_tidak_ada_lirik_ditolak() {
        let meta = metadata_lagu("Artist - Song", "Artist");
        let kosong = LrclibResponse {
            id: None,
            track_name: Some("Song".into()),
            artist_name: Some("Artist".into()),
            album_name: None,
            duration: Some(200.0),
            instrumental: Some(true),
            plain_lyrics: None,
            synced_lyrics: None,
        };
        assert_eq!(skor_kandidat(&kosong, &meta, Some(200.0)), i32::MIN);
        assert!(cari_yang_layak(&[kosong], &meta, Some(200.0)).is_none());
    }
}
