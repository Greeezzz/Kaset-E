//! Service gambar cover playlist kustom (DESIGN-LAYOUT §5).
//!
//! Semua pemrosesan gambar upload terjadi di sini, bukan di webview:
//! validasi tipe (magic bytes), batas ukuran file, crop tengah 1:1, resize ke
//! 512×512, lalu encode ulang sebagai JPEG. Hasilnya selalu file kecil yang
//! seragam — gambar mentah 20 MB dari kamera tidak pernah masuk folder data,
//! dan tidak ada base64 di SQLite.
//!
//! Modul ini murni (tanpa Tauri/DB) supaya validasi dan crop bisa diuji unit.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};

use crate::error::{AppError, AppResult};

/// Batas ukuran file upload. Foto ponsel modern biasanya 2–8 MB.
pub const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
/// Sisi cover hasil akhir.
pub const COVER_SIZE: u32 = 512;
/// Batas dimensi decode, mencegah "decompression bomb" (PNG kecil yang
/// mengembang jadi gigabyte di memori).
const MAX_DIMENSION: u32 = 8192;
const JPEG_QUALITY: u8 = 86;

/// Deteksi format dari magic bytes. Ekstensi nama file tidak dipercaya.
pub fn detect_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.len() >= 8 && bytes[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        return Some(ImageFormat::Png);
    }
    if bytes.len() >= 3 && bytes[..3] == [0xFF, 0xD8, 0xFF] {
        return Some(ImageFormat::Jpeg);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(ImageFormat::WebP);
    }
    None
}

/// Validasi input upload tanpa men-decode: ukuran dan tipe.
pub fn validate(bytes: &[u8]) -> AppResult<ImageFormat> {
    if bytes.is_empty() {
        return Err(AppError::invalid("file gambar kosong"));
    }
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::invalid("gambar terlalu besar (maks 10 MB)"));
    }
    detect_format(bytes).ok_or_else(|| AppError::invalid("format gambar harus PNG, JPG, atau WebP"))
}

/// Crop tengah menjadi persegi, lalu resize ke `size`×`size`.
pub fn crop_square(img: &DynamicImage, size: u32) -> DynamicImage {
    let (w, h) = (img.width(), img.height());
    let side = w.min(h);
    let x = (w - side) / 2;
    let y = (h - side) / 2;
    img.crop_imm(x, y, side, side)
        .resize_exact(size, size, FilterType::Lanczos3)
}

/// Pipeline lengkap: validasi → decode (dengan batas) → crop 1:1 → resize →
/// encode JPEG. Mengembalikan byte JPEG siap tulis.
pub fn process(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let format = validate(bytes)?;

    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    reader.limits(limits);

    let img = reader
        .decode()
        .map_err(|e| AppError::invalid(format!("gambar rusak atau tidak didukung: {e}")))?;
    if img.width() == 0 || img.height() == 0 {
        return Err(AppError::invalid("dimensi gambar tidak valid"));
    }

    // JPEG tidak punya alpha; ratakan ke RGB supaya PNG transparan tidak gagal.
    let square = crop_square(&img, COVER_SIZE).to_rgb8();

    let mut out = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY);
    enc.encode_image(&square)
        .map_err(|e| AppError::invalid(format!("gagal menyimpan gambar: {e}")))?;
    Ok(out)
}

/// Nama file unik untuk cover playlist. UUID di nama file juga berfungsi
/// sebagai cache-buster: ganti cover → URL baru → webview tidak menampilkan
/// gambar lama dari cache.
pub fn file_name_for(playlist_id: i64) -> String {
    format!("p{playlist_id}-{}.jpg", uuid::Uuid::new_v4().simple())
}

/// Nama file harus sederhana (tanpa separator / `..`) sebelum digabung dengan
/// folder. Mencegah DB yang rusak menghapus file di luar folder cover.
pub fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\', ':'])
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Path absolut cover di dalam `dir`, atau `None` kalau namanya tidak aman.
pub fn resolve(dir: &Path, name: &str) -> Option<PathBuf> {
    is_safe_file_name(name).then(|| dir.join(name))
}

/// Tulis cover ke `dir/name` secara atomik (tulis `.part` lalu rename).
pub fn write(dir: &Path, name: &str, data: &[u8]) -> AppResult<PathBuf> {
    let target = resolve(dir, name).ok_or_else(|| AppError::invalid("nama file cover tidak aman"))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{name}.part"));
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, &target)?;
    Ok(target)
}

/// Hapus file cover lama. Gagal hapus hanya dicatat — berkas yatim lebih baik
/// daripada operasi pengguna yang gagal.
pub fn remove(dir: &Path, name: &str) {
    if let Some(p) = resolve(dir, name) {
        if let Err(e) = std::fs::remove_file(&p) {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = %p.display(), error = %e, "gagal menghapus cover playlist lama");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};

    fn encode(img: &DynamicImage, fmt: ImageFormat) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, fmt).expect("encode");
        buf.into_inner()
    }

    /// Gambar lebar: kiri merah, tengah hijau, kanan biru (masing-masing 1/3).
    fn gambar_tiga_warna(w: u32, h: u32) -> DynamicImage {
        let buf = ImageBuffer::from_fn(w, h, |x, _| {
            if x < w / 3 {
                Rgb([255u8, 0, 0])
            } else if x < 2 * w / 3 {
                Rgb([0, 255, 0])
            } else {
                Rgb([0, 0, 255])
            }
        });
        DynamicImage::ImageRgb8(buf)
    }

    #[test]
    fn deteksi_format_dari_magic_bytes() {
        let png = encode(&gambar_tiga_warna(4, 4), ImageFormat::Png);
        let jpg = encode(&gambar_tiga_warna(4, 4), ImageFormat::Jpeg);
        assert_eq!(detect_format(&png), Some(ImageFormat::Png));
        assert_eq!(detect_format(&jpg), Some(ImageFormat::Jpeg));
        assert_eq!(
            detect_format(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(ImageFormat::WebP)
        );
        assert_eq!(detect_format(b"GIF89a......"), None);
        assert_eq!(detect_format(b"<html>"), None);
    }

    #[test]
    fn validasi_menolak_kosong_besar_dan_bukan_gambar() {
        assert!(matches!(validate(&[]), Err(AppError::Invalid(_))));
        assert!(matches!(
            validate(b"bukan gambar sama sekali"),
            Err(AppError::Invalid(_))
        ));
        let mut besar = vec![0xFF, 0xD8, 0xFF];
        besar.resize(MAX_UPLOAD_BYTES + 1, 0);
        assert!(matches!(validate(&besar), Err(AppError::Invalid(_))));
    }

    #[test]
    fn crop_tengah_mengambil_bagian_tengah() {
        // 300x100 → crop 100x100 di tengah = seluruhnya hijau.
        let img = gambar_tiga_warna(300, 100);
        let out = crop_square(&img, 50).to_rgb8();
        assert_eq!(out.dimensions(), (50, 50));
        let px = out.get_pixel(25, 25);
        assert!(px[1] > 200 && px[0] < 50 && px[2] < 50, "tengah harus hijau: {px:?}");
    }

    #[test]
    fn crop_gambar_tinggi_juga_persegi() {
        let img = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(120, 400, Rgb([10u8, 20, 30])));
        let c = crop_square(&img, 64);
        assert_eq!((c.width(), c.height()), (64, 64));
    }

    #[test]
    fn process_menghasilkan_jpeg_512_persegi() {
        let png = encode(&gambar_tiga_warna(900, 300), ImageFormat::Png);
        let out = process(&png).expect("proses");
        assert_eq!(detect_format(&out), Some(ImageFormat::Jpeg));
        let decoded = image::load_from_memory(&out).expect("decode hasil");
        assert_eq!((decoded.width(), decoded.height()), (COVER_SIZE, COVER_SIZE));
    }

    #[test]
    fn process_png_transparan_tidak_gagal() {
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(64, 64, Rgba([0u8, 0, 0, 0])));
        let png = encode(&img, ImageFormat::Png);
        assert!(process(&png).is_ok());
    }

    #[test]
    fn process_menolak_gambar_rusak() {
        // Header PNG valid, isi sampah.
        let mut rusak = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        rusak.extend_from_slice(&[0u8; 64]);
        assert!(matches!(process(&rusak), Err(AppError::Invalid(_))));
    }

    #[test]
    fn nama_file_aman() {
        assert!(is_safe_file_name(&file_name_for(7)));
        assert!(!is_safe_file_name("../kaset.db"));
        assert!(!is_safe_file_name("a/b.jpg"));
        assert!(!is_safe_file_name("C:\\x.jpg"));
        assert!(!is_safe_file_name(""));
    }

    #[test]
    fn tulis_dan_hapus_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let name = file_name_for(1);
        let p = write(dir.path(), &name, b"isi").expect("tulis");
        assert!(p.exists());
        assert!(!dir.path().join(format!("{name}.part")).exists());
        remove(dir.path(), &name);
        assert!(!p.exists());
        // Hapus file yang tidak ada tidak boleh panik.
        remove(dir.path(), &name);
    }
}
