//! Modul Deteksi Skrip dan Romanisasi CJK Lokal di Rust (FEATURES-V3 §4 L6).
//!
//! Spesifikasi:
//! - Deteksi skrip Unicode:
//!   - Hangul (U+AC00..U+D7AF, U+1100..U+11FF, U+3130..U+318F) -> Korea
//!   - Hiragana (U+3040..U+309F) & Katakana (U+30A0..U+30FF, U+FF66..U+FF9F) -> Jepang
//!   - CJK Unified Ideographs (U+4E00..U+9FFF, U+3400..U+4DBF, ekstensi astral) tanpa Kana -> Mandarin
//! - Romanisasi Hangul deterministik berdasarkan Revised Romanization of Korean (standar resmi Korea).
//! - Romanisasi Jepang (Kanji + Kana) memakai kamus JMdict dari crate `ib-romaji` (Hepburn).
//! - Transkripsi Mandarin memakai crate `pinyin` (nada dipertahankan, sama seperti tabel lama).
//! - Segmen alfabet Latin / angka / tanda baca tetap dipertahankan apa adanya.
//!
//! ## Perilaku fallback (disepakati di FEATURES-V3 §4 L6)
//!
//! Kalau satu baris masih menyisakan aksara CJK setelah dikonversi (kanji langka
//! di luar kamus, atau aksara yang belum didukung), `romanize_line` mengembalikan
//! `None` — bukan teks setengah-kanji. UI sudah menyembunyikan baris romanisasi
//! yang kosong, jadi pengguna melihat baris aslinya saja. Alasannya: romanisasi
//! separuh lebih menyesatkan daripada tidak ada sama sekali, dan perilaku ini
//! tidak butuh kolom atau penanda baru di UI.
//!
//! ## Batasan yang diketahui
//!
//! - Bacaan kanji bergantung kamus, bukan analisis morfologi penuh; nama orang
//!   dan bacaan tak umum bisa salah atau tidak ditemukan (-> fallback `None`).
//! - Korea: aturan liaison dasar (final pindah ke suku kata berikut yang mulai
//!   dengan ㅇ) diterapkan; asimilasi nasal, tensifikasi, dan final ganda tidak.
//! - Kanji di lagu Mandarin dibaca pinyin; kanji di lagu Jepang dibaca Jepang
//!   berdasarkan skrip lagu (baris tanpa kana memakai skrip lagu sebagai petunjuk).

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CjkScript {
    Japanese,
    Korean,
    Mandarin,
    None,
}

// ---------------------------------------------------------------------------
// 0. Rentang Unicode
// ---------------------------------------------------------------------------

/// Hiragana (tanpa tanda gabung U+3099/U+309A yang bukan huruf).
pub fn is_hiragana(c: char) -> bool {
    (0x3041..=0x3096).contains(&(c as u32)) || (0x309D..=0x309F).contains(&(c as u32))
}

/// Katakana, termasuk bentuk setengah lebar U+FF66..U+FF9F.
pub fn is_katakana(c: char) -> bool {
    (0x30A1..=0x30FA).contains(&(c as u32))
        || (0x30FC..=0x30FF).contains(&(c as u32))
        || (0xFF66..=0xFF9F).contains(&(c as u32))
}

/// Hanzi/kanji: Unified Ideographs, Extension A, Compatibility, dan ekstensi astral.
pub fn is_han(c: char) -> bool {
    let u = c as u32;
    (0x4E00..=0x9FFF).contains(&u)
        || (0x3400..=0x4DBF).contains(&u)
        || (0xF900..=0xFAFF).contains(&u)
        || (0x20000..=0x2FA1F).contains(&u)
}

/// Suku kata Hangul modern (U+AC00..U+D7A3).
pub fn is_hangul_syllable(c: char) -> bool {
    (0xAC00..=0xD7A3).contains(&(c as u32))
}

/// Jamo Hangul: blok Jamo (U+1100..U+11FF) dan Jamo kompatibilitas (U+3130..U+318F).
pub fn is_hangul_jamo(c: char) -> bool {
    (0x1100..=0x11FF).contains(&(c as u32)) || (0x3130..=0x318F).contains(&(c as u32))
}

pub fn is_hangul(c: char) -> bool {
    is_hangul_syllable(c) || is_hangul_jamo(c)
}

/// Semua aksara yang wajib hilang dari keluaran mode romaji.
pub fn is_cjk(c: char) -> bool {
    is_hiragana(c) || is_katakana(c) || is_han(c) || is_hangul(c)
}

/// Mendeteksi skrip dominan dari teks lirik (atau sampel beberapa baris).
pub fn detect_script(text: &str) -> CjkScript {
    let mut has_hangul = false;
    let mut has_kana = false;
    let mut has_hanzi = false;

    for c in text.chars() {
        if is_hangul(c) {
            has_hangul = true;
        } else if is_hiragana(c) || is_katakana(c) {
            has_kana = true;
        } else if is_han(c) {
            has_hanzi = true;
        }
    }

    if has_hangul {
        CjkScript::Korean
    } else if has_kana {
        CjkScript::Japanese
    } else if has_hanzi {
        CjkScript::Mandarin
    } else {
        CjkScript::None
    }
}

/// Melakukan romanisasi satu baris teks.
///
/// `script` adalah skrip lagu (hasil `detect_script` pada sampel lirik). Ia hanya
/// dipakai sebagai petunjuk untuk baris yang isinya han tanpa kana: di lagu
/// Jepang baris seperti itu dibaca sebagai kanji, di lagu Mandarin sebagai pinyin.
/// Skrip per baris tetap menang kalau baris itu punya kana atau hangul sendiri.
///
/// Mengembalikan `None` bila baris tidak mengandung CJK sama sekali, atau bila
/// masih ada CJK yang tak terkonversi (lihat catatan fallback di atas).
pub fn romanize_line(text: &str, script: CjkScript) -> Option<String> {
    if !text.chars().any(is_cjk) {
        return None;
    }

    let teks = normalisasi_kana_setengah_lebar(text);
    let ada_kana = teks.chars().any(|c| is_hiragana(c) || is_katakana(c));
    let jepang = ada_kana || matches!(script, CjkScript::Japanese);

    let chars: Vec<char> = teks.chars().collect();
    let mut out = String::with_capacity(teks.len() * 2);
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if is_hangul(c) {
            let j = run_selama(&chars, i, is_hangul);
            let potong: String = chars[i..j].iter().collect();
            out.push_str(&romanize_korean(&potong));
            i = j;
        } else if is_hiragana(c) || is_katakana(c) || (jepang && is_han(c)) {
            let j = run_selama(&chars, i, |c| is_hiragana(c) || is_katakana(c) || is_han(c));
            let potong: String = chars[i..j].iter().collect();
            out.push_str(&romanize_japanese(&potong));
            i = j;
        } else if is_han(c) {
            let j = run_selama(&chars, i, is_han);
            let potong: String = chars[i..j].iter().collect();
            out.push_str(&romanize_mandarin_basic(&potong));
            i = j;
        } else {
            let ascii = tanda_baca_ke_ascii(c);
            out.push(ascii);
            // Baris romaji lebih terbaca kalau tanda baca diikuti spasi:
            // ありがとう、またね -> "arigatou, matane". Tidak ada spasi sebelum
            // tanda penutup ("」" -> '"') supaya hasilnya `matane."`.
            let berikut = chars.get(i + 1).copied();
            if matches!(ascii, ',' | '.' | '!' | '?' | ':' | ';')
                && berikut.is_some_and(|n| !tanda_baca_penutup(n))
            {
                out.push(' ');
            }
            i += 1;
        }
    }

    let rapi = rapikan_spasi(&out);
    if let Some(sisa) = rapi.chars().find(|&c| is_cjk(c)) {
        tracing::debug!(
            sisa = %sisa,
            teks = %text,
            "romanisasi tidak lengkap, baris dilewati (fallback None)"
        );
        return None;
    }
    if rapi.is_empty() { None } else { Some(rapi) }
}

fn run_selama(chars: &[char], mulai: usize, cocok: impl Fn(char) -> bool) -> usize {
    let mut j = mulai;
    while j < chars.len() && cocok(chars[j]) {
        j += 1;
    }
    j
}

/// Merapikan spasi ganda dan spasi di awal/akhir.
fn rapikan_spasi(teks: &str) -> String {
    teks.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Tanda baca Jepang/CJK yang lebih enak dibaca sebagai ASCII di baris romaji.
fn tanda_baca_ke_ascii(c: char) -> char {
    match c {
        '「' | '」' | '『' | '』' => '"',
        '、' => ',',
        '。' => '.',
        '・' => ' ',
        '！' => '!',
        '？' => '?',
        '（' => '(',
        '）' => ')',
        '：' => ':',
        '；' => ';',
        '〜' | '～' => '~',
        _ => c,
    }
}

/// Tanda baca yang menempel ke kata sebelumnya, bukan memulai bagian baru.
fn tanda_baca_penutup(c: char) -> bool {
    matches!(
        c,
        '」' | '』'
            | '）'
            | ')'
            | ']'
            | '}'
            | '"'
            | '\''
            | '、'
            | '。'
            | '，'
            | '．'
            | '！'
            | '？'
            | '!'
            | '?'
            | ','
            | '.'
            | ':'
            | ';'
            | '…'
            | '〜'
            | '～'
    )
}

// ---------------------------------------------------------------------------
// 1. Normalisasi Katakana setengah lebar (U+FF66..U+FF9F)
// ---------------------------------------------------------------------------

/// Mengubah katakana setengah lebar menjadi katakana penuh supaya bisa masuk
/// ke romanizer. Tanpa ini, karakter U+FF66..U+FF9F lolos apa adanya.
fn normalisasi_kana_setengah_lebar(teks: &str) -> String {
    if !teks
        .chars()
        .any(|c| (0xFF66..=0xFF9F).contains(&(c as u32)))
    {
        return teks.to_string();
    }

    let chars: Vec<char> = teks.chars().collect();
    let mut out = String::with_capacity(teks.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        let Some(dasar) = kana_setengah_ke_penuh(c) else {
            out.push(c);
            i += 1;
            continue;
        };

        // Tanda dakuten/handakuten bisa menempel sebagai karakter terpisah.
        let mark = chars.get(i + 1).copied();
        let hasil = match mark {
            Some('\u{FF9E}') => tambah_dakuten(dasar),
            Some('\u{FF9F}') => tambah_handakuten(dasar),
            _ => None,
        };
        match hasil {
            Some(kana) => {
                out.push(kana);
                i += 2;
            }
            None => {
                out.push(dasar);
                i += 1;
            }
        }
    }

    out
}

fn kana_setengah_ke_penuh(c: char) -> Option<char> {
    let kana = match c {
        'ｦ' => 'ヲ',
        'ｧ' => 'ァ',
        'ｨ' => 'ィ',
        'ｩ' => 'ゥ',
        'ｪ' => 'ェ',
        'ｫ' => 'ォ',
        'ｬ' => 'ャ',
        'ｭ' => 'ュ',
        'ｮ' => 'ョ',
        'ｯ' => 'ッ',
        'ｰ' => 'ー',
        'ｱ' => 'ア',
        'ｲ' => 'イ',
        'ｳ' => 'ウ',
        'ｴ' => 'エ',
        'ｵ' => 'オ',
        'ｶ' => 'カ',
        'ｷ' => 'キ',
        'ｸ' => 'ク',
        'ｹ' => 'ケ',
        'ｺ' => 'コ',
        'ｻ' => 'サ',
        'ｼ' => 'シ',
        'ｽ' => 'ス',
        'ｾ' => 'セ',
        'ｿ' => 'ソ',
        'ﾀ' => 'タ',
        'ﾁ' => 'チ',
        'ﾂ' => 'ツ',
        'ﾃ' => 'テ',
        'ﾄ' => 'ト',
        'ﾅ' => 'ナ',
        'ﾆ' => 'ニ',
        'ﾇ' => 'ヌ',
        'ﾈ' => 'ネ',
        'ﾉ' => 'ノ',
        'ﾊ' => 'ハ',
        'ﾋ' => 'ヒ',
        'ﾌ' => 'フ',
        'ﾍ' => 'ヘ',
        'ﾎ' => 'ホ',
        'ﾏ' => 'マ',
        'ﾐ' => 'ミ',
        'ﾑ' => 'ム',
        'ﾒ' => 'メ',
        'ﾓ' => 'モ',
        'ﾔ' => 'ヤ',
        'ﾕ' => 'ユ',
        'ﾖ' => 'ヨ',
        'ﾗ' => 'ラ',
        'ﾘ' => 'リ',
        'ﾙ' => 'ル',
        'ﾚ' => 'レ',
        'ﾛ' => 'ロ',
        'ﾜ' => 'ワ',
        'ﾝ' => 'ン',
        _ => return None,
    };
    Some(kana)
}

fn tambah_dakuten(c: char) -> Option<char> {
    let hasil = match c {
        'カ' => 'ガ',
        'キ' => 'ギ',
        'ク' => 'グ',
        'ケ' => 'ゲ',
        'コ' => 'ゴ',
        'サ' => 'ザ',
        'シ' => 'ジ',
        'ス' => 'ズ',
        'セ' => 'ゼ',
        'ソ' => 'ゾ',
        'タ' => 'ダ',
        'チ' => 'ヂ',
        'ツ' => 'ヅ',
        'テ' => 'デ',
        'ト' => 'ド',
        'ハ' => 'バ',
        'ヒ' => 'ビ',
        'フ' => 'ブ',
        'ヘ' => 'ベ',
        'ホ' => 'ボ',
        'ウ' => 'ヴ',
        'ワ' => 'ヷ',
        'ヰ' => 'ヸ',
        'ヱ' => 'ヹ',
        'ヲ' => 'ヺ',
        _ => return None,
    };
    Some(hasil)
}

fn tambah_handakuten(c: char) -> Option<char> {
    let hasil = match c {
        'ハ' => 'パ',
        'ヒ' => 'ピ',
        'フ' => 'プ',
        'ヘ' => 'ペ',
        'ホ' => 'ポ',
        _ => return None,
    };
    Some(hasil)
}

// ---------------------------------------------------------------------------
// 2. JEPANG: kata kamus -> kana -> kanji (Hepburn)
// ---------------------------------------------------------------------------

fn romanizer_kana() -> &'static ib_romaji::HepburnRomanizer {
    static ROMANIZER: OnceLock<ib_romaji::HepburnRomanizer> = OnceLock::new();
    ROMANIZER.get_or_init(|| ib_romaji::HepburnRomanizer::builder().kana(true).build())
}

/// Romanizer lengkap (kana + kata + kanji) milik `ib-romaji`.
///
/// Catatan: membangun romanizer dengan `word(true)` saja **tidak bisa dipakai** —
/// indeks pola Aho-Corasick-nya mulai dari 0 sehingga dibaca sebagai indeks tabel
/// kana (bug di crate; test mereka selalu memakai `kana(true)`). Karena itu kata
/// dicocokkan lewat romanizer lengkap, lalu hasilnya difilter: hanya pencocokan
/// yang lebih dari satu karakter dan mengandung kanji yang diterima.
fn romanizer_kamus() -> &'static ib_romaji::HepburnRomanizer {
    static ROMANIZER: OnceLock<ib_romaji::HepburnRomanizer> = OnceLock::new();
    // Kamus ~4,8 MiB; dibangun sekali per proses, bukan per baris.
    ROMANIZER.get_or_init(ib_romaji::HepburnRomanizer::default)
}

/// Digraf katakana serapan yang tidak ada di tabel kana `ib-romaji`.
const DIGRAF_KATAKANA: &[(&str, &str)] = &[
    ("ヴァ", "va"),
    ("ヴィ", "vi"),
    ("ヴェ", "ve"),
    ("ヴォ", "vo"),
    ("ヴュ", "vyu"),
    ("ヴ", "vu"),
    ("ティ", "ti"),
    ("ディ", "di"),
    ("テュ", "tyu"),
    ("デュ", "dyu"),
    ("トゥ", "tu"),
    ("ドゥ", "du"),
    ("ツァ", "tsa"),
    ("ツィ", "tsi"),
    ("ツェ", "tse"),
    ("ツォ", "tso"),
    ("ファ", "fa"),
    ("フィ", "fi"),
    ("フェ", "fe"),
    ("フォ", "fo"),
    ("フュ", "fyu"),
    ("ウィ", "wi"),
    ("ウェ", "we"),
    ("ウォ", "wo"),
    ("イェ", "ye"),
    ("シェ", "she"),
    ("ジェ", "je"),
    ("チェ", "che"),
    ("ニェ", "nye"),
    ("ヒェ", "hye"),
    ("ビェ", "bye"),
    ("ピェ", "pye"),
    ("ミェ", "mye"),
    ("リェ", "rye"),
    ("キェ", "kye"),
    ("ギェ", "gye"),
    ("スィ", "si"),
    ("ズィ", "zi"),
];

/// Kata yang tidak ada di kamus `ib-romaji` (atau ada dengan bacaan yang salah)
/// dan salah kalau dibaca per kanji.
///
/// Daftar ini sengaja kecil: hanya kata yang sering muncul di lirik dan terbukti
/// keliru lewat pengujian. Kata lain tetap mengandalkan kamus. Tanpa entri ini
/// bacaan on per kanji menghasilkan hal yang menyesatkan seperti
/// 名前 -> meizen, 世界 -> seikai, 友達 -> yuutatsu, 仕事 -> shiji.
const KATA_TETAP: &[(&str, &str)] = &[
    ("今日", "きょう"),
    ("様子", "ようす"),
    ("一人", "ひとり"),
    ("二人", "ふたり"),
    ("子供", "こども"),
    ("本当", "ほんとう"),
    ("大丈夫", "だいじょうぶ"),
    ("名前", "なまえ"),
    ("世界", "せかい"),
    ("何度", "なんど"),
    ("理由", "りゆう"),
    ("過去", "かこ"),
    ("場所", "ばしょ"),
    ("彼女", "かのじょ"),
    ("彼氏", "かれし"),
    ("友達", "ともだち"),
    ("仕事", "しごと"),
    ("普通", "ふつう"),
    // Verba majemuk yang kalau dipecah per kata kamus jadi berspasi salah
    // (立ち上がれ -> "tachi agare").
    ("立ち上が", "たちあが"),
    // Batang verba/adjektiva yang kandidat kamusnya salah (愛し -> hashi).
    ("愛し", "あいし"),
    ("演じ", "えんじ"),
];

/// Bacaan kanji tunggal tanpa okurigana yang tidak bisa diturunkan dari tabel
/// Unihan: bacaan kun pertama di tabel adalah bacaan lama/arkais, bukan yang
/// dipakai sehari-hari (僕 -> しもべ, 役 -> つとめ, 愛 -> いとしい).
const BACAAN_TUNGGAL: &[(char, &str)] = &[
    ('僕', "ぼく"),
    ('愛', "あい"),
    ('役', "やく"),
    ('皆', "みんな"),
    ('形', "かたち"),
];

/// Partikel yang berdiri sendiri. Dibaca dengan pelafalannya, bukan ejaannya.
const PARTIKEL: &[char] = &[
    'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'の', 'も', 'や', 'か', 'ね', 'よ', 'わ', 'さ', 'な',
];

/// Awalan kana yang dimulai dengan partikel で tetapi sebenarnya satu kata.
const BUKAN_PARTIKEL_DE: &[&str] = &[
    "です", "でし", "でも", "でき", "でる", "でた", "でん", "であ",
];

/// Awalan kana yang dimulai dengan と + partikel tetapi sebenarnya satu kata.
const BUKAN_PARTIKEL_T: &[&str] = &["とにかく", "とにもかくにも", "とにかくに"];

#[derive(Clone, Copy, PartialEq, Eq)]
enum JenisPotongan {
    /// Kata dari kamus atau bacaan kanji.
    Kata,
    /// Potongan kana yang bukan partikel.
    Kana,
    /// Partikel yang berdiri sendiri.
    Partikel,
    /// Tanda baca, spasi, atau teks non-CJK: diteruskan apa adanya.
    Lain,
}

struct Potongan {
    teks: String,
    jenis: JenisPotongan,
    /// Tidak ada spasi antara potongan ini dan kana di sebelahnya. Dipakai untuk
    /// okurigana yang menyambung bacaan kanji (僕 + ら) dan untuk batang verba
    /// hasil kamus (出し + たい).
    rapat: bool,
    /// Potongan kana ini dimulai dengan partikel (とか, から). Dipakai untuk
    /// memutus sambungan ke kata sebelumnya.
    partikel_awal: bool,
    /// Kata yang berakhir di kana baris e (逃げ, 投げ) biasanya batang verba yang
    /// menyambung ke kata berikutnya: 逃げ + 出す = nigedasu.
    rapat_kata: bool,
}

/// Romanisasi segmen Jepang. Karakter di luar kamus dibiarkan, lalu
/// `romanize_line` yang memutuskan fallback-nya.
fn romanize_japanese(input: &str) -> String {
    let mut potongan: Vec<Potongan> = Vec::new();
    let mut sisa = input;

    while !sisa.is_empty() {
        // 0. Kata tetap (kata yang tidak ada di kamus `ib-romaji`).
        if let Some((len, romaji)) = kata_tetap(sisa) {
            potongan.push(kata(romaji, sisa, len));
            sisa = &sisa[len..];
            continue;
        }

        // 1. Kata utuh dari kamus. Pencocokan boleh melewati batas kanji
        //    (出し, 逃げ, 小さな), karena kamus lebih tahu bacaan + okurigana-nya.
        if let Some((len, romaji)) = pilih_kata(sisa) {
            potongan.push(kata(romaji, sisa, len));
            sisa = &sisa[len..];
            continue;
        }

        let c = sisa.chars().next().expect("sisa tidak kosong");

        // 2. Kana: satu gelombang kana, lalu partikelnya dipisah.
        if is_hiragana(c) || is_katakana(c) {
            let (gelombang, byte) = ambil_kana(sisa);
            let setelah_kata =
                matches!(potongan.last().map(|p| p.jenis), Some(JenisPotongan::Kata));
            pecah_kana(&gelombang, setelah_kata, &mut potongan);
            sisa = &sisa[byte..];
            continue;
        }

        // 3. Kanji: kamus sudah gagal, jadi tabel bacaan on/kun (Unihan).
        if is_han(c) {
            let (romaji, habis) = bacakan_kanji(sisa);
            potongan.push(Potongan {
                teks: romaji,
                jenis: JenisPotongan::Kata,
                rapat: false,
                partikel_awal: false,
                rapat_kata: false,
            });
            sisa = &sisa[habis..];
            continue;
        }

        potongan.push(Potongan {
            teks: tanda_baca_ke_ascii(c).to_string(),
            jenis: JenisPotongan::Lain,
            rapat: false,
            partikel_awal: false,
            rapat_kata: false,
        });
        sisa = &sisa[c.len_utf8()..];
    }

    rakit_potongan(&potongan)
}

fn kata(teks: String, sisa: &str, len: usize) -> Potongan {
    Potongan {
        teks,
        jenis: JenisPotongan::Kata,
        rapat: romaji_berakhir_kana(sisa, len),
        partikel_awal: false,
        rapat_kata: berakhir_kana_e(sisa, len),
    }
}

/// Kata kamus yang berakhir di kana baris e hampir selalu batang verba
/// (逃げ, 投げ, 食べ) yang menyambung ke kata berikutnya.
fn berakhir_kana_e(sisa: &str, len: usize) -> bool {
    sisa[..len].chars().next_back().is_some_and(|c| {
        matches!(
            c,
            'え' | 'け'
                | 'げ'
                | 'せ'
                | 'ぜ'
                | 'て'
                | 'で'
                | 'ね'
                | 'へ'
                | 'べ'
                | 'ぺ'
                | 'め'
                | 'れ'
        )
    })
}

/// Kata tetap yang cocok di awal `sisa` -> (jumlah byte, romaji).
fn kata_tetap(sisa: &str) -> Option<(usize, String)> {
    KATA_TETAP
        .iter()
        .filter(|(kata, _)| sisa.starts_with(kata))
        .max_by_key(|(kata, _)| kata.len())
        .map(|(kata, bacaan)| (kata.len(), bacaan_ke_romaji(bacaan)))
}

/// Pilih kandidat kamus terbaik untuk awalan `sisa`.
///
/// `ib-romaji` mengembalikan kandidat urut alfabetis, bukan urut frekuensi
/// (言葉 -> ["ji", "ketoba", "kotoba", "shi"]), jadi kandidat pertama tidak bisa
/// dipakai langsung. Yang dipakai: rentang terpanjang, lalu skor yang menolak
/// romaji dengan vokal lebih sedikit daripada jumlah kanji dan memberi bonus
/// pada kandidat yang diawali bacaan kanji pertama.
fn pilih_kata(sisa: &str) -> Option<(usize, String)> {
    let kandidat = romanizer_kamus().romanize_vec(sisa);
    let span = kandidat.iter().map(|(len, _)| *len).max()?;
    let potong = sisa.get(..span)?;
    let jumlah_karakter = potong.chars().count();
    if jumlah_karakter < 2 || !potong.chars().any(is_han) {
        return None;
    }

    let awal = potong.chars().next()?;
    let (on_awal, kun_awal) = bacaan_kanji(awal);

    // Entri kamus berupa ungkapan bisa menelan partikel (夜が明ける, 今日は).
    // Kalau dipakai utuh, partikelnya ikut jadi bagian bacaan dan hilang.
    if kandidat_menelan_partikel(potong) {
        return None;
    }

    let mut terbaik: Option<(i32, usize, String)> = None;
    for (len, romaji) in kandidat {
        if len != span {
            continue;
        }
        let skor = skor_kata(romaji, jumlah_karakter, &on_awal, &kun_awal);
        let lebih_baik = match &terbaik {
            Some((skor_terbaik, _, _)) => skor > *skor_terbaik,
            None => true,
        };
        if lebih_baik {
            terbaik = Some((skor, len, romaji.to_string()));
        }
    }

    terbaik.map(|(_, len, romaji)| (len, romaji))
}

/// Apakah rentang kamus menelan partikel yang seharusnya berdiri sendiri?
///
/// Kamus memuat ungkapan seperti 夜が明ける dan 今日は. Kalau rentang itu dipakai
/// utuh, partikelnya ikut masuk bacaan dan tidak lagi dibaca sebagai partikel
/// (夜が明ける -> yogaakeru, 今日は -> konichiha). Partikel の dikecualikan karena
/// ia memang sering berada di dalam satu rentang kata.
fn kandidat_menelan_partikel(potong: &str) -> bool {
    let chars: Vec<char> = potong.chars().collect();
    if chars
        .last()
        .is_some_and(|c| matches!(c, 'は' | 'へ' | 'を'))
    {
        return true;
    }
    chars
        .windows(2)
        .any(|w| w[0] != 'の' && PARTIKEL.contains(&w[0]) && is_han(w[1]))
}

fn skor_kata(romaji: &str, jumlah_karakter: usize, on: &[&str], kun: &[&str]) -> i32 {
    let vokal = romaji
        .chars()
        .filter(|c| matches!(c, 'a' | 'i' | 'u' | 'e' | 'o'))
        .count();

    // Satu vokal tidak bisa menutupi dua kanji: 言葉 -> "ji" dan "shi" dibuang.
    let skor = if vokal < jumlah_karakter { -50 } else { 0 };

    // Kandidat yang diawali bacaan kanji pertama lebih mungkin benar:
    // 言葉 -> "kotoba" diawali こと (kun 言), "ketoba" tidak.
    let mut bonus = 0;
    for bacaan in on.iter().chain(kun.iter()) {
        let romaji_bacaan = bacaan_ke_romaji(bacaan);
        if !romaji_bacaan.is_empty() && romaji.starts_with(&romaji_bacaan) {
            bonus = bonus.max(romaji_bacaan.chars().count() as i32 * 4);
        }
    }

    skor + bonus
}

/// Apakah potongan `&sisa[..len]` berakhir dengan kana? Kalau ya, kana sesudahnya
/// adalah lanjutan kata yang sama (出し + たい), jadi tidak diberi spasi.
fn romaji_berakhir_kana(sisa: &str, len: usize) -> bool {
    sisa[..len]
        .chars()
        .next_back()
        .is_some_and(|c| is_hiragana(c) || is_katakana(c))
}

/// Gelombang kana terpanjang di awal `sisa` -> (karakter, jumlah byte).
///
/// Hiragana dan katakana tidak bercampur dalam satu kata, jadi pergantian
/// aksara memutus gelombang: エンドロールに adalah dua potongan.
fn ambil_kana(sisa: &str) -> (Vec<char>, usize) {
    let mut kana = Vec::new();
    let mut byte = 0;
    let mut hiragana: Option<bool> = None;
    for c in sisa.chars() {
        if !(is_hiragana(c) || is_katakana(c)) {
            break;
        }
        let ini_hiragana = is_hiragana(c);
        match hiragana {
            None => hiragana = Some(ini_hiragana),
            Some(sebelum) if sebelum != ini_hiragana && c != 'ー' => break,
            _ => {}
        }
        kana.push(c);
        byte += c.len_utf8();
    }
    (kana, byte)
}

/// Pecah satu gelombang kana menjadi potongan kata dan partikel.
///
/// Heuristiknya terbatas pada pola yang paling sering muncul dan paling kecil
/// risikonya:
/// - kana tunggal yang termasuk partikel -> partikel;
/// - は/へ/を di ujung gelombang -> partikel (dibaca wa/e/o);
/// - で di awal gelombang sesudah kata kanji -> partikel (頭でわかって);
/// - と + partikel di awal gelombang -> dua partikel (寂しいとか);
/// - の di ujung gelombang sesudah kata kanji -> partikel (だらけの).
fn pecah_kana(kana: &[char], setelah_kata: bool, keluar: &mut Vec<Potongan>) {
    let mut mulai = 0;

    if setelah_kata && kana.len() >= 3 && kana[0] == 'で' && !diawali_kata_de(kana) {
        keluar.push(partikel('で'));
        mulai = 1;
    }

    if setelah_kata
        && kana.len() - mulai >= 2
        && kana[mulai] == 'と'
        && PARTIKEL.contains(&kana[mulai + 1])
        && !diawali_kata_t(&kana[mulai..])
    {
        keluar.push(partikel('と'));
        keluar.push(partikel(kana[mulai + 1]));
        mulai += 2;
    }

    let sisa = &kana[mulai..];
    match sisa {
        [] => {}
        [c] if PARTIKEL.contains(c) => keluar.push(partikel(*c)),
        [.., akhir] if matches!(akhir, 'は' | 'へ' | 'を') => {
            push_kana(&sisa[..sisa.len() - 1], keluar);
            keluar.push(partikel(*akhir));
        }
        [.., 'の'] if setelah_kata && mulai == 0 => {
            push_kana(&sisa[..sisa.len() - 1], keluar);
            keluar.push(partikel('の'));
        }
        _ => {
            if !pecah_partikel_ujung(sisa, keluar) {
                push_kana(sisa, keluar);
            }
        }
    }
}

/// Partikel di ujung gelombang kana yang panjang: 明けるまで -> akeru made,
/// さよならだけが -> ... dake ga.
///
/// Daftar ini sengaja terbatas pada partikel yang jarang menjadi akhiran kata
/// biasa. で, と, に, の tidak ikut karena banyak kata berakhiran bunyi itu
/// (おもいで, こと, たに, もの) dan akan terpotong salah.
const PARTIKEL_UJUNG: &[&str] = &[
    "なんて",
    "くらい",
    "まで",
    "から",
    "けど",
    "ので",
    "のに",
    "だけ",
    "しか",
    "より",
    "ほど",
    "って",
    "など",
    "が",
    "も",
    "や",
    "か",
    "ね",
    "よ",
    "わ",
    "な",
];

/// Potong partikel ujung kalau gelombangnya cukup panjang (>= 4 kana) dan
/// masih menyisakan minimal dua kana di depan. Gelombang pendek (かな, そば)
/// dibiarkan utuh.
fn pecah_partikel_ujung(sisa: &[char], keluar: &mut Vec<Potongan>) -> bool {
    if sisa.len() < 4 {
        return false;
    }
    let teks: String = sisa.iter().collect();
    for pola in PARTIKEL_UJUNG {
        let Some(depan) = teks.strip_suffix(pola) else {
            continue;
        };
        if depan.chars().count() < 2 {
            continue;
        }
        let depan: Vec<char> = depan.chars().collect();
        push_kana(&depan, keluar);
        let partikel_kana: Vec<char> = pola.chars().collect();
        keluar.push(Potongan {
            teks: romanisasi_kana(&partikel_kana),
            jenis: JenisPotongan::Partikel,
            rapat: false,
            partikel_awal: true,
            rapat_kata: false,
        });
        return true;
    }
    false
}

fn diawali_kata_de(kana: &[char]) -> bool {
    BUKAN_PARTIKEL_DE.iter().any(|kata| {
        let pola: Vec<char> = kata.chars().collect();
        pola.len() <= kana.len() && kana[..pola.len()] == pola[..]
    })
}

fn diawali_kata_t(kana: &[char]) -> bool {
    BUKAN_PARTIKEL_T.iter().any(|kata| {
        let pola: Vec<char> = kata.chars().collect();
        pola.len() <= kana.len() && kana[..pola.len()] == pola[..]
    })
}

fn push_kana(kana: &[char], keluar: &mut Vec<Potongan>) {
    let Some(awal) = kana.first() else {
        return;
    };
    // Satu kana sesudah kanji hampir selalu bagian kata yang sama (僕ら), begitu
    // juga kana yang tidak mungkin memulai kata (づ, っ, kana kecil).
    let rapat = kana.len() == 1 || diawali_kana_langka(*awal);
    keluar.push(Potongan {
        teks: romanisasi_kana(kana),
        jenis: JenisPotongan::Kana,
        rapat,
        partikel_awal: PARTIKEL.contains(awal) || diawali_partikel_kata(kana),
        rapat_kata: false,
    });
}

/// Apakah gelombang kana dimulai dengan partikel atau kata partikelik
/// (から, まで, だけ). Dipakai untuk memutus sambungan ke kata kamus sebelumnya:
/// 明ける + まで harus "akeru made", bukan "akerumade".
fn diawali_partikel_kata(kana: &[char]) -> bool {
    PARTIKEL_UJUNG.iter().any(|pola| {
        let pola: Vec<char> = pola.chars().collect();
        pola.len() >= 2 && pola.len() <= kana.len() && kana[..pola.len()] == pola[..]
    })
}

/// Kana yang tidak lazim memulai kata baru sesudah kanji: 気づく, 転がっ.
fn diawali_kana_langka(c: char) -> bool {
    matches!(
        c,
        'づ' | 'ぢ' | 'っ' | 'ゃ' | 'ゅ' | 'ょ' | 'ぁ' | 'ぃ' | 'ぅ' | 'ぇ' | 'ぉ' | 'ゎ'
    )
}

fn partikel(c: char) -> Potongan {
    let teks = match c {
        'は' => "wa".to_string(),
        'へ' => "e".to_string(),
        'を' => "o".to_string(),
        _ => romanisasi_kana(&[c]),
    };
    Potongan {
        teks,
        jenis: JenisPotongan::Partikel,
        rapat: false,
        partikel_awal: true,
        rapat_kata: false,
    }
}

/// Gabungkan potongan jadi satu baris romaji berspasi.
fn rakit_potongan(potongan: &[Potongan]) -> String {
    let mut out = String::new();
    let mut sebelum: Option<&Potongan> = None;

    for p in potongan {
        if p.teks.is_empty() {
            continue;
        }
        let spasi = match sebelum {
            None => false,
            Some(s) if s.jenis == JenisPotongan::Lain => spasi_setelah_lain(s, p),
            Some(_) if p.jenis == JenisPotongan::Lain => false,
            Some(s) if s.jenis == JenisPotongan::Kata && p.jenis == JenisPotongan::Kana => {
                !(p.rapat || (s.rapat && !p.partikel_awal))
            }
            Some(s) if s.jenis == JenisPotongan::Kata && p.jenis == JenisPotongan::Kata => {
                !s.rapat_kata
            }
            _ => true,
        };
        if spasi {
            out.push(' ');
        }
        out.push_str(&p.teks);
        sebelum = Some(p);
    }

    out
}

/// Tanda baca ASCII diikuti spasi supaya baris romaji terbaca
/// (ありがとう、またね -> "arigatou, matane"). Spasi tidak ditambahkan sebelum
/// tanda baca penutup seperti `"` atau `)`.
fn spasi_setelah_lain(sebelum: &Potongan, sesudah: &Potongan) -> bool {
    let akhir = sebelum.teks.chars().next_back();
    let awal = sesudah.teks.chars().next();
    matches!(akhir, Some(',' | '.' | '!' | '?' | ':' | ';'))
        && awal.is_some_and(|c| c.is_alphanumeric())
}

/// Romanisasi sederhana satu gelombang kana: ー memanjangkan vokal sebelumnya,
/// digraf serapan ditangani sendiri karena tidak ada di tabel `ib-romaji`.
fn romanisasi_kana(kana: &[char]) -> String {
    let teks: String = kana.iter().collect();
    let mut out = String::with_capacity(teks.len() * 2);
    let mut sisa = teks.as_str();

    while !sisa.is_empty() {
        let c = sisa.chars().next().expect("sisa tidak kosong");
        if c == 'ー' {
            if let Some(vokal) = vokal_terakhir(&out) {
                out.push(vokal);
            }
            sisa = &sisa[c.len_utf8()..];
            continue;
        }
        if let Some((len, romaji)) = digraf_katakana(sisa) {
            out.push_str(romaji);
            sisa = &sisa[len..];
            continue;
        }
        if let Some((len, romaji)) = romanizer_kana().romanize_kana(sisa) {
            out.push_str(romaji);
            sisa = &sisa[len..];
            continue;
        }
        out.push(tanda_baca_ke_ascii(c));
        sisa = &sisa[c.len_utf8()..];
    }

    out
}

fn vokal_terakhir(out: &str) -> Option<char> {
    out.chars()
        .rev()
        .find(|c| c.is_ascii_alphabetic())
        .filter(|c| matches!(c, 'a' | 'i' | 'u' | 'e' | 'o'))
}

fn digraf_katakana(sisa: &str) -> Option<(usize, &'static str)> {
    for (pola, romaji) in DIGRAF_KATAKANA {
        if sisa.starts_with(pola) {
            return Some((pola.len(), romaji));
        }
    }
    None
}

/// Bacakan deretan kanji. Mengembalikan (romaji, jumlah byte yang dipakai).
///
/// Aturan pemilihan bacaan (lihat catatan batasan modul):
/// - kanji majemuk (>= 2 kanji berurutan) -> on'yomi tiap kanji, dengan
///   apostrof sebelum vokal sesudah ん (ゼン + イン -> zen'in).
/// - kanji tunggal + okurigana -> bacaan yang cocok dengan okurigana itu
///   (lihat `bacaan_dengan_okurigana`).
/// - kanji tunggal tanpa okurigana -> `BACAAN_TUNGGAL`, lalu kun'yomi pertama
///   yang bukan bentuk kamus verba.
fn bacakan_kanji(sisa: &str) -> (String, usize) {
    let (kanji, byte_kanji) = ambil_kanji(sisa);
    let sisa_okurigana = &sisa[byte_kanji..];
    let okurigana: String = sisa_okurigana
        .chars()
        .take_while(|&c| is_hiragana(c))
        .collect();

    if kanji.len() >= 2 {
        let mut out = String::new();
        for c in &kanji {
            let (on, kun) = bacaan_kanji(*c);
            match on.first().or_else(|| kun.first()) {
                Some(b) => sambung_romaji(&mut out, &bacaan_ke_romaji(b)),
                // Tidak ada data: biarkan kanji apa adanya supaya
                // `romanize_line` memicu fallback, bukan menghilangkannya.
                None => out.push(*c),
            }
        }
        return (out, byte_kanji);
    }

    let c = kanji[0];
    let (on, kun) = bacaan_kanji(c);

    if !okurigana.is_empty() {
        if let Some((bacaan, dipakai)) = bacaan_dengan_okurigana(&kun, &okurigana) {
            return (bacaan_ke_romaji(&bacaan), byte_kanji + dipakai);
        }
    }

    if let Some(b) = bacaan_tunggal(c) {
        return (bacaan_ke_romaji(b), byte_kanji);
    }
    if let Some(b) = pilih_kun_tunggal(&kun) {
        return (bacaan_ke_romaji(b), byte_kanji);
    }
    if let Some(b) = on.first() {
        return (bacaan_ke_romaji(b), byte_kanji);
    }

    // Tidak ada data: biarkan kanji apa adanya, `romanize_line` akan fallback.
    (c.to_string(), byte_kanji)
}

/// Ambil deretan kanji di awal `sisa`, berhenti sebelum kata kamus yang dimulai
/// di tengah deretan dan melewati batas kanji (逃げ di 最後逃げ), supaya
/// 最後 + 逃げ tidak ditelan jadi 最後逃. Kata kamus yang seluruhnya kanji
/// (観者 di 傍観者) tidak memutus deretan: bacaan per kanji lebih baik.
fn ambil_kanji(sisa: &str) -> (Vec<char>, usize) {
    let mut kanji = Vec::new();
    let mut byte = 0;
    for c in sisa.chars() {
        if !is_han(c) {
            break;
        }
        if let Some(&pertama) = kanji.first() {
            // Kanji yang punya bacaan tetap sendiri (皆, 僕) lebih baik dilepas
            // dulu: 皆必死 = 皆 + 必死, bukan kai + hitsu + shi.
            if kanji.len() == 1 && bacaan_tunggal(pertama).is_some() {
                break;
            }
            if let Some((len, _)) = pilih_kata(&sisa[byte..]) {
                if sisa[byte..byte + len].chars().any(|c| !is_han(c)) {
                    break;
                }
            }
        }
        kanji.push(c);
        byte += c.len_utf8();
    }
    (kanji, byte)
}

fn bacaan_tunggal(c: char) -> Option<&'static str> {
    BACAAN_TUNGGAL
        .iter()
        .find(|(kanji, _)| *kanji == c)
        .map(|(_, bacaan)| *bacaan)
}

/// Pilih bacaan kanji tunggal yang cocok dengan okurigana sesudahnya.
/// Mengembalikan (bacaan kana, jumlah byte okurigana yang sudah tercakup).
fn bacaan_dengan_okurigana(kun: &[&str], okurigana: &str) -> Option<(String, usize)> {
    let ok: Vec<char> = okurigana.chars().collect();
    let awal = *ok.first()?;

    // 1. Bacaan yang berakhiran seluruh okurigana: 寂しい -> さびしい.
    if let Some(b) = kun
        .iter()
        .find(|b| b.ends_with(okurigana) && b.chars().count() > ok.len())
    {
        return Some(((*b).to_string(), okurigana.len()));
    }

    // 2. Bacaan bentuk kamus yang berakhir tepat di kana pertama okurigana:
    //    読む + と -> よむ (bukan よむと); sisa "と" dibaca terpisah.
    if let Some(b) = kun
        .iter()
        .find(|b| batang_verba(b).is_some() && b.ends_with(awal))
    {
        return Some(((*b).to_string(), awal.len_utf8()));
    }

    // 3. Batang bentuk kamus + okurigana: 嘆く + いた -> なげいた,
    //    転がる + がってく -> ころがってく (tumpang tindih tidak digandakan).
    //    Okurigana panjang dipotong sesudah て/で sambung supaya kata berikutnya
    //    tidak ikut tertelan: 向かって + ゆく, bukan 向かってゆく.
    let batas = okurigana_efektif(&ok);
    let pakai: String = ok[..batas].iter().collect();
    let mut terbaik: Option<(usize, String)> = None;
    for b in kun {
        let Some(batang) = batang_verba(b) else {
            continue;
        };
        let tumpang = tumpang_tindih(batang, &pakai);
        if tumpang == 0 && PARTIKEL.contains(&awal) {
            // 手を / 気が: partikel bukan bagian dari bacaan kanji.
            continue;
        }
        let gabung = format!("{batang}{}", &pakai[byte_setelah(&ok, tumpang)..]);
        let lebih_baik = match &terbaik {
            Some((tumpang_terbaik, _)) => tumpang > *tumpang_terbaik,
            None => true,
        };
        if lebih_baik {
            terbaik = Some((tumpang, gabung));
        }
    }

    terbaik.map(|(_, gabung)| (gabung, byte_setelah(&ok, batas)))
}

/// Berapa kana okurigana yang boleh dipakai aturan batang verba. Okurigana
/// pendek dipakai seluruhnya; yang panjang dipotong sesudah て/で sambung.
fn okurigana_efektif(ok: &[char]) -> usize {
    if ok.len() <= 4 {
        return ok.len();
    }
    for (i, c) in ok.iter().enumerate().skip(1) {
        if matches!(c, 'て' | 'で') {
            return i + 1;
        }
    }
    ok.len()
}

/// Batang bacaan bentuk kamus verba: なげく -> なげ, ころがる -> ころが.
fn batang_verba(bacaan: &str) -> Option<&str> {
    let mut chars = bacaan.char_indices();
    let (idx, akhir) = chars.next_back()?;
    if idx > 0
        && matches!(
            akhir,
            'う' | 'く' | 'ぐ' | 'す' | 'つ' | 'ぬ' | 'ぶ' | 'む' | 'る'
        )
    {
        Some(&bacaan[..idx])
    } else {
        None
    }
}

/// Panjang tumpang tindih antara ujung `batang` dan awal `okurigana`.
fn tumpang_tindih(batang: &str, okurigana: &str) -> usize {
    let b: Vec<char> = batang.chars().collect();
    let o: Vec<char> = okurigana.chars().collect();
    let maks = b.len().min(o.len());
    for n in (1..=maks).rev() {
        if b[b.len() - n..] == o[..n] {
            return n;
        }
    }
    0
}

fn byte_setelah(chars: &[char], n: usize) -> usize {
    chars.iter().take(n).map(|c| c.len_utf8()).sum()
}

/// Sambung romaji tanpa menabrak batas suku kata: ん sebelum vokal diberi
/// apostrof (zen + in -> zen'in).
fn sambung_romaji(out: &mut String, romaji: &str) {
    let vokal = romaji
        .chars()
        .next()
        .is_some_and(|c| matches!(c, 'a' | 'i' | 'u' | 'e' | 'o' | 'y'));
    if out.ends_with('n') && vokal {
        out.push('\'');
    }
    out.push_str(romaji);
}

fn bacaan_kanji(c: char) -> (Vec<&'static str>, Vec<&'static str>) {
    match crate::lyrics::kanji_bacaan::BACAAN_JEPANG.binary_search_by(|(k, _, _)| k.cmp(&c)) {
        Ok(i) => {
            let (_, on, kun) = crate::lyrics::kanji_bacaan::BACAAN_JEPANG[i];
            (
                on.split_whitespace().collect(),
                kun.split_whitespace().collect(),
            )
        }
        Err(_) => (Vec::new(), Vec::new()),
    }
}

fn pilih_kun_tunggal(kun: &[&'static str]) -> Option<&'static str> {
    // Bacaan berakhiran baris -u hampir selalu bentuk kamus verba (おもう,
    // おしむ, ひかる). Untuk kanji tunggal tanpa okurigana, bacaan nomina
    // (おもい, いとしい, ひかり) jauh lebih mungkin benar.
    kun.iter()
        .find(|b| !akhiran_bentuk_kamus(b))
        .or_else(|| kun.first())
        .copied()
}

fn akhiran_bentuk_kamus(bacaan: &str) -> bool {
    matches!(
        bacaan.chars().last(),
        Some('う' | 'く' | 'ぐ' | 'す' | 'つ' | 'ぬ' | 'ぶ' | 'む' | 'る')
    )
}

/// Romanisasi satu bacaan kana (katakana on'yomi atau hiragana kun'yomi).
fn bacaan_ke_romaji(bacaan: &str) -> String {
    if bacaan.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(bacaan.len() * 2);
    let mut sisa = bacaan;
    while !sisa.is_empty() {
        let c = sisa.chars().next().expect("sisa tidak kosong");
        if c == 'ー' {
            if let Some(vokal) = vokal_terakhir(&out) {
                out.push(vokal);
            }
            sisa = &sisa[c.len_utf8()..];
            continue;
        }
        if let Some((len, romaji)) = digraf_katakana(sisa) {
            out.push_str(romaji);
            sisa = &sisa[len..];
            continue;
        }
        match romanizer_kana().romanize_kana(sisa) {
            Some((len, romaji)) => {
                out.push_str(romaji);
                sisa = &sisa[len..];
            }
            None => {
                out.push(c);
                sisa = &sisa[c.len_utf8()..];
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// 3. KOREA: Revised Romanization of Korean (algoritmik & deterministik)
// ---------------------------------------------------------------------------

const CHOSUNG: [&str; 19] = [
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p",
    "h",
];

const JUNGSUNG: [&str; 21] = [
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we",
    "wi", "yu", "eu", "ui", "i",
];

const JONGSUNG: [&str; 28] = [
    "", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lg", "lm", "lb", "ls", "lt", "lp", "lh", "m",
    "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "h",
];

fn romanize_korean(input: &str) -> String {
    let teks = rangkai_jamo(input);
    let mut out = String::with_capacity(teks.len() * 2);
    let mut kata = String::new();

    for c in teks.chars() {
        if is_hangul_syllable(c) {
            kata.push(c);
        } else {
            if !kata.is_empty() {
                out.push_str(&romanisasi_kata_korea(&kata));
                kata.clear();
            }
            out.push(c);
        }
    }
    if !kata.is_empty() {
        out.push_str(&romanisasi_kata_korea(&kata));
    }

    out
}

/// Satu kata Korea: pecah ke (awal, tengah, akhir), pindahkan final ke suku kata
/// berikutnya bila suku kata itu mulai dengan ㅇ (liaison dasar), lalu rakit.
fn romanisasi_kata_korea(kata: &str) -> String {
    let mut urai: Vec<(usize, usize, usize)> = kata
        .chars()
        .filter_map(|c| {
            let code = c as u32;
            if !(0xAC00..=0xD7A3).contains(&code) {
                return None;
            }
            let i = code - 0xAC00;
            Some((
                (i / 588) as usize,
                ((i % 588) / 28) as usize,
                (i % 28) as usize,
            ))
        })
        .collect();

    for i in 0..urai.len().saturating_sub(1) {
        let (_, _, jong) = urai[i];
        if jong == 0 || urai[i + 1].0 != 11 {
            continue;
        }
        if let Some((cho_baru, sisa)) = pindah_final(jong) {
            urai[i].2 = sisa;
            urai[i + 1].0 = cho_baru;
        }
    }

    let mut out = String::with_capacity(kata.len() * 2);
    for (cho, jung, jong) in urai {
        out.push_str(CHOSUNG[cho]);
        out.push_str(JUNGSUNG[jung]);
        out.push_str(JONGSUNG[jong]);
    }
    out
}

/// Final yang bisa pindah ke posisi awal suku kata berikut: (indeks CHOSUNG, sisa final).
/// Final ganda (ㄳ, ㄺ, ...) sengaja tidak dipindah — lihat catatan batasan modul.
fn pindah_final(jong: usize) -> Option<(usize, usize)> {
    let hasil = match jong {
        1 => (0, 0),   // ㄱ -> g
        2 => (1, 0),   // ㄲ -> kk
        4 => (2, 0),   // ㄴ -> n
        7 => (3, 0),   // ㄷ -> d
        8 => (5, 0),   // ㄹ -> r
        16 => (6, 0),  // ㅁ -> m
        17 => (7, 0),  // ㅂ -> b
        19 => (9, 0),  // ㅅ -> s
        20 => (10, 0), // ㅆ -> ss
        22 => (12, 0), // ㅈ -> j
        23 => (14, 0), // ㅊ -> ch
        24 => (15, 0), // ㅋ -> k
        25 => (16, 0), // ㅌ -> t
        26 => (17, 0), // ㅍ -> p
        27 => (11, 0), // ㅎ hilang di depan vokal (좋아 -> joa)
        _ => return None,
    };
    Some(hasil)
}

/// Merangkai Jamo lepas (U+1100.., U+3130..) menjadi suku kata U+AC00.. supaya
/// teks yang ditulis terurai (mis. dari input IME) tetap bisa diromanisasi.
fn rangkai_jamo(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if let Some(awal) = jamo_awal(c) {
            if i + 1 < chars.len() {
                if let Some(tengah) = jamo_tengah(chars[i + 1]) {
                    let mut akhir = 0usize;
                    let mut pakai = 2;
                    if i + 2 < chars.len() {
                        if let Some(a) = jamo_akhir(chars[i + 2]) {
                            akhir = a;
                            pakai = 3;
                        }
                    }
                    let code = 0xAC00 + ((awal * 21 + tengah) * 28 + akhir) as u32;
                    out.push(char::from_u32(code).unwrap_or(c));
                    i += pakai;
                    continue;
                }
            }
            // Konsonan lepas tanpa vokal: tetap dibaca sebagai huruf.
            out.push_str(if awal == 11 { "ng" } else { CHOSUNG[awal] });
            i += 1;
            continue;
        }

        if let Some(tengah) = jamo_tengah(c) {
            out.push_str(JUNGSUNG[tengah]);
            i += 1;
            continue;
        }

        if let Some(akhir) = jamo_akhir(c) {
            out.push_str(JONGSUNG[akhir]);
            i += 1;
            continue;
        }

        out.push(c);
        i += 1;
    }

    out
}

fn jamo_awal(c: char) -> Option<usize> {
    let u = c as u32;
    if (0x1100..=0x1112).contains(&u) {
        return Some((u - 0x1100) as usize);
    }
    let idx = match c {
        'ㄱ' => 0,
        'ㄲ' => 1,
        'ㄴ' => 2,
        'ㄷ' => 3,
        'ㄸ' => 4,
        'ㄹ' => 5,
        'ㅁ' => 6,
        'ㅂ' => 7,
        'ㅃ' => 8,
        'ㅅ' => 9,
        'ㅆ' => 10,
        'ㅇ' => 11,
        'ㅈ' => 12,
        'ㅉ' => 13,
        'ㅊ' => 14,
        'ㅋ' => 15,
        'ㅌ' => 16,
        'ㅍ' => 17,
        'ㅎ' => 18,
        _ => return None,
    };
    Some(idx)
}

fn jamo_tengah(c: char) -> Option<usize> {
    let u = c as u32;
    if (0x1161..=0x1175).contains(&u) {
        return Some((u - 0x1161) as usize);
    }
    if (0x314F..=0x3163).contains(&u) {
        return Some((u - 0x314F) as usize);
    }
    None
}

fn jamo_akhir(c: char) -> Option<usize> {
    let u = c as u32;
    if (0x11A8..=0x11C2).contains(&u) {
        return Some((u - 0x11A8) as usize + 1);
    }
    let idx = match c {
        'ㄱ' => 1,
        'ㄲ' => 2,
        'ㄳ' => 3,
        'ㄴ' => 4,
        'ㄵ' => 5,
        'ㄶ' => 6,
        'ㄷ' => 7,
        'ㄹ' => 8,
        'ㄺ' => 9,
        'ㄻ' => 10,
        'ㄼ' => 11,
        'ㄽ' => 12,
        'ㄾ' => 13,
        'ㄿ' => 14,
        'ㅀ' => 15,
        'ㅁ' => 16,
        'ㅂ' => 17,
        'ㅄ' => 18,
        'ㅅ' => 19,
        'ㅆ' => 20,
        'ㅇ' => 21,
        'ㅈ' => 22,
        'ㅊ' => 23,
        'ㅋ' => 24,
        'ㅌ' => 25,
        'ㅍ' => 26,
        'ㅎ' => 27,
        _ => return None,
    };
    Some(idx)
}

// ---------------------------------------------------------------------------
// 4. MANDARIN: Hanzi -> pinyin (kamus lengkap lewat crate `pinyin`)
// ---------------------------------------------------------------------------

fn romanize_mandarin_basic(input: &str) -> String {
    use pinyin::ToPinyin;

    let mut out = String::with_capacity(input.len() * 4);
    let mut prev_han = false;
    let mut buf = [0u8; 4];

    for c in input.chars() {
        let satu: &str = c.encode_utf8(&mut buf);
        let pinyin = satu.to_pinyin().next().flatten().map(|p| p.with_tone());

        match pinyin {
            Some(py) => {
                if prev_han {
                    out.push(' ');
                }
                out.push_str(py);
                prev_han = true;
            }
            None => {
                out.push(tanda_baca_ke_ascii(c));
                prev_han = false;
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kriteria selesai Tugas 1: keluaran romaji tidak boleh menyisakan satu pun
    /// karakter di rentang CJK yang diminta.
    fn ada_sisa_cjk(s: &str) -> Option<char> {
        s.chars().find(|&c| {
            let u = c as u32;
            (0x3040..=0x309F).contains(&u)          // Hiragana
                || (0x30A0..=0x30FF).contains(&u)   // Katakana
                || (0xFF66..=0xFF9F).contains(&u)   // Katakana setengah lebar
                || (0x4E00..=0x9FFF).contains(&u)   // CJK Unified Ideographs
                || (0x3400..=0x4DBF).contains(&u)   // CJK Extension A
                || (0xAC00..=0xD7AF).contains(&u)   // Hangul Syllables
                || (0x1100..=0x11FF).contains(&u)   // Hangul Jamo
                || (0x3130..=0x318F).contains(&u) // Hangul Compatibility Jamo
        })
    }

    fn romaji_bersih(teks: &str, script: CjkScript) -> String {
        let hasil = romanize_line(teks, script)
            .unwrap_or_else(|| panic!("baris {teks:?} tidak menghasilkan romaji"));
        if let Some(c) = ada_sisa_cjk(&hasil) {
            panic!(
                "sisa CJK {c:?} (U+{:04X}) pada keluaran {hasil:?} dari {teks:?}",
                c as u32
            );
        }
        hasil
    }

    #[test]
    fn test_detect_script() {
        assert_eq!(detect_script("안녕하세요"), CjkScript::Korean);
        assert_eq!(
            detect_script("夢の続き 追いかけていたはずなのに"),
            CjkScript::Japanese
        );
        assert_eq!(detect_script("我的心在跳动"), CjkScript::Mandarin);
        assert_eq!(detect_script("Hello World 123"), CjkScript::None);
        // Setengah lebar dan Jamo kompatibilitas dulu lolos dari deteksi.
        assert_eq!(detect_script("ﾃｨﾝｸﾙ"), CjkScript::Japanese);
        assert_eq!(detect_script("ㅎㅏㄴㄱㅡㄹ"), CjkScript::Korean);
    }

    #[test]
    fn test_korean_romanization() {
        assert_eq!(romanize_korean("한글"), "hangeul");
        assert_eq!(romanize_korean("사랑해"), "saranghae");
        // Jamo lepas harus dirangkai dulu, bukan dibiarkan.
        assert_eq!(romanize_korean("ㅎㅏㄴㄱㅡㄹ"), "hangeul");
        // Liaison dasar: final pindah ke suku kata berikut yang mulai dengan ㅇ.
        assert_eq!(romanize_korean("한국어"), "hangugeo");
        assert_eq!(romanize_korean("음악"), "eumak");
    }

    #[test]
    fn test_japanese_kana_romanization() {
        assert_eq!(romanize_japanese("ありがとう"), "arigatou");
        assert_eq!(romanize_japanese("ちょっと まって"), "chotto matte");
        // Kanji tidak boleh lagi lolos apa adanya.
        let hasil = romaji_bersih("東京 (とうきょう)", CjkScript::Japanese);
        assert!(!hasil.contains("東京"), "kanji masih tersisa: {hasil}");
        assert!(hasil.contains("toukyou"), "pembacaan kanji salah: {hasil}");
    }

    #[test]
    fn test_japanese_kanji_dan_kana_campur() {
        let hasil = romaji_bersih("夢の続きを追いかけて", CjkScript::Japanese);
        assert!(hasil.contains("yume"), "pembacaan 夢 salah: {hasil}");
        assert!(hasil.contains("oi"), "pembacaan 追 salah: {hasil}");

        // Baris tanpa kana, skrip lagu Jepang -> kanji dibaca sebagai Jepang.
        let hasil = romaji_bersih("東京", CjkScript::Japanese);
        assert!(hasil.contains("toukyou"), "{hasil}");
    }

    #[test]
    fn test_japanese_campur_inggris() {
        let hasil = romaji_bersih("君の名前を call my name", CjkScript::Japanese);
        assert!(hasil.contains("call my name"), "teks Latin hilang: {hasil}");
        assert!(hasil.contains("kimi"), "pembacaan 君 salah: {hasil}");
    }

    #[test]
    fn test_japanese_tanda_baca() {
        let hasil = romaji_bersih("「さよなら」、またね。", CjkScript::Japanese);
        assert!(hasil.contains("sayonara"), "{hasil}");
        assert!(hasil.contains("matane"), "{hasil}");
        assert!(!hasil.contains('「'), "{hasil}");
    }

    #[test]
    fn test_katakana_setengah_lebar() {
        let hasil = romaji_bersih("ﾃｨﾝｸﾙ ﾊﾞﾗｰﾄﾞ", CjkScript::Japanese);
        assert!(
            hasil.contains("barado") || hasil.contains("baraado"),
            "{hasil}"
        );
    }

    #[test]
    fn test_korean_jamo_dan_syllable() {
        let hasil = romaji_bersih("너를 사랑해", CjkScript::Korean);
        assert!(hasil.contains("saranghae"), "{hasil}");
    }

    #[test]
    fn test_mandarin() {
        assert_eq!(romanize_mandarin_basic("我爱你"), "wǒ ài nǐ");
        let hasil = romaji_bersih("我的心在跳动", CjkScript::Mandarin);
        assert!(hasil.contains("wǒ"), "{hasil}");
        assert!(hasil.contains("xīn"), "{hasil}");
    }

    #[test]
    fn test_latin_tidak_regresi() {
        // Baris Latin murni tidak butuh romanisasi: None, bukan teks kembar.
        assert_eq!(romanize_line("Hello World 123", CjkScript::None), None);
        assert_eq!(romanize_line("Hello World 123", CjkScript::Japanese), None);
        assert_eq!(romanize_line("", CjkScript::Japanese), None);
    }

    #[test]
    fn test_kanji_tunggal_bacaan_nomina() {
        // Bacaan kamus verba (-u) tidak dipakai untuk kanji tunggal tanpa
        // okurigana: 光 harus "hikari", bukan "hikaru".
        assert_eq!(
            romanize_line("光", CjkScript::Japanese).as_deref(),
            Some("hikari")
        );
        assert_eq!(
            romanize_line("夢", CjkScript::Japanese).as_deref(),
            Some("yume")
        );
        assert_eq!(
            romanize_line("恋", CjkScript::Japanese).as_deref(),
            Some("koi")
        );
        // 愛 tanpa okurigana dibaca あい (nomina), bukan いとしい (adjektiva).
        assert_eq!(
            romanize_line("愛", CjkScript::Japanese).as_deref(),
            Some("ai")
        );
    }

    #[test]
    fn test_kandidat_kamus_bukan_urut_alfabet() {
        // `ib-romaji` mengembalikan kandidat urut alfabetis: 言葉 ->
        // ["ji", "ketoba", "kotoba", "shi"]. Kandidat pertama bukan bacaan kata.
        assert_eq!(
            romanize_line("言葉", CjkScript::Japanese).as_deref(),
            Some("kotoba")
        );
        assert_eq!(
            romanize_line("必死", CjkScript::Japanese).as_deref(),
            Some("hisshi")
        );
        // Kata yang tidak ada di kamus memakai daftar bacaan tetap.
        assert_eq!(
            romanize_line("様子", CjkScript::Japanese).as_deref(),
            Some("yousu")
        );
    }

    #[test]
    fn test_bacaan_kanji_tunggal() {
        // Bacaan kun pertama di Unihan adalah bacaan arkais; yang dipakai
        // sehari-hari ada di daftar bacaan tetap.
        assert_eq!(
            romanize_line("僕", CjkScript::Japanese).as_deref(),
            Some("boku")
        );
        assert_eq!(
            romanize_line("役", CjkScript::Japanese).as_deref(),
            Some("yaku")
        );
        assert_eq!(
            romanize_line("皆", CjkScript::Japanese).as_deref(),
            Some("minna")
        );
    }

    #[test]
    fn test_okurigana_batang_verba() {
        // 嘆く + いた -> nageita, bukan nagekawashiiita (bacaan adjektiva).
        assert_eq!(
            romanize_line("嘆いた", CjkScript::Japanese).as_deref(),
            Some("nageita")
        );
        // 転がる + がってく -> korogatteku (tumpang tindih "が" tidak dobel).
        assert_eq!(
            romanize_line("転がってく", CjkScript::Japanese).as_deref(),
            Some("korogatteku")
        );
        // 向かう + かって -> mukatte, bukan saki + ni + katte.
        assert_eq!(
            romanize_line("向かって", CjkScript::Japanese).as_deref(),
            Some("mukatte")
        );
    }

    #[test]
    fn test_partikel_dan_spasi() {
        // Partikel dibaca, bukan dieja: は -> wa, を -> o.
        assert_eq!(
            romanize_line("頭でわかっては嘆いた", CjkScript::Japanese).as_deref(),
            Some("atama de wakatte wa nageita")
        );
        assert_eq!(
            romanize_line("転がってく様子を嗤った", CjkScript::Japanese).as_deref(),
            Some("korogatteku yousu o waratta")
        );
        // Okurigana menyambung bacaan kanji, kata berikutnya diberi spasi.
        assert_eq!(
            romanize_line("人間の形は投げだしたんだ", CjkScript::Japanese).as_deref(),
            Some("ningen no katachi wa nagedashitanda")
        );
        assert_eq!(
            romanize_line("気づいたら最後逃げ出したい", CjkScript::Japanese).as_deref(),
            Some("kizuitara saigo nigedashitai")
        );
    }

    #[test]
    fn test_kata_tetap_umum() {
        // Kata yang kalau dibaca on per kanji jadi menyesatkan.
        for (teks, harap) in [
            ("一人", "hitori"),
            ("二人", "futari"),
            ("子供", "kodomo"),
            ("名前", "namae"),
            ("世界", "sekai"),
            ("友達", "tomodachi"),
            ("仕事", "shigoto"),
            ("大丈夫", "daijoubu"),
            ("場所", "basho"),
            ("彼女", "kanojo"),
        ] {
            assert_eq!(
                romanize_line(teks, CjkScript::Japanese).as_deref(),
                Some(harap),
                "bacaan {teks} salah"
            );
        }
        // Verba majemuk: 立ち + 上がれ tidak boleh dipecah jadi dua kata.
        assert_eq!(
            romanize_line("何度でも立ち上がれ", CjkScript::Japanese).as_deref(),
            Some("nando demo tachiagare")
        );
    }

    #[test]
    fn test_kamus_tidak_menelan_partikel() {
        // 今日は di kamus adalah sapaan; di lirik hampir selalu 今日 + は.
        assert_eq!(
            romanize_line("今日は雨だった", CjkScript::Japanese).as_deref(),
            Some("kyou wa ame datta")
        );
        // 夜が明ける adalah ungkapan kamus; partikel が harus tetap jadi partikel.
        assert_eq!(
            romanize_line("夜が明けるまで", CjkScript::Japanese).as_deref(),
            Some("yo ga akeru made")
        );
        // 愛し bukan kata kamus; batang 愛する dibaca aishi.
        assert_eq!(
            romanize_line("愛してる", CjkScript::Japanese).as_deref(),
            Some("aishiteru")
        );
    }

    #[test]
    fn test_spasi_setelah_tanda_baca() {
        assert_eq!(
            romanize_line("ありがとう、またね", CjkScript::Japanese).as_deref(),
            Some("arigatou, matane")
        );
        // Tanda penutup menempel ke kata sebelumnya, bukan sesudah spasi.
        assert_eq!(
            romanize_line("「さよなら」、またね。", CjkScript::Japanese).as_deref(),
            Some("\"sayonara\", matane.")
        );
    }

    #[test]
    fn test_fallback_karakter_tak_dikenal() {
        // Kanji di luar JIS X 0208 (Unicode Extension B) tidak ada di tabel
        // bacaan; satu-satunya perilaku yang jujur adalah menolak baris ini
        // (None), bukan menyisakan aksara asli di keluaran romaji.
        assert_eq!(romanize_line("\u{2A6D6}野家", CjkScript::Japanese), None);
    }
}
