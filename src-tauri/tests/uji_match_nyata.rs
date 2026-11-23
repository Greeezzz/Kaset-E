// Uji pencocokan terhadap hasil pencarian katalog NYATA (direkam dari app).
// Dijalankan manual: cargo test --test uji_match_nyata -- --ignored --nocapture
use kaset_lib::import::cocok::{pilih_terbaik, sebut_keputusan, Kandidat};

/// (judul impor, artis impor, durasi impor, hasil teratas dari katalog nyata)
fn data() -> Vec<(&'static str, &'static str, i64, &'static str, &'static str, i64)> {
    vec![
        ("Untitled", "Rex Orange County", 135_706, "Untitled", "Rex Orange County", 135_000),
        ("BIRDS OF A FEATHER", "Billie Eilish", 210_373, "BIRDS OF A FEATHER", "Billie Eilish", 210_000),
        ("Dark Red", "Steve Lacy", 173_104, "Dark Red", "Steve Lacy", 173_000),
        ("cardigan", "Taylor Swift", 239_560, "cardigan", "Taylor Swift", 239_000),
        ("Apocalypse", "Cigarettes After Sex", 290_146, "Apocalypse", "Cigarettes After Sex", 290_000),
        ("Those Eyes", "New West", 220_750, "Those Eyes", "New West", 220_000),
        ("Secukupnya", "Hindia", 252_000, "Secukupnya", "Hindia", 252_000),
        ("Rumpang", "Nadin Amizah", 240_000, "Rumpang", "Nadin Amizah", 240_000),
        ("Monokrom", "Tulus", 230_000, "Monokrom", "Tulus", 230_000),
        ("Dan...", "Sheila On 7", 260_000, "Dan...", "Sheila On 7", 260_000),
        ("Do I Wanna Know?", "Arctic Monkeys", 272_000, "Do I Wanna Know?", "Arctic Monkeys", 272_000),
        ("Yellow", "Coldplay", 267_000, "Yellow", "Coldplay", 267_000),
        ("Blinding Lights", "The Weeknd", 200_000, "Blinding Lights", "The Weeknd", 200_000),
        ("Let It Happen", "Tame Impala", 467_000, "Let It Happen", "Tame Impala", 467_000),
        ("Creep", "Radiohead", 239_000, "Creep", "Radiohead", 239_000),
        (
            "Message In A Bottle",
            "Taylor Swift",
            190_000,
            "Message In A Bottle (Taylor's Version) [From The Vault]",
            "Taylor Swift",
            190_000,
        ),
        ("オトノケ - Otonoke", "Creepy Nuts", 194_000, "オトノケ - Otonoke", "Creepy Nuts", 194_000),
        ("Mungkin Nanti", "Peterpan", 240_000, "Mungkin Nanti", "Peterpan", 240_000),
        ("Bad Habit", "Steve Lacy", 232_000, "Bad Habit", "Steve Lacy", 232_000),
        (
            "After Last Night",
            "Bruno Mars",
            290_000,
            "After Last Night (with Thundercat & Bootsy Collins) (feat. Thundercat & Bootsy Collins)",
            "Bruno Mars, Anderson .Paak & Silk Sonic",
            290_000,
        ),
    ]
}

#[test]
#[ignore]
fn semua_sampel_nyata_diterima_otomatis() {
    let mut otomatis = 0;
    let mut review = 0;
    let mut gagal = 0;

    println!("=== PENSKORAN TERHADAP KATALOG NYATA ===\n");
    for (j, a, d, kj, ka, kd) in data() {
        let k = Kandidat {
            video_id: "v".into(),
            judul: kj.into(),
            artis: ka.into(),
            durasi_ms: Some(kd),
        };
        let (_, p) = pilih_terbaik(j, a, a, Some(d), &[k]).expect("harus ada penilaian");
        let keputusan = sebut_keputusan(p.keputusan);
        match p.keputusan {
            kaset_lib::import::cocok::Keputusan::Otomatis => otomatis += 1,
            kaset_lib::import::cocok::Keputusan::Review => review += 1,
            kaset_lib::import::cocok::Keputusan::TidakAda => gagal += 1,
        }
        println!("  {:.2} {:<10} {} — {}  [{}]", p.skor, keputusan, j, a, p.alasan.join(", "));
    }

    println!("\notomatis: {otomatis} | review: {review} | tidak ada: {gagal}");
    assert_eq!(gagal, 0, "semua sampel harus setidaknya masuk review");
    assert!(
        otomatis >= 17,
        "minimal 17 dari 20 harus otomatis, dapat {otomatis}"
    );
}