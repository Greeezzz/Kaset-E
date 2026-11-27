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
            out.push(tanda_baca_ke_ascii(c));
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
    if rapi.is_empty() {
        None
    } else {
        Some(rapi)
    }
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

/// Romanisasi segmen Jepang. Karakter di luar kamus dibiarkan, lalu
/// `romanize_line` yang memutuskan fallback-nya.
fn romanize_japanese(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    let mut sisa = input;

    while !sisa.is_empty() {
        // 1. Kata utuh dari kamus (paling akurat karena bacaan per kata).
        //    Hanya pencocokan multi-karakter yang mengandung kanji yang dipakai;
        //    kana dan kanji tunggal ditangani sendiri di bawah (lebih akurat).
        let kata =
            romanizer_kamus().romanize_and_try_for_each(sisa, |len, romaji| Some((len, romaji)));
        if let Some((len, romaji)) = kata {
            let potong = &sisa[..len];
            if potong.chars().count() > 1 && potong.chars().any(is_han) {
                out.push_str(romaji);
                sisa = &sisa[len..];
                continue;
            }
        }

        let c = sisa.chars().next().expect("sisa tidak kosong");

        // 2. Kana: ー memanjangkan vokal sebelumnya, digraf serapan ditangani
        //    sendiri karena tidak ada di tabel `ib-romaji`.
        if is_hiragana(c) || is_katakana(c) {
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
            continue;
        }

        // 3. Kanji: tabel bacaan on/kun (Unihan).
        if is_han(c) {
            let (romaji, habis) = bacakan_kanji(sisa);
            out.push_str(&romaji);
            sisa = &sisa[habis..];
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
/// - kanji majemuk (>= 2 kanji berurutan) -> on'yomi tiap kanji.
/// - kanji tunggal + okurigana -> kun'yomi yang berakhiran okurigana itu.
/// - kanji tunggal tanpa okurigana -> kun'yomi pertama yang bukan bentuk kamus
///   verba (tidak berakhiran -u), karena bacaan seperti こう/くう hampir selalu
///   muncul bersama okurigana.
fn bacakan_kanji(sisa: &str) -> (String, usize) {
    let kanji: Vec<char> = sisa.chars().take_while(|&c| is_han(c)).collect();
    let byte_kanji: usize = kanji.iter().map(|c| c.len_utf8()).sum();
    let sisa_okurigana = &sisa[byte_kanji..];
    let okurigana: String = sisa_okurigana
        .chars()
        .take_while(|&c| is_hiragana(c))
        .collect();

    let mut out = String::new();

    if kanji.len() >= 2 {
        for c in &kanji {
            let (on, kun) = bacaan_kanji(*c);
            match on.first().or_else(|| kun.first()) {
                Some(b) => out.push_str(&bacaan_ke_romaji(b)),
                // Tidak ada data: biarkan kanji apa adanya supaya
                // `romanize_line` memicu fallback, bukan menghilangkannya.
                None => out.push(*c),
            }
        }
        return (out, byte_kanji);
    }

    let c = kanji[0];
    let (on, kun) = bacaan_kanji(c);

    // Kanji tunggal + okurigana yang cocok dengan akhiran bacaan kun.
    if !okurigana.is_empty() {
        let cocok = kun.iter().find(|b| {
            b.ends_with(okurigana.as_str()) && b.chars().count() > okurigana.chars().count()
        });
        if let Some(b) = cocok {
            out.push_str(&bacaan_ke_romaji(b));
            return (out, byte_kanji + okurigana.len());
        }

        // Tidak ada yang cocok: bacaan kamus (bentuk -u) dipotong satu kana
        // supaya sisa okurigana yang menyusul tidak dobel. 追 + いかけて
        // ("おう" -> "お") menghasilkan oikakete, bukan ouikakete.
        if let Some(b) = pilih_kun_tunggal(&kun) {
            let potong = potong_vokal_u(b);
            out.push_str(&bacaan_ke_romaji(potong));
            return (out, byte_kanji);
        }
    }

    if let Some(b) = pilih_kun_tunggal(&kun) {
        return (bacaan_ke_romaji(b), byte_kanji);
    }
    if let Some(b) = on.first() {
        return (bacaan_ke_romaji(b), byte_kanji);
    }

    // Tidak ada data: biarkan kanji apa adanya, `romanize_line` akan fallback.
    out.push(c);
    (out, byte_kanji)
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

/// Buang satu kana terakhir kalau bacaan berakhir di baris -u (bentuk kamus
/// verba). Sisa vokalnya disediakan okurigana yang menyusul.
fn potong_vokal_u(bacaan: &str) -> &str {
    let mut chars = bacaan.char_indices();
    let Some((idx, terakhir)) = chars.next_back() else {
        return bacaan;
    };
    match terakhir {
        'う' | 'く' | 'ぐ' | 'す' | 'つ' | 'ぬ' | 'ぶ' | 'む' | 'る' => &bacaan[..idx],
        _ => bacaan,
    }
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
        assert_eq!(
            romanize_line("愛", CjkScript::Japanese).as_deref(),
            Some("itoshii")
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
