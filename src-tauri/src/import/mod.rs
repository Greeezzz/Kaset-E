//! Import playlist dari berkas pihak ketiga (Fase 5).
//!
//! Format yang didukung: CSV hasil ekspor Spotify (Exportify) dan CSV/JSON
//! generik dengan kolom judul/artis. Yang TIDAK didukung: API langsung ke
//! layanan streaming — aturan AGENTS.md, dan tidak perlu karena berkas ekspor
//! sudah cukup.
//!
//! Pencocokan ke YouTube TIDAK terjadi di sini. Modul ini hanya membaca berkas
//! jadi daftar `LaguImport`; pencarian katalog dan penskoran ada di
//! `commands::import`, supaya parsing bisa diuji tanpa jaringan.

pub mod cocok;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Satu lagu hasil baca berkas, belum tentu ada di YouTube.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaguImport {
    /// Judul dari berkas. Bisa mengandung penanda versi ("- Remastered 2011").
    pub judul: String,
    /// Artis pertama saja untuk pencarian, tapi `artis_lengkap` menyimpan semua.
    pub artis: String,
    /// Semua artis dipisah "; " — dipakai saat penskoran.
    pub artis_lengkap: String,
    pub album: Option<String>,
    pub durasi_ms: Option<i64>,
    /// Baris asli, untuk pesan galat yang bisa ditindaklanjuti pengguna.
    pub baris: usize,
}

/// Batas jumlah lagu per impor. Bukan batas teknis: 10.000 baris akan memakan
/// ~1 jam pencarian dan hampir pasti bukan keinginan pengguna.
pub const MAKS_LAGU: usize = 5_000;

/// Baca CSV hasil ekspor Spotify (Exportify) atau CSV generik.
///
/// Kolom yang dikenali (nama persis dari Exportify): `Track Name`,
/// `Artist Name(s)`, `Album Name`, `Duration (ms)`. Untuk CSV lain, dicari
/// alias umum (`title`, `name`, `artist`, `artists`, ...).
pub fn parse_csv(isi: &str) -> AppResult<Vec<LaguImport>> {
    // BOM UTF-8 sering ikut di berkas ekspor Windows/Excel. Tanpa dibuang,
    // nama kolom pertama jadi "\u{feff}Track Name" dan tidak pernah cocok.
    let isi = isi.strip_prefix('\u{feff}').unwrap_or(isi);

    let mut rdr = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(isi.as_bytes());

    let header = rdr
        .headers()
        .map_err(|e| AppError::invalid(format!("header CSV tidak terbaca: {e}")))?
        .clone();

    let kolom = Kolom::deteksi(&header)?;

    let mut out = Vec::new();
    for (i, rec) in rdr.records().enumerate() {
        let rec = match rec {
            Ok(r) => r,
            // Baris rusak dilewati, bukan menggagalkan seluruh impor: satu baris
            // janggal dari 461 tidak boleh membatalkan semuanya.
            Err(_) => continue,
        };
        let nomor = i + 2; // +2: baris 1 header, dan manusia mulai dari 1

        let judul = rec.get(kolom.judul).unwrap_or("").trim().to_string();
        let artis_lengkap = rec.get(kolom.artis).unwrap_or("").trim().to_string();
        if judul.is_empty() || artis_lengkap.is_empty() {
            continue;
        }

        let album = kolom
            .album
            .and_then(|k| rec.get(k))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let durasi_ms = kolom
            .durasi
            .and_then(|k| rec.get(k))
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|d| *d > 0);

        out.push(LaguImport {
            judul,
            artis: artis_utama(&artis_lengkap),
            artis_lengkap,
            album,
            durasi_ms,
            baris: nomor,
        });

        if out.len() >= MAKS_LAGU {
            break;
        }
    }

    if out.is_empty() {
        return Err(AppError::invalid(
            "tidak ada lagu yang terbaca — pastikan berkas punya kolom judul dan artis",
        ));
    }
    Ok(out)
}

/// Baca JSON: array of object, atau objek dengan kunci `tracks`/`items`.
///
/// Bentuk yang diterima sengaja longgar — banyak alat ekspor memakai nama kunci
/// berbeda. Yang penting tiap objek punya judul dan artis.
pub fn parse_json(isi: &str) -> AppResult<Vec<LaguImport>> {
    let root: serde_json::Value = serde_json::from_str(isi)
        .map_err(|e| AppError::invalid(format!("JSON tidak valid: {e}")))?;

    let arr = if let Some(a) = root.as_array() {
        a.clone()
    } else {
        // Cari array pertama di antara kunci yang lazim.
        ["tracks", "items", "songs", "data"]
            .iter()
            .find_map(|k| root.get(*k).and_then(|v| v.as_array()).cloned())
            .ok_or_else(|| {
                AppError::invalid("JSON harus berisi array lagu, atau kunci tracks/items/songs")
            })?
    };

    let mut out = Vec::new();
    for (i, v) in arr.iter().enumerate() {
        let judul = ambil_str(v, &["title", "name", "trackName", "track", "song"]);
        let artis_lengkap = ambil_str(v, &["artist", "artists", "artistName", "artistsName"]);
        let (Some(judul), Some(artis_lengkap)) = (judul, artis_lengkap) else {
            continue;
        };
        if judul.trim().is_empty() || artis_lengkap.trim().is_empty() {
            continue;
        }
        let album = ambil_str(v, &["album", "albumName"]);
        let durasi_ms = ambil_i64(v, &["durationMs", "duration_ms", "duration", "durationMillis"])
            .filter(|d| *d > 0);

        out.push(LaguImport {
            judul: judul.trim().to_string(),
            artis: artis_utama(&artis_lengkap),
            artis_lengkap: artis_lengkap.trim().to_string(),
            album,
            durasi_ms,
            baris: i + 1,
        });
        if out.len() >= MAKS_LAGU {
            break;
        }
    }

    if out.is_empty() {
        return Err(AppError::invalid("tidak ada lagu yang terbaca dari JSON"));
    }
    Ok(out)
}

/// Pilih parser berdasarkan isi, bukan ekstensi nama berkas: pengguna sering
/// mengganti nama `.json` jadi `.txt` dan sebaliknya.
pub fn parse_otomatis(isi: &str) -> AppResult<Vec<LaguImport>> {
    let awal = isi.trim_start_matches('\u{feff}').trim_start();
    if awal.starts_with('[') || awal.starts_with('{') {
        parse_json(isi)
    } else {
        parse_csv(isi)
    }
}

/// Artis pertama dari daftar bertanda `;` atau `,`.
///
/// Pencarian katalog memakai satu artis: "Daniel Caesar;H.E.R." sebagai kata
/// kunci utuh hampir tidak pernah menghasilkan apa pun, sementara "Daniel
/// Caesar" menghasilkan lagu yang benar.
fn artis_utama(s: &str) -> String {
    s.split([';', ','])
        .map(str::trim)
        .find(|p| !p.is_empty())
        .unwrap_or(s)
        .to_string()
}

fn ambil_str(v: &serde_json::Value, kunci: &[&str]) -> Option<String> {
    for k in kunci {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            return Some(s.to_string());
        }
        // Artis kadang berupa array objek: [{name: "..."}]
        if let Some(a) = v.get(*k).and_then(|x| x.as_array()) {
            let nama: Vec<String> = a
                .iter()
                .filter_map(|x| {
                    x.as_str()
                        .map(str::to_string)
                        .or_else(|| x.get("name").and_then(|n| n.as_str()).map(str::to_string))
                })
                .collect();
            if !nama.is_empty() {
                return Some(nama.join("; "));
            }
        }
    }
    None
}

fn ambil_i64(v: &serde_json::Value, kunci: &[&str]) -> Option<i64> {
    for k in kunci {
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()) {
            return Some(n);
        }
        if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
            return Some(n as i64);
        }
        // Durasi kadang berupa string "3:45".
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if let Some(ms) = durasi_dari_teks(s) {
                return Some(ms);
            }
        }
    }
    None
}

/// "3:45" atau "225" → milidetik.
fn durasi_dari_teks(s: &str) -> Option<i64> {
    let s = s.trim();
    if let Some((m, d)) = s.split_once(':') {
        let m: i64 = m.parse().ok()?;
        let d: i64 = d.parse().ok()?;
        return Some((m * 60 + d) * 1000);
    }
    s.parse::<i64>().ok().map(|n| n * 1000)
}

/// Kolom yang ditemukan di header CSV.
struct Kolom {
    judul: usize,
    artis: usize,
    album: Option<usize>,
    durasi: Option<usize>,
}

impl Kolom {
    fn deteksi(header: &csv::StringRecord) -> AppResult<Self> {
        let cari = |alias: &[&str]| -> Option<usize> {
            header.iter().position(|h| {
                let h = h.trim().to_ascii_lowercase();
                alias.iter().any(|a| h == *a)
            })
        };

        let judul = cari(&["track name", "title", "name", "track", "song", "judul"])
            .ok_or_else(|| AppError::invalid("kolom judul tidak ditemukan (Track Name / title)"))?;
        let artis = cari(&[
            "artist name(s)",
            "artist",
            "artists",
            "artist name",
            "artis",
        ])
        .ok_or_else(|| AppError::invalid("kolom artis tidak ditemukan (Artist Name(s) / artist)"))?;

        Ok(Self {
            judul,
            artis,
            album: cari(&["album name", "album", "release"]),
            durasi: cari(&["duration (ms)", "duration_ms", "durationms", "durasi"]),
        })
    }
}

/// Buang lagu yang judul+artisnya sama persis (case-insensitive).
///
/// Playlist Spotify boleh berisi lagu yang sama dua kali; mengimpor keduanya
/// berarti dua pencarian katalog untuk hasil yang sama.
pub fn dedupe(lagu: Vec<LaguImport>) -> Vec<LaguImport> {
    let mut sudah = HashSet::new();
    lagu.into_iter()
        .filter(|l| {
            let k = format!(
                "{}|{}",
                l.judul.trim().to_lowercase(),
                l.artis_lengkap.trim().to_lowercase()
            );
            sudah.insert(k)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Header asli Exportify (dipotong ke kolom yang dipakai).
    const CONTOH: &str = "Track URI,ISRC,Track Name,Album Name,Artist Name(s),Duration (ms)\n\
spotify:track:40GRJ,US23A15,\"Untitled\",\"Apricot Princess\",\"Rex Orange County\",135706\n\
spotify:track:3SxSrU,USRC119,\"Always\",\"Pony\",\"Rex Orange County\",197330\n";

    #[test]
    fn baca_csv_exportify() {
        let l = parse_csv(CONTOH).expect("harus terbaca");
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].judul, "Untitled");
        assert_eq!(l[0].artis, "Rex Orange County");
        assert_eq!(l[0].album.as_deref(), Some("Apricot Princess"));
        assert_eq!(l[0].durasi_ms, Some(135706));
        assert_eq!(l[0].baris, 2, "baris 1 adalah header");
    }

    #[test]
    fn bom_utf8_tidak_merusak_header() {
        // Berkas ekspor Windows sering diawali BOM. Tanpa dibuang, kolom
        // pertama jadi "\u{feff}Track Name" dan tidak pernah cocok.
        let dengan_bom = format!("\u{feff}{CONTOH}");
        let l = parse_csv(&dengan_bom).expect("BOM harus ditangani");
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].judul, "Untitled");
    }

    #[test]
    fn artis_ganda_diambil_yang_pertama() {
        let csv = "Track Name,Artist Name(s)\n\
Lagu Satu,\"Daniel Caesar;H.E.R.\"\n";
        let l = parse_csv(csv).unwrap();
        assert_eq!(l[0].artis, "Daniel Caesar");
        assert_eq!(l[0].artis_lengkap, "Daniel Caesar;H.E.R.");
    }

    #[test]
    fn baris_tanpa_judul_dilewati() {
        let csv = "Track Name,Artist Name(s)\n\
,Lagu Tanpa Judul\n\
Ada Judul,Ada Artis\n";
        let l = parse_csv(csv).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].judul, "Ada Judul");
    }

    #[test]
    fn kolom_hilang_memberi_pesan_jelas() {
        let csv = "Album,Popularity\nX,5\n";
        let e = parse_csv(csv).unwrap_err();
        assert!(format!("{e}").contains("judul"), "pesan harus menyebut judul");
    }

    #[test]
    fn judul_non_ascii_tetap_utuh() {
        let csv = "Track Name,Artist Name(s)\n\
オトノケ - Otonoke,Creepy Nuts\n";
        let l = parse_csv(csv).unwrap();
        assert_eq!(l[0].judul, "オトノケ - Otonoke");
    }

    #[test]
    fn json_array_objek() {
        let j = r#"[{"title":"Creep","artist":"Radiohead","album":"Pablo Honey","duration":239000}]"#;
        let l = parse_json(j).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].judul, "Creep");
        assert_eq!(l[0].durasi_ms, Some(239000));
    }

    #[test]
    fn json_dengan_kunci_tracks_dan_artis_array() {
        let j = r#"{"tracks":[{"name":"Creep","artists":[{"name":"Radiohead"},{"name":"Guest"}]}]}"#;
        let l = parse_json(j).unwrap();
        assert_eq!(l[0].judul, "Creep");
        assert_eq!(l[0].artis, "Radiohead");
        assert_eq!(l[0].artis_lengkap, "Radiohead; Guest");
    }

    #[test]
    fn durasi_teks_menit_detik() {
        let j = r#"[{"title":"X","artist":"Y","duration":"3:45"}]"#;
        let l = parse_json(j).unwrap();
        assert_eq!(l[0].durasi_ms, Some(225_000));
    }

    #[test]
    fn deteksi_otomatis_memilih_parser_benar() {
        assert_eq!(parse_otomatis(CONTOH).unwrap().len(), 2);
        assert_eq!(
            parse_otomatis(r#"[{"title":"A","artist":"B"}]"#).unwrap().len(),
            1
        );
    }

    #[test]
    fn dedupe_membuang_kembar_tanpa_peduli_huruf() {
        let mk = |j: &str, a: &str| LaguImport {
            judul: j.into(),
            artis: a.into(),
            artis_lengkap: a.into(),
            album: None,
            durasi_ms: None,
            baris: 0,
        };
        let l = dedupe(vec![mk("Creep", "Radiohead"), mk("creep", "radiohead"), mk("Creep", "Glee")]);
        assert_eq!(l.len(), 2, "yang dobel persis dibuang, yang beda artis tetap");
    }

    #[test]
    fn csv_kosong_atau_rusak_tidak_panic() {
        assert!(parse_csv("").is_err());
        assert!(parse_csv("bukan,csv,berarti").is_err());
    }
}