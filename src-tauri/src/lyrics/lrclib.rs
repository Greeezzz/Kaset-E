//! Klien LRCLIB (FEATURES-V3 §4 L5).
//!
//! Spesifikasi LRCLIB (https://lrclib.net/docs):
//! - Endpoint GET `/api/get` (pencocokan persis): `track_name`, `artist_name`, `duration` (dalam detik).
//! - Endpoint GET `/api/search`: pencarian fleksibel jika pencocokan persis 404.
//! - Aturan privasi: HANYA dipanggil saat setting `lirik.lrclib` bernilai `"1"` (opt-in).
//! - User-Agent sopan dan jujur: `Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)`.
//! - Timeout pendek (5 detik), penanganan error jinak (fallback aman).

use serde::Deserialize;
use std::time::Duration;

const LRCLIB_API_BASE: &str = "https://lrclib.net/api";
const USER_AGENT: &str = "Kaset-MusicPlayer/0.0.0 (https://github.com/Greeezzz/Kaset-E)";

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

/// Mengambil lirik dari LRCLIB menggunakan endpoint `/api/get` dan `/api/search`.
/// Dilengkapi dengan normalisasi nama artis (mis. "Sān-Z & HOYO-MiX" -> "Sān-Z")
/// dan pencocokan durasi lagu agar tidak salah mengambil lagu berjudulkan sama milik musisi lain.
pub async fn fetch_lrclib(
    title: &str,
    artist: &str,
    duration_secs: Option<f64>,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Gagal inisialisasi HTTP client: {e}"))?;

    let pasangan_kueri = bangun_kandidat_kueri(title, artist);

    for (target_title, artist_candidates) in &pasangan_kueri {
        // 1. Coba `/api/get` dengan kombinasi judul & kandidat artis
        for art in artist_candidates {
            let mut query = vec![("track_name", target_title.as_str()), ("artist_name", art.as_str())];
            let dur_str;
            if let Some(d) = duration_secs {
                if d > 0.0 {
                    dur_str = format!("{}", d.round() as i64);
                    query.push(("duration", &dur_str));
                }
            }

            let resp = client.get(format!("{}/get", LRCLIB_API_BASE)).query(&query).send().await;
            if let Ok(res) = resp {
                if res.status().is_success() {
                    if let Ok(data) = res.json::<LrclibResponse>().await {
                        if let Some(text) = extract_best_lyrics(&data) {
                            return Ok(Some(text));
                        }
                    }
                }
            }
        }

        // 2. Coba `/api/search?q=...` dengan pencocokan durasi fleksibel
        for art in artist_candidates {
            let search_q = format!("{target_title} {art}");
            let search_resp = client
                .get(format!("{}/search", LRCLIB_API_BASE))
                .query(&[("q", search_q.as_str())])
                .send()
                .await;

            if let Ok(res) = search_resp {
                if res.status().is_success() {
                    if let Ok(items) = res.json::<Vec<LrclibResponse>>().await {
                        // Cari item yang memiliki syncedLyrics dan durasi mendekati (selisih <= 4 detik)
                        let matched = items.iter().find(|it| {
                            if it.synced_lyrics.is_none() {
                                return false;
                            }
                            if let (Some(target_d), Some(it_d)) = (duration_secs, it.duration) {
                                if (target_d - it_d).abs() > 4.0 {
                                    return false;
                                }
                            }
                            true
                        });

                        if let Some(best) = matched {
                            if let Some(text) = extract_best_lyrics(best) {
                                return Ok(Some(text));
                            }
                        }

                        // Jika tidak ada yang cocok dengan durasi, ambil hasil pertama yang memiliki lirik
                        for item in &items {
                            if let Some(text) = extract_best_lyrics(item) {
                                return Ok(Some(text));
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(None)
}

/// Menghapus tag video YouTube seperti (Official Audio), [MV], dsb.,
/// serta modifier audio seperti [sped up], (reverb), (bass boosted), (slowed).
pub fn bersihkan_judul(judul: &str) -> String {
    let mut clean = judul.to_string();

    // 1. Tag standar YouTube
    for tag in &[
        "(Official Audio)",
        "(Official Music Video)",
        "(Official Video)",
        "[Official Audio]",
        "[Official Music Video]",
        "[MV]",
        "(MV)",
        "(Audio)",
        "[Audio]",
        "(Lyrics)",
        "[Lyrics]",
        "(Lyric Video)",
        "[Lyric Video]",
        "(Visualizer)",
        "[Visualizer]",
    ] {
        clean = clean.replace(tag, "");
    }

    // 2. Pembersihan kurung siku dan kurung biasa yang berisi modifier audio populer (case-insensitive)
    // misal: [ sped up + reverb + bass boosted ], (sped up), [slowed + reverb], (speed up)
    let modifier_kata = [
        "sped up",
        "speed up",
        "slowed",
        "reverb",
        "bass boosted",
        "nightcore",
        "daycore",
        "remix",
        "cover",
        "audio",
        "lyrics",
        "lyric",
        "official",
        "clean",
        "extended",
    ];

    clean = hapus_kurung_jika_mengandung(&clean, &modifier_kata);

    // Bersihkan spasi ganda dan trim
    clean.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn hapus_kurung_jika_mengandung(input: &str, kata_kunci: &[&str]) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '(' || c == '[' {
            let tutup = if c == '(' { ')' } else { ']' };
            if let Some(pos_tutup) = chars[i + 1..].iter().position(|&x| x == tutup) {
                let end = i + 1 + pos_tutup;
                let isi: String = chars[i + 1..end].iter().collect();
                let isi_lower = isi.to_ascii_lowercase();

                let ada_modifier = kata_kunci.iter().any(|k| isi_lower.contains(k));
                if ada_modifier {
                    // Lewati seluruh kurung beserta isinya
                    i = end + 1;
                    continue;
                }
            }
        }
        out.push(c);
        i += 1;
    }

    out
}

/// Mengekstrak pasangan (artis, judul) cadangan jika judul video berpola "Artis - Judul".
pub fn ekstrak_artis_dari_judul(judul: &str) -> Option<(String, String)> {
    // Cari pemisah " - " atau " — "
    let separator = if judul.contains(" - ") {
        Some(" - ")
    } else if judul.contains(" — ") {
        Some(" — ")
    } else {
        None
    };

    if let Some(sep) = separator {
        let (kiri, kanan) = judul.split_once(sep)?;
        let artis = kiri.trim();
        let sisa_judul = kanan.trim();

        // Jangan gunakan jika bagian artis terlalu panjang (misal deskripsi) atau kosong
        if !artis.is_empty() && !sisa_judul.is_empty() && artis.len() <= 60 {
            return Some((
                artis.to_string(),
                bersihkan_judul(sisa_judul),
            ));
        }
    }

    None
}

/// Membangun daftar pasangan (kandidat_judul, kandidat_artis) yang akan dicoba secara berurutan.
pub fn bangun_kandidat_kueri(title: &str, artist: &str) -> Vec<(String, Vec<String>)> {
    let mut hasil = Vec::new();

    // 1. Kueri primer: Judul yang telah dibersihkan + artis asli
    let judul_bersih = bersihkan_judul(title);
    let artis_bersih = pecah_kandidat_artis(artist);
    hasil.push((judul_bersih.clone(), artis_bersih));

    // 2. Kueri sekunder (Fallback YouTube Video):
    // Jika judul mengandung "Artis - Judul Lagu", pisahkan dan coba artis dari judul.
    // Misalnya judul: "mr kitty - after dark [ sped up + reverb ]", uploader: "bluuthetic"
    if let Some((artis_ekstrak, judul_ekstrak)) = ekstrak_artis_dari_judul(&judul_bersih) {
        if !judul_ekstrak.is_empty() && judul_ekstrak != judul_bersih {
            let artis_ekstrak_list = pecah_kandidat_artis(&artis_ekstrak);
            hasil.push((judul_ekstrak, artis_ekstrak_list));
        }
    }

    hasil
}

fn pecah_kandidat_artis(artist: &str) -> Vec<String> {
    let mut list = Vec::new();
    let trimmed = artist.trim();
    if !trimmed.is_empty() {
        list.push(trimmed.to_string());

        // Jika artis gabungan seperti "Artist A, Artist B" atau "Artist A & Artist B",
        // masukkan juga artis pertama sebagai fallback
        if let Some((first, _)) = trimmed.split_once(',') {
            let f = first.trim();
            if !f.is_empty() && !list.contains(&f.to_string()) {
                list.push(f.to_string());
            }
        } else if let Some((first, _)) = trimmed.split_once('&') {
            let f = first.trim();
            if !f.is_empty() && !list.contains(&f.to_string()) {
                list.push(f.to_string());
            }
        }
    }
    list
}

fn extract_best_lyrics(item: &LrclibResponse) -> Option<String> {
    if let Some(synced) = &item.synced_lyrics {
        let trimmed = synced.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(plain) = &item.plain_lyrics {
        let trimmed = plain.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bersihkan_judul_youtube_video() {
        assert_eq!(
            bersihkan_judul("Discord (speed up)"),
            "Discord"
        );
        assert_eq!(
            bersihkan_judul("house of memories (sped up)"),
            "house of memories"
        );
        assert_eq!(
            bersihkan_judul("mr kitty - after dark [ sped up + reverb + bass boosted ]"),
            "mr kitty - after dark"
        );
        assert_eq!(
            bersihkan_judul("after dark x sweater weather (sped up)"),
            "after dark x sweater weather"
        );
        assert_eq!(
            bersihkan_judul("YOASOBI - Racing into the Night [Official Music Video] (Lyrics)"),
            "YOASOBI - Racing into the Night"
        );
    }

    #[test]
    fn test_ekstrak_artis_dari_judul() {
        let res = ekstrak_artis_dari_judul("mr kitty - after dark [ sped up + reverb + bass boosted ]");
        assert_eq!(
            res,
            Some(("mr kitty".to_string(), "after dark".to_string()))
        );

        let res2 = ekstrak_artis_dari_judul("Panic! At The Disco — House of Memories (Official Audio)");
        assert_eq!(
            res2,
            Some(("Panic! At The Disco".to_string(), "House of Memories".to_string()))
        );
    }

    #[test]
    fn test_bangun_kandidat_kueri() {
        let kueri = bangun_kandidat_kueri(
            "mr kitty - after dark [ sped up + reverb + bass boosted ]",
            "bluuthetic",
        );
        assert_eq!(kueri.len(), 2);
        // Kueri 1: Judul video bersih + nama channel uploader
        assert_eq!(kueri[0].0, "mr kitty - after dark");
        assert_eq!(kueri[0].1, vec!["bluuthetic".to_string()]);
        // Kueri 2: Judul yang diekstrak dari format "Artis - Judul"
        assert_eq!(kueri[1].0, "after dark");
        assert_eq!(kueri[1].1, vec!["mr kitty".to_string()]);
    }
}

