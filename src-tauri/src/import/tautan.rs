//! Validasi tautan playlist YouTube.
//!
//! Tautan yang datang dari pengguna tidak pernah dipercaya. Sebelum menyentuh
//! yt-dlp, host dibatasi ke YouTube, jalurnya harus `playlist`/`watch`, dan
//! parameter `list` harus berbentuk id playlist yang wajar. Tanpa ini, satu
//! tautan sembarang akan diteruskan ke proses anak dan menghabiskan batas waktu
//! 180 detik sebelum gagal.
//!
//! Parsing dilakukan dengan tangan, bukan crate `url`: yang dibutuhkan cuma
//! host, jalur, dan satu parameter, dan menambah dependensi untuk itu tidak
//! sepadan. Konsekuensinya parsing sengaja kaku — bentuk tautan aneh ditolak,
//! bukan ditebak.

use crate::error::{AppError, AppResult};

/// Hasil validasi: id playlist + URL kanonis yang dikirim ke yt-dlp.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TautanPlaylist {
    pub id: String,
    pub url: String,
}

/// Host yang diterima. Subdomain lain (`gaming.youtube.com`, dsb.) tidak punya
/// tautan playlist yang bisa diimpor, jadi tidak ikut didaftarkan.
const HOST_DIIZINKAN: [&str; 4] = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
];

/// Panjang id playlist YouTube yang lazim: `PL…`, `OLAK5uy_…`, `UU…`, `FL…`.
/// Batas bawah 10 menolak `WL` (Watch Later) yang bukan playlist biasa.
const ID_MIN: usize = 10;
const ID_MAKS: usize = 100;

/// Baca dan validasi tautan playlist.
///
/// Menerima bentuk yang lazim disalin pengguna:
/// - `https://www.youtube.com/playlist?list=PL…`
/// - `https://music.youtube.com/playlist?list=OLAK5uy_…`
/// - `https://www.youtube.com/watch?v=…&list=PL…` (tautan dari tombol Share)
pub fn parse(tautan: &str) -> AppResult<TautanPlaylist> {
    let bersih = tautan.trim();
    if bersih.is_empty() {
        return Err(AppError::invalid("tempel tautan playlist YouTube dulu"));
    }

    let sisa = bersih.strip_prefix("https://").ok_or_else(|| {
        AppError::invalid("tautan harus diawali https:// — salin langsung dari bilah alamat")
    })?;

    // Fragmen (`#…`) tidak pernah bagian dari id playlist.
    let sisa = sisa.split('#').next().unwrap_or(sisa);

    let (host, jalur) = sisa.split_once('/').ok_or_else(|| {
        AppError::invalid("tautan tidak lengkap: tidak ada jalur setelah nama host")
    })?;
    let host = host.to_ascii_lowercase();
    if !HOST_DIIZINKAN.contains(&host.as_str()) {
        return Err(AppError::invalid(format!(
            "{host} bukan YouTube. Hanya tautan youtube.com atau music.youtube.com yang bisa diimpor"
        )));
    }

    let (jalur, kueri) = jalur.split_once('?').unwrap_or((jalur, ""));
    if !matches!(jalur, "playlist" | "watch") {
        return Err(AppError::invalid(
            "tautan itu bukan playlist. Buka playlist di YouTube, lalu salin tautannya",
        ));
    }

    let mut list: Option<&str> = None;
    for pasangan in kueri.split('&') {
        let (kunci, nilai) = pasangan.split_once('=').unwrap_or((pasangan, ""));
        if kunci == "list" {
            list = Some(nilai);
        }
    }

    let id = list.ok_or_else(|| {
        AppError::invalid("tautan tidak memuat parameter list= — itu tautan video, bukan playlist")
    })?;

    if !(ID_MIN..=ID_MAKS).contains(&id.len()) {
        return Err(AppError::invalid(
            "id playlist di tautan itu panjangnya tidak wajar",
        ));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        // Termasuk `%` dari percent-encoding: id playlist asli tidak pernah
        // butuh encoding, jadi yang mengandung `%` hampir pasti tautan rusak.
        return Err(AppError::invalid(
            "id playlist hanya boleh berisi huruf, angka, '-' dan '_'",
        ));
    }
    if id.starts_with("RD") {
        return Err(AppError::invalid(
            "playlist campuran otomatis (mix/radio) tidak bisa diimpor karena isinya tidak tetap",
        ));
    }

    Ok(TautanPlaylist {
        id: id.to_string(),
        url: format!("https://www.youtube.com/playlist?list={id}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(tautan: &str) -> String {
        parse(tautan).expect("tautan seharusnya valid").id
    }

    #[test]
    fn menerima_bentuk_yang_lazim() {
        assert_eq!(
            id("https://www.youtube.com/playlist?list=PLabc123456789"),
            "PLabc123456789"
        );
        assert_eq!(
            id("https://music.youtube.com/playlist?list=OLAK5uy_kAbCdEfGhIj"),
            "OLAK5uy_kAbCdEfGhIj"
        );
        assert_eq!(
            id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz987654321&index=4"),
            "PLxyz987654321"
        );
        assert_eq!(
            id("  https://m.youtube.com/playlist?list=PLspasi99999  "),
            "PLspasi99999"
        );
    }

    #[test]
    fn membuang_fragmen_dan_mengembalikan_url_kanonis() {
        let t = parse("https://www.youtube.com/playlist?list=PLabc123456789#atas").unwrap();
        assert_eq!(
            t.url,
            "https://www.youtube.com/playlist?list=PLabc123456789"
        );
    }

    #[test]
    fn menolak_host_lain() {
        let e = parse("https://evil.example/playlist?list=PLabc123456789").unwrap_err();
        assert!(e.to_string().contains("bukan YouTube"));
        let e = parse("https://youtube.com.evil.example/playlist?list=PLabc123456789").unwrap_err();
        assert!(e.to_string().contains("bukan YouTube"));
    }

    #[test]
    fn menolak_http_dan_tautan_kosong() {
        assert!(parse("http://www.youtube.com/playlist?list=PLabc123456789").is_err());
        assert!(parse("   ").is_err());
        assert!(parse("youtube.com/playlist?list=PLabc123456789").is_err());
    }

    #[test]
    fn menolak_tanpa_parameter_list() {
        let e = parse("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap_err();
        assert!(e.to_string().contains("list="));
    }

    #[test]
    fn menolak_jalur_bukan_playlist() {
        assert!(parse("https://www.youtube.com/channel/UCabc123456789").is_err());
        assert!(parse("https://www.youtube.com/results?search_query=abc").is_err());
    }

    #[test]
    fn menolak_id_tidak_wajar() {
        assert!(parse("https://www.youtube.com/playlist?list=WL").is_err());
        assert!(parse("https://www.youtube.com/playlist?list=PLabc%20123456789").is_err());
        assert!(parse("https://www.youtube.com/playlist?list=PLabc 123456789").is_err());
        assert!(
            parse(&format!(
                "https://www.youtube.com/playlist?list={}",
                "P".repeat(101)
            ))
            .is_err()
        );
    }

    #[test]
    fn menolak_mix_otomatis() {
        let e = parse("https://www.youtube.com/playlist?list=RDCLAK5uy_abc123").unwrap_err();
        assert!(e.to_string().contains("mix"));
    }
}
