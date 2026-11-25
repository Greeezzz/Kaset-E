//! Command import playlist (Fase 5).
//!
//! Alurnya tiga tahap, dan tiap tahap bisa dihentikan pengguna:
//!
//!  1. `import_parse` — baca berkas jadi daftar lagu. Cepat (milidetik).
//!  2. `import_cocokkan` — cari tiap lagu di katalog, beri skor. Ini tahap
//!     lambat (~35 detik untuk 461 lagu), jadi ia mengirim event progress dan
//!     memeriksa tanda batal setiap lagu.
//!  3. `import_simpan` — tulis lagu yang diterima ke playlist.
//!
//! Kenapa dipisah: pengguna harus bisa MELIHAT hasil pencocokan sebelum
//! menyimpan. Kalau semuanya satu command, satu pencocokan yang salah langsung
//! masuk playlist tanpa sempat diperiksa.

use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::error::{AppError, AppResult};
use crate::import::cocok::{pilih_terbaik, sebut_keputusan, Kandidat, Keputusan};
use crate::import::{dedupe, parse_otomatis, LaguImport};
use crate::models::Track;
use crate::state::AppState;

/// Satu baris hasil pencocokan, dikirim ke UI.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarisCocok {
    /// Judul & artis dari berkas, untuk ditampilkan apa adanya.
    pub judul_impor: String,
    pub artis_impor: String,
    pub baris: usize,
    /// Kandidat terbaik (null = tidak ada hasil sama sekali).
    pub kandidat: Option<KandidatPublik>,
    pub skor: f32,
    pub keputusan: Keputusan,
    pub alasan: Vec<String>,
    /// Pilihan pengguna: true = masukkan, false = lewati.
    pub pilih: bool,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KandidatPublik {
    pub video_id: String,
    pub judul: String,
    pub artis: String,
    pub durasi_ms: Option<i64>,
    pub cover_key: String,
}

/// Ringkasan hasil pencocokan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RingkasanCocok {
    pub total: usize,
    pub otomatis: usize,
    pub perlu_review: usize,
    pub tidak_ada: usize,
    pub batal: bool,
    pub baris: Vec<BarisCocok>,
}

/// Payload event progress.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    selesai: usize,
    total: usize,
    judul: String,
}

/// Tanda batal job yang sedang berjalan.
static BATAL: AtomicBool = AtomicBool::new(false);

/// Apakah ada job pencocokan yang sedang berjalan.
///
/// Kenapa ini perlu: `import_cocokkan` dulu me-reset `BATAL` di awal. Kalau
/// pengguna memulai job kedua saat job pertama belum selesai (mis. menutup
/// dialog lalu membukanya lagi), reset itu membuat job PERTAMA tidak bisa
/// dibatalkan lagi — dan dua job berebut katalog, sehingga keduanya lambat dan
/// tombol batal terasa tidak bekerja.
///
/// Sekarang job kedua ditolak dengan pesan jelas. Satu job pada satu waktu.
static SEDANG_JALAN: AtomicBool = AtomicBool::new(false);

/// Penjaga yang mengembalikan `SEDANG_JALAN` ke false apa pun yang terjadi,
/// termasuk saat fungsi keluar karena galat atau panic.
struct PenjagaJob;
impl Drop for PenjagaJob {
    fn drop(&mut self) {
        SEDANG_JALAN.store(false, Ordering::SeqCst);
    }
}

/// Baca berkas jadi daftar lagu (tahap 1).
#[tauri::command]
pub async fn import_parse(isi: String) -> AppResult<Vec<LaguImport>> {
    let lagu = parse_otomatis(&isi)?;
    Ok(dedupe(lagu))
}

/// Buat isi CSV dari baris impor yang tidak diterima.
///
/// Yang diekspor: baris `tidakada` dan baris `review` yang TIDAK dicentang
/// pengguna saat menyimpan. Keduanya sama-sama "lagu yang tidak masuk
/// playlist", dan itulah yang perlu pengguna tindak lanjuti secara manual.
///
/// Kolom sengaja dibuat bisa dibuka di Excel/LibreOffice tanpa impor khusus:
/// header sederhana, pemisah koma, dan semua nilai dikutip — judul lagu sering
/// mengandung koma ("Hello, Goodbye"), tanda kutip, dan baris baru.
///
/// `kandidat` ikut disertakan sebagai saran, bukan keputusan: pengguna yang
/// memutuskan apakah itu lagu yang benar.
pub fn csv_tidak_masuk(baris: &[BarisCocok]) -> String {
    let mut out = String::from(
        "judul_impor,artis_impor,baris_sumber,status,saran_judul,saran_artis,durasi_saran_detik,skor,alasan\n",
    );
    for b in baris {
        // Hanya baris yang TIDAK masuk playlist.
        let status = match b.keputusan {
            Keputusan::TidakAda => "tidak_ditemukan",
            Keputusan::Review => "perlu_diperiksa",
            Keputusan::Otomatis => continue,
        };
        let (sj, sa, skor, durasi) = match &b.kandidat {
            Some(k) => (
                k.judul.as_str(),
                k.artis.as_str(),
                format!("{:.2}", b.skor),
                k.durasi_ms.map(|d| (d / 1000).to_string()).unwrap_or_default(),
            ),
            None => ("", "", String::new(), String::new()),
        };
        let alasan = b.alasan.join("; ");
        let nomor_baris = b.baris.to_string();

        let kolom = [
            b.judul_impor.as_str(),
            b.artis_impor.as_str(),
            &nomor_baris,
            status,
            sj,
            sa,
            &durasi,
            &skor,
            &alasan,
        ];
        let baris_csv: Vec<String> = kolom.iter().map(|v| kutip_csv(v)).collect();
        out.push_str(&baris_csv.join(","));
        out.push('\n');
    }
    out
}

/// Kutip satu nilai CSV, escape tanda kutip ganda dengan menggandakannya.
///
/// Selalu dikutip, bukan hanya saat perlu: lebih mudah dibaca di diff dan
/// tidak ada kasus tepi "ternyata ada koma".
fn kutip_csv(v: &str) -> String {
    format!("\"{}\"", v.replace('"', "\"\""))
}

/// Tulis CSV ke path yang dipilih pengguna.
///
/// Path datang dari dialog simpan native, jadi pengguna sudah menyetujuinya.
/// Tetap ditolak kalau kosong, dan folder induk dibuat bila perlu (dialog
/// Windows mengizinkan mengetik folder yang belum ada).
#[tauri::command]
pub async fn import_ekspor_tidak_masuk(
    baris: Vec<BarisCocok>,
    path: String,
) -> AppResult<usize> {
    if path.trim().is_empty() {
        return Err(AppError::invalid("path ekspor kosong"));
    }
    let isi = csv_tidak_masuk(&baris);
    let jumlah = isi.lines().count().saturating_sub(1);
    let p = std::path::Path::new(&path);
    if let Some(induk) = p.parent() {
        if !induk.as_os_str().is_empty() {
            std::fs::create_dir_all(induk)?;
        }
    }
    std::fs::write(p, isi)?;
    tracing::info!(path = %path, jumlah, "daftar lagu tidak masuk diekspor");
    Ok(jumlah)
}

/// Hentikan job pencocokan yang sedang berjalan.
#[tauri::command]
pub async fn import_batal() -> AppResult<()> {
    BATAL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Cocokkan daftar lagu ke katalog (tahap 2).
///
/// Mengirim event `import://progress` tiap 10 lagu dan `import://selesai` di
/// akhir. Event per-lagu akan membanjiri IPC untuk 461 lagu.
#[tauri::command]
pub async fn import_cocokkan(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    lagu: Vec<LaguImport>,
) -> AppResult<RingkasanCocok> {
    // Tolak job kedua: lihat alasan di `SEDANG_JALAN`.
    if SEDANG_JALAN.swap(true, Ordering::SeqCst) {
        return Err(AppError::invalid(
            "masih ada impor yang berjalan — tunggu selesai atau batalkan dulu",
        ));
    }
    let _penjaga = PenjagaJob;
    BATAL.store(false, Ordering::SeqCst);
    let total = lagu.len();

    let mut baris = Vec::with_capacity(total);
    let (mut otomatis, mut review, mut tidak_ada) = (0, 0, 0);

    for (i, l) in lagu.iter().enumerate() {
        if BATAL.load(Ordering::SeqCst) {
            break;
        }

        // Kueri: judul + artis pertama. Artis lengkap hampir selalu
        // memperburuk hasil pencarian.
        let kueri = format!("{} {}", l.judul, l.artis);
        let kueri = kueri.chars().take(120).collect::<String>();

        // Timeout per pencarian. Tanpa ini, SATU pencarian yang menggantung
        // menahan seluruh job — dan karena katalog memakai satu connection
        // pool, job lain ikut macet. 15 detik jauh di atas waktu normal
        // (~400 ms) tapi cukup untuk jaringan lambat.
        let hasil = match tokio::time::timeout(
            std::time::Duration::from_secs(15),
            state.catalog().search(&kueri),
        )
        .await
        {
            Ok(Ok(r)) => Some(r),
            Ok(Err(e)) => {
                tracing::warn!(kueri = %kueri, error = %e, "pencarian impor gagal");
                None
            }
            Err(_) => {
                tracing::warn!(kueri = %kueri, "pencarian impor timeout 15 detik");
                None
            }
        };
        let kandidat: Vec<Kandidat> = hasil
            .as_ref()
            .map(|r| {
                r.tracks
                    .iter()
                    .take(8) // 8 sudah cukup; lebih dari itu hanya menambah skor rendah
                    .map(|t| Kandidat {
                        video_id: t.video_id.clone(),
                        judul: t.title.clone(),
                        artis: t.artist.clone(),
                        durasi_ms: t.duration_ms.map(|d| d as i64),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let terpilih = pilih_terbaik(&l.judul, &l.artis, &l.artis_lengkap, l.durasi_ms, &kandidat);

        let (kandidat_pub, skor, keputusan, alasan) = match terpilih {
            Some((k, p)) => (
                Some(KandidatPublik {
                    cover_key: Track::cover_key_for(&k.video_id),
                    video_id: k.video_id,
                    judul: k.judul,
                    artis: k.artis,
                    durasi_ms: k.durasi_ms,
                }),
                p.skor,
                p.keputusan,
                p.alasan,
            ),
            None => (
                None,
                0.0,
                Keputusan::TidakAda,
                vec!["tidak ada hasil".into()],
            ),
        };

        match keputusan {
            Keputusan::Otomatis => otomatis += 1,
            Keputusan::Review => review += 1,
            Keputusan::TidakAda => tidak_ada += 1,
        }

        baris.push(BarisCocok {
            judul_impor: l.judul.clone(),
            artis_impor: l.artis.clone(),
            baris: l.baris,
            kandidat: kandidat_pub,
            skor,
            keputusan,
            alasan,
            // Hanya yang otomatis tercentang di awal. Yang review harus
            // diputuskan pengguna — itu inti desainnya.
            pilih: keputusan == Keputusan::Otomatis,
        });

        // Progress tiap 10 lagu: cukup untuk terasa hidup, tidak membajiri IPC.
        if (i + 1) % 10 == 0 || i + 1 == total {
            let _ = app.emit(
                "import://progress",
                Progress {
                    selesai: i + 1,
                    total,
                    judul: l.judul.clone(),
                },
            );
        }
    }

    let dibatalkan = BATAL.load(Ordering::SeqCst);
    let ringkas = RingkasanCocok {
        total: baris.len(),
        otomatis,
        perlu_review: review,
        tidak_ada,
        batal: dibatalkan,
        baris,
    };
    let _ = app.emit("import://selesai", &ringkas);
    Ok(ringkas)
}

/// Payload simpan: lagu mana yang dipilih, ke playlist mana.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PilihanSimpan {
    pub playlist_id: Option<i64>,
    pub nama_playlist: Option<String>,
    /// Hanya baris dengan `pilih: true`.
    pub lagu: Vec<LaguSimpan>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaguSimpan {
    pub video_id: String,
    pub judul: String,
    pub artis: String,
    pub album: Option<String>,
    pub durasi_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HasilSimpan {
    pub playlist_id: i64,
    pub ditambahkan: usize,
    pub dilewati: usize,
}

/// Tulis lagu terpilih ke playlist (tahap 3).
///
/// Kalau `playlist_id` kosong, playlist baru dibuat dari `nama_playlist`.
/// Lagu yang sudah ada di playlist dilewati, bukan diduplikasi.
#[tauri::command]
pub async fn import_simpan(
    state: State<'_, AppState>,
    pilihan: PilihanSimpan,
) -> AppResult<HasilSimpan> {
    if pilihan.lagu.is_empty() {
        return Err(AppError::invalid("tidak ada lagu yang dipilih"));
    }

    let pid = match pilihan.playlist_id {
        Some(id) => id,
        None => {
            let nama = pilihan
                .nama_playlist
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Hasil impor");
            let nama: String = nama.chars().take(80).collect();
            crate::db::playlist::create(&state.db, &nama)?.id
        }
    };

    // Kumpulan video_id yang sudah ada, supaya tidak dobel.
    let sudah: std::collections::HashSet<String> = crate::db::playlist::tracks(&state.db, pid)?
        .into_iter()
        .map(|t| t.video_id)
        .collect();

    let mut ditambahkan = 0;
    let mut dilewati = 0;
    for l in &pilihan.lagu {
        if sudah.contains(&l.video_id) {
            dilewati += 1;
            continue;
        }
        let t = Track {
            cover_key: Track::cover_key_for(&l.video_id),
            video_id: l.video_id.clone(),
            title: l.judul.clone(),
            artist: l.artis.clone(),
            album: l.album.clone(),
            duration_ms: l.durasi_ms.map(|d| d.max(0) as u64),
        };
        // `add_track` sudah menjaga posisi rapat; galat per lagu tidak boleh
        // menggagalkan seluruh impor.
        if crate::db::playlist::add_track(&state.db, pid, &t).is_ok() {
            ditambahkan += 1;
        } else {
            dilewati += 1;
        }
    }

    Ok(HasilSimpan {
        playlist_id: pid,
        ditambahkan,
        dilewati,
    })
}

/// Nama keputusan untuk log — dipakai saat menelusuri masalah impor.
pub fn label_keputusan(k: Keputusan) -> &'static str {
    sebut_keputusan(k)
}

#[cfg(test)]
mod tests_csv {
    use super::*;

    fn baris(judul: &str, artis: &str, keputusan: Keputusan, kandidat: Option<(&str, &str)>, skor: f32) -> BarisCocok {
        BarisCocok {
            judul_impor: judul.into(),
            artis_impor: artis.into(),
            baris: 2,
            kandidat: kandidat.map(|(j, a)| KandidatPublik {
                video_id: "vid".into(),
                judul: j.into(),
                artis: a.into(),
                durasi_ms: Some(215_000),
                cover_key: "v-vid".into(),
            }),
            skor,
            keputusan,
            alasan: vec!["uji".into()],
            pilih: false,
        }
    }

    #[test]
    fn hanya_baris_tidak_masuk_yang_diekspor() {
        let b = vec![
            baris("Lagu A", "Artis A", Keputusan::Otomatis, Some(("A", "Artis A")), 1.0),
            baris("Lagu B", "Artis B", Keputusan::TidakAda, None, 0.0),
            baris("Lagu C", "Artis C", Keputusan::Review, Some(("C2", "Artis C2")), 0.7),
        ];
        let csv = csv_tidak_masuk(&b);
        assert!(!csv.contains("Lagu A"), "baris otomatis tidak boleh ikut");
        assert!(csv.contains("Lagu B"));
        assert!(csv.contains("tidak_ditemukan"));
        assert!(csv.contains("Lagu C"));
        assert!(csv.contains("perlu_diperiksa"));
    }

    #[test]
    fn header_selalu_ada_walau_tidak_ada_baris() {
        let csv = csv_tidak_masuk(&[]);
        assert_eq!(csv.lines().count(), 1);
        assert!(csv.starts_with("judul_impor,artis_impor"));
    }

    /// Judul lagu sering mengandung koma dan tanda kutip: CSV harus tetap sah.
    #[test]
    fn koma_dan_kutip_di_judul_di_escape() {
        let b = vec![baris("Hello, Goodbye", "The \"Fab\" Four", Keputusan::TidakAda, None, 0.0)];
        let csv = csv_tidak_masuk(&b);
        assert!(csv.contains("\"Hello, Goodbye\""), "koma harus di dalam kutip");
        assert!(csv.contains("\"The \"\"Fab\"\" Four\""), "kutip harus digandakan");
        // Jumlah kolom tetap 9 walau judul berisi koma.
        let data = csv.lines().nth(1).unwrap();
        let mut kolom = 0;
        let mut dalam = false;
        for c in data.chars() {
            match c {
                '"' => dalam = !dalam,
                ',' if !dalam => kolom += 1,
                _ => {}
            }
        }
        assert_eq!(kolom + 1, 9, "harus 9 kolom: {data}");
    }

    #[test]
    fn kandidat_kosong_tidak_panik() {
        let b = vec![baris("X", "Y", Keputusan::TidakAda, None, 0.0)];
        let csv = csv_tidak_masuk(&b);
        assert!(csv.contains("\"X\""));
        assert!(csv.contains("tidak_ditemukan"));
    }

    #[test]
    fn skor_diformat_dua_desimal() {
        let b = vec![baris("X", "Y", Keputusan::Review, Some(("X2", "Y2")), 0.7512)];
        assert!(csv_tidak_masuk(&b).contains("0.75"));
    }
}
