//! Modul Deteksi Skrip dan Romanisasi CJK Lokal di Rust (FEATURES-V3 §4 L6).
//!
//! Spesifikasi:
//! - Deteksi skrip Unicode:
//!   - Hangul (U+AC00..U+D7AF, U+1100..U+11FF) -> Korea
//!   - Hiragana (U+3040..U+309F) & Katakana (U+30A0..U+30FF) -> Jepang
//!   - CJK Unified Ideographs (U+4E00..U+9FFF) tanpa Kana -> Mandarin
//! - Romanisasi Hangul deterministik berdasarkan Revised Romanization of Korean (standar resmi Korea).
//! - Romanisasi Kana Jepang (Hiragana/Katakana) deterministik ke Hepburn Romaji.
//! - Transkripsi Mandarin Hanzi dasar berbasis tabel pinyin ringan.
//! - Segmen alfabet Latin / angka / tanda baca tetap dipertahankan apa adanya.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CjkScript {
    Japanese,
    Korean,
    Mandarin,
    None,
}

/// Mendeteksi skrip dominan dari teks lirik (atau sampel beberapa baris).
pub fn detect_script(text: &str) -> CjkScript {
    let mut has_hangul = false;
    let mut has_kana = false;
    let mut has_hanzi = false;

    for c in text.chars() {
        let u = c as u32;
        // Hangul Syllables / Jamo
        if (0xAC00..=0xD7AF).contains(&u) || (0x1100..=0x11FF).contains(&u) {
            has_hangul = true;
        }
        // Hiragana / Katakana
        else if (0x3040..=0x309F).contains(&u) || (0x30A0..=0x30FF).contains(&u) {
            has_kana = true;
        }
        // Hanzi / Kanji
        else if (0x4E00..=0x9FFF).contains(&u) || (0x3400..=0x4DBF).contains(&u) {
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

/// Melakukan romanisasi satu baris teks berdasarkan skripnya.
pub fn romanize_line(text: &str, script: CjkScript) -> Option<String> {
    match script {
        CjkScript::Korean => Some(romanize_korean(text)),
        CjkScript::Japanese => Some(romanize_japanese_kana(text)),
        CjkScript::Mandarin => Some(romanize_mandarin_basic(text)),
        CjkScript::None => None,
    }
}

// ---------------------------------------------------------------------------
// 1. KOREA: Revised Romanization of Korean (Algoritmik & Deterministik)
// ---------------------------------------------------------------------------

const CHOSUNG: &[&str] = &[
    "g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t",
    "p", "h",
];

const JUNGSUNG: &[&str] = &[
    "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo",
    "we", "wi", "yu", "eu", "ui", "i",
];

const JONGSUNG: &[&str] = &[
    "", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lg", "lm", "lb", "ls", "lt", "lp", "lh",
    "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "h",
];

fn romanize_korean(input: &str) -> String {
    let mut out = String::new();

    for c in input.chars() {
        let code = c as u32;
        if (0xAC00..=0xD7A3).contains(&code) {
            let syl_index = code - 0xAC00;
            let cho = (syl_index / 588) as usize;
            let jung = ((syl_index % 588) / 28) as usize;
            let jong = (syl_index % 28) as usize;

            out.push_str(CHOSUNG[cho]);
            out.push_str(JUNGSUNG[jung]);
            out.push_str(JONGSUNG[jong]);
        } else {
            out.push(c);
        }
    }

    out
}

// ---------------------------------------------------------------------------
// 2. JEPANG: Hepburn Romaji untuk Hiragana dan Katakana
// ---------------------------------------------------------------------------

fn romanize_japanese_kana(input: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        // Cek kombinasi digraf 2 karakter (mis. きゃ -> kya, しゅ -> shu, チョ -> cho)
        if i + 1 < chars.len() {
            let next_c = chars[i + 1];
            if let Some(digraph) = lookup_kana_digraph(c, next_c) {
                out.push_str(digraph);
                i += 2;
                continue;
            }
        }

        // Cek sokuon (っ / ッ -> dobel konsonan berikutnya)
        if (c == 'っ' || c == 'ッ') && i + 1 < chars.len() {
            let next_c = chars[i + 1];
            if let Some(romaji) = lookup_single_kana(next_c) {
                if let Some(first_letter) = romaji.chars().next() {
                    out.push(first_letter);
                    i += 1;
                    continue;
                }
            }
        }

        // Karakter kana tunggal
        if let Some(romaji) = lookup_single_kana(c) {
            out.push_str(romaji);
        } else {
            out.push(c);
        }
        i += 1;
    }

    out
}

fn lookup_single_kana(c: char) -> Option<&'static str> {
    match c {
        // Hiragana dasar
        'あ' | 'ア' => Some("a"),
        'い' | 'イ' => Some("i"),
        'う' | 'ウ' => Some("u"),
        'え' | 'エ' => Some("e"),
        'お' | 'オ' => Some("o"),
        'か' | 'カ' => Some("ka"),
        'き' | 'キ' => Some("ki"),
        'く' | 'ク' => Some("ku"),
        'け' | 'ケ' => Some("ke"),
        'こ' | 'コ' => Some("ko"),
        'さ' | 'サ' => Some("sa"),
        'し' | 'シ' => Some("shi"),
        'す' | 'ス' => Some("su"),
        'せ' | 'セ' => Some("se"),
        'そ' | 'ソ' => Some("so"),
        'た' | 'タ' => Some("ta"),
        'ち' | 'チ' => Some("chi"),
        'つ' | 'ツ' => Some("tsu"),
        'て' | 'テ' => Some("te"),
        'と' | 'ト' => Some("to"),
        'な' | 'ナ' => Some("na"),
        'に' | 'ニ' => Some("ni"),
        'ぬ' | 'ヌ' => Some("nu"),
        'ね' | 'ネ' => Some("ne"),
        'の' | 'ノ' => Some("no"),
        'は' | 'ハ' => Some("ha"),
        'ひ' | 'ヒ' => Some("hi"),
        'ふ' | 'フ' => Some("fu"),
        'へ' | 'ヘ' => Some("he"),
        'ほ' | 'ホ' => Some("ho"),
        'ま' | 'マ' => Some("ma"),
        'み' | 'ミ' => Some("mi"),
        'む' | 'ム' => Some("mu"),
        'め' | 'メ' => Some("me"),
        'も' | 'モ' => Some("mo"),
        'や' | 'ヤ' => Some("ya"),
        'ゆ' | 'ユ' => Some("yu"),
        'よ' | 'ヨ' => Some("yo"),
        'ら' | 'ラ' => Some("ra"),
        'り' | 'リ' => Some("ri"),
        'る' | 'ル' => Some("ru"),
        'れ' | 'レ' => Some("re"),
        'ろ' | 'ロ' => Some("ro"),
        'わ' | 'ワ' => Some("wa"),
        'を' | 'ヲ' => Some("wo"),
        'ん' | 'ン' => Some("n"),
        // Voiced & Semi-voiced (Dakuten / Handakuten)
        'が' | 'ガ' => Some("ga"),
        'ぎ' | 'ギ' => Some("gi"),
        'ぐ' | 'グ' => Some("gu"),
        'げ' | 'ゲ' => Some("ge"),
        'ご' | 'ゴ' => Some("go"),
        'ざ' | 'ザ' => Some("za"),
        'じ' | 'ジ' => Some("ji"),
        'ず' | 'ズ' => Some("zu"),
        'ぜ' | 'ゼ' => Some("ze"),
        'ぞ' | 'ゾ' => Some("zo"),
        'だ' | 'ダ' => Some("da"),
        'ぢ' | 'ヂ' => Some("ji"),
        'づ' | 'ヅ' => Some("zu"),
        'で' | 'デ' => Some("de"),
        'ど' | 'ド' => Some("do"),
        'ば' | 'バ' => Some("ba"),
        'び' | 'ビ' => Some("bi"),
        'ぶ' | 'ブ' => Some("bu"),
        'べ' | 'ベ' => Some("be"),
        'ぼ' | 'ボ' => Some("bo"),
        'ぱ' | 'パ' => Some("pa"),
        'ぴ' | 'ピ' => Some("pi"),
        'ぷ' | 'プ' => Some("pu"),
        'ぺ' | 'ペ' => Some("pe"),
        'ぽ' | 'ポ' => Some("po"),
        _ => None,
    }
}

fn lookup_kana_digraph(c1: char, c2: char) -> Option<&'static str> {
    match (c1, c2) {
        ('き' | 'キ', 'ゃ' | 'ャ') => Some("kya"),
        ('き' | 'キ', 'ゅ' | 'ュ') => Some("kyu"),
        ('き' | 'キ', 'ょ' | 'ョ') => Some("kyo"),
        ('し' | 'シ', 'ゃ' | 'ャ') => Some("sha"),
        ('し' | 'シ', 'ゅ' | 'ュ') => Some("shu"),
        ('し' | 'シ', 'ょ' | 'ョ') => Some("sho"),
        ('ち' | 'チ', 'ゃ' | 'ャ') => Some("cha"),
        ('ち' | 'チ', 'ゅ' | 'ュ') => Some("chu"),
        ('ち' | 'チ', 'ょ' | 'ョ') => Some("cho"),
        ('に' | 'ニ', 'ゃ' | 'ャ') => Some("nya"),
        ('に' | 'ニ', 'ゅ' | 'ュ') => Some("nyu"),
        ('に' | 'ニ', 'ょ' | 'ョ') => Some("nyo"),
        ('ひ' | 'ヒ', 'ゃ' | 'ャ') => Some("hya"),
        ('ひ' | 'ヒ', 'ゅ' | 'ュ') => Some("hyu"),
        ('ひ' | 'ヒ', 'ょ' | 'ョ') => Some("hyo"),
        ('み' | 'ミ', 'ゃ' | 'ャ') => Some("mya"),
        ('み' | 'ミ', 'ゅ' | 'ュ') => Some("myu"),
        ('み' | 'ミ', 'ょ' | 'ョ') => Some("myo"),
        ('り' | 'リ', 'ゃ' | 'ャ') => Some("rya"),
        ('り' | 'リ', 'ゅ' | 'ュ') => Some("ryu"),
        ('り' | 'リ', 'ょ' | 'ョ') => Some("ryo"),
        ('ぎ' | 'ギ', 'ゃ' | 'ャ') => Some("gya"),
        ('ぎ' | 'ギ', 'ゅ' | 'ュ') => Some("gyu"),
        ('ぎ' | 'ギ', 'ょ' | 'ョ') => Some("gyo"),
        ('じ' | 'ジ', 'ゃ' | 'ャ') => Some("ja"),
        ('じ' | 'ジ', 'ゅ' | 'ュ') => Some("ju"),
        ('じ' | 'ジ', 'ょ' | 'ョ') => Some("jo"),
        ('び' | 'ビ', 'ゃ' | 'ャ') => Some("bya"),
        ('び' | 'ビ', 'ゅ' | 'ュ') => Some("byu"),
        ('び' | 'ビ', 'ょ' | 'ョ') => Some("byo"),
        ('ぴ' | 'ピ', 'ゃ' | 'ャ') => Some("pya"),
        ('ぴ' | 'ピ', 'ゅ' | 'ュ') => Some("pyu"),
        ('ぴ' | 'ピ', 'ょ' | 'ョ') => Some("pyo"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// 3. MANDARIN: Pinyin Transkripsi Ringan Karakter Populer Lirik
// ---------------------------------------------------------------------------

fn romanize_mandarin_basic(input: &str) -> String {
    let mut out = String::new();
    let mut prev_was_chinese = false;

    for c in input.chars() {
        if let Some(py) = lookup_common_pinyin(c) {
            if prev_was_chinese {
                out.push(' ');
            }
            out.push_str(py);
            prev_was_chinese = true;
        } else {
            out.push(c);
            prev_was_chinese = false;
        }
    }

    out
}

/// Kamus pinyin cepat untuk karakter frekuensi tinggi dalam lirik lagu pop Mandarin.
fn lookup_common_pinyin(c: char) -> Option<&'static str> {
    match c {
        '我' => Some("wǒ"),
        '你' => Some("nǐ"),
        '他' => Some("tā"),
        '她' => Some("tā"),
        '它' => Some("tā"),
        '们' => Some("men"),
        '的' => Some("de"),
        '是' => Some("shì"),
        '在' => Some("zài"),
        '不' => Some("bù"),
        '了' => Some("le"),
        '有' => Some("yǒu"),
        '和' => Some("hé"),
        '人' => Some("rén"),
        '这' => Some("zhè"),
        '中' => Some("zhōng"),
        '大' => Some("dà"),
        '为' => Some("wèi"),
        '上' => Some("shàng"),
        '个' => Some("gè"),
        '爱' => Some("ài"),
        '心' => Some("xīn"),
        '想' => Some("xiǎng"),
        '要' => Some("yào"),
        '说' => Some("shuō"),
        '梦' => Some("mèng"),
        '天' => Some("tiān"),
        '夜' => Some("yè"),
        '光' => Some("guāng"),
        '再' => Some("zài"),
        '会' => Some("huì"),
        '能' => Some("néng"),
        '时' => Some("shí"),
        '去' => Some("qù"),
        '来' => Some("lái"),
        '过' => Some("guò"),
        '看' => Some("kàn"),
        '见' => Some("jiàn"),
        '听' => Some("tīng"),
        '生' => Some("shēng"),
        '死' => Some("sǐ"),
        '眼' => Some("yǎn"),
        '泪' => Some("lèi"),
        '笑' => Some("xiào"),
        '星' => Some("xīng"),
        '月' => Some("yuè"),
        '空' => Some("kōng"),
        '海' => Some("hǎi"),
        '风' => Some("fēng"),
        '雨' => Some("yǔ"),
        '花' => Some("huā"),
        '真' => Some("zhēn"),
        '世' => Some("shì"),
        '界' => Some("jiè"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_script() {
        assert_eq!(detect_script("안녕하세요"), CjkScript::Korean);
        assert_eq!(detect_script("夢の続き 追いかけていたはずなのに"), CjkScript::Japanese);
        assert_eq!(detect_script("我的心在跳动"), CjkScript::Mandarin);
        assert_eq!(detect_script("Hello World 123"), CjkScript::None);
    }

    #[test]
    fn test_korean_romanization() {
        assert_eq!(romanize_korean("한글"), "hangeul");
        assert_eq!(romanize_korean("사랑해"), "saranghae");
    }

    #[test]
    fn test_japanese_kana_romanization() {
        assert_eq!(romanize_japanese_kana("ありがとう"), "arigatou");
        assert_eq!(romanize_japanese_kana("ちょっと まって"), "chotto matte");
        assert_eq!(romanize_japanese_kana("東京 (とうきょう)"), "東京 (toukyou)");
    }

    #[test]
    fn test_mandarin_basic() {
        assert_eq!(romanize_mandarin_basic("我爱你"), "wǒ ài nǐ");
    }
}
