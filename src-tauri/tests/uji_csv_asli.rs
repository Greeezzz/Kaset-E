// Uji parser terhadap berkas CSV asli pengguna (bukan fixture).
// Dijalankan manual: cargo test --test uji_csv_asli -- --nocapture --ignored
use kaset_lib::import::{dedupe, parse_otomatis};

#[test]
#[ignore]
fn baca_csv_461_lagu_pengguna() {
    let path = std::env::var("CSV_UJI")
        .unwrap_or_else(|_| r"C:\Users\USER\Downloads\chelokebab10k.csv".to_string());
    let isi = std::fs::read_to_string(&path).expect("berkas CSV harus ada");
    let lagu = parse_otomatis(&isi).expect("harus terbaca");

    println!("=== HASIL PARSE ===");
    println!("lagu terbaca : {}", lagu.len());
    println!("setelah dedupe: {}", dedupe(lagu.clone()).len());

    let ada_durasi = lagu.iter().filter(|l| l.durasi_ms.is_some()).count();
    println!("punya durasi : {ada_durasi}/{}", lagu.len());

    let artis_ganda = lagu.iter().filter(|l| l.artis_lengkap.contains(';')).count();
    println!("artis ganda : {artis_ganda} (diambil artis pertama)");

    let non_ascii = lagu.iter().filter(|l| !l.judul.is_ascii()).count();
    println!("judul non-ascii: {non_ascii}");

    println!("\n=== 5 PERTAMA ===");
    for l in lagu.iter().take(5) {
        println!(
            "  [{}] {} — {} ({} ms)",
            l.baris,
            l.judul,
            l.artis,
            l.durasi_ms.unwrap_or(0)
        );
    }

    println!("\n=== 5 YANG PALING SULIT ===");
    for l in lagu.iter().filter(|l| l.judul.len() > 50).take(5) {
        println!("  {} — {}", l.judul, l.artis);
    }

    assert_eq!(lagu.len(), 461, "jumlah lagu harus sesuai isi berkas");
    assert!(
        lagu.iter().all(|l| !l.judul.is_empty() && !l.artis.is_empty()),
        "tidak boleh ada judul/artis kosong"
    );
    assert!(
        lagu.iter().all(|l| l.baris >= 2),
        "nomor baris harus mulai dari 2 (baris 1 = header)"
    );
}