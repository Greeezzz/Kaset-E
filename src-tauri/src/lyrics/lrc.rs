//! Modul parsing dan manipulasi berkas lirik LRC (FEATURES-V3 §4 L1).
//!
//! Spesifikasi:
//! - Format timestamp `[mm:ss.xx]` (perseratus detik) atau `[mm:ss.xxx]` (milidetik).
//! - Mendukung multi-timestamp per baris (mis. `[00:12.00][00:24.00] lirik sama`).
//! - Mendukung tag `[offset: +/-ms]`.
//! - Baris kosong tetap dijaga atau dibersihkan secara rapi.
//! - Mengabaikan tag metadata ID3/LRC (`[ti:]`, `[ar:]`, `[al:]`, `[by:]`, dll.).
//! - Urut berdasarkan waktu `time_ms` menaik.
//! - Deteksi lirik tanpa timestamp -> ditandai sebagai non-sinkron (`is_synced = false`).
//! - Pencarian baris aktif dengan algoritma binary search $O(\log n)$ dengan offset.

use serde::{Deserialize, Serialize};

/// Satu baris lirik yang telah diparsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    /// Waktu mulai baris dalam milidetik dari awal lagu.
    /// Bernilai 0 untuk lirik non-sinkron.
    pub time_ms: i64,
    /// Teks baris lirik.
    pub text: String,
}

/// Representasi struktur lirik yang telah diparsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedLyrics {
    /// Apakah lirik memiliki timestamp sinkron atau sekadar teks biasa.
    pub is_synced: bool,
    /// Offset bawaan dari berkas LRC dalam milidetik (dari tag `[offset:...]`).
    pub file_offset_ms: i64,
    /// Daftar baris lirik, terurut berdasarkan waktu menaik jika tersinkron.
    pub lines: Vec<LyricLine>,
}

impl ParsedLyrics {
    /// Mencari indeks baris lirik aktif untuk `current_pos_ms` tertentu
    /// dengan memperhitungkan `user_offset_ms` tambahan.
    ///
    /// Menggunakan binary search $O(\log n)$.
    /// Mengembalikan `None` jika belum mencapai baris pertama atau lirik kosong.
    pub fn active_index(&self, current_pos_ms: i64, user_offset_ms: i64) -> Option<usize> {
        if !self.is_synced || self.lines.is_empty() {
            return None;
        }

        // Posisi efektif lagu terhadap lirik:
        // Jika offset positif (+100ms), lirik ditampilkan lebih awal (efektif waktu bertambah).
        let effective_ms = current_pos_ms + self.file_offset_ms + user_offset_ms;

        // Jika waktu efektif masih sebelum baris pertama
        if effective_ms < self.lines[0].time_ms {
            return None;
        }

        // Binary search untuk menemukan baris terakhir dengan `time_ms <= effective_ms`
        // `partition_point` mencari elemen pertama di mana predikat bernilai false.
        let idx = self.lines.partition_point(|line| line.time_ms <= effective_ms);
        if idx > 0 {
            Some(idx - 1)
        } else {
            None
        }
    }
}

/// Parse string teks/LRC menjadi `ParsedLyrics`.
///
/// Mendukung BOM UTF-8 (\u{FEFF}), berbagai variasi line-break (\r\n, \n, \r),
/// tag metadata, baris kosong, dan multi-timestamp.
pub fn parse_lrc(input: &str) -> ParsedLyrics {
    // Bersihkan UTF-8 BOM jika ada
    let clean_input = input.strip_prefix('\u{feff}').unwrap_or(input);

    let mut file_offset_ms: i64 = 0;
    let mut timed_lines: Vec<LyricLine> = Vec::new();
    let mut raw_lines: Vec<String> = Vec::new();
    let mut has_any_timestamp = false;

    for raw_line in clean_input.lines() {
        let line = raw_line.trim_end();
        if line.is_empty() {
            continue;
        }

        // Cek tag offset: [offset:+/-1000]
        if let Some(offset_val) = try_parse_offset_tag(line) {
            file_offset_ms = offset_val;
            continue;
        }

        // Cek tag metadata umum seperti [ti:...], [ar:...], dll.
        if is_metadata_tag(line) {
            continue;
        }

        // Ekstrak semua timestamp di baris ini
        let (timestamps, text) = extract_timestamps_and_text(line);

        if !timestamps.is_empty() {
            has_any_timestamp = true;
            for time_ms in timestamps {
                timed_lines.push(LyricLine {
                    time_ms,
                    text: text.to_string(),
                });
            }
        } else {
            raw_lines.push(line.trim().to_string());
        }
    }

    if has_any_timestamp {
        // Urutkan baris berdasarkan waktu menaik (stable sort agar urutan asli jika waktu sama tetap terjaga)
        timed_lines.sort_by_key(|l| l.time_ms);
        ParsedLyrics {
            is_synced: true,
            file_offset_ms,
            lines: timed_lines,
        }
    } else {
        // Lirik polos / non-sinkron
        let lines = raw_lines
            .into_iter()
            .map(|text| LyricLine { time_ms: 0, text })
            .collect();
        ParsedLyrics {
            is_synced: false,
            file_offset_ms: 0,
            lines,
        }
    }
}

/// Mengekstrak semua tag timestamp seperti `[mm:ss.xx]` atau `[mm:ss.xxx]`
/// di awal atau di dalam baris, dan mengembalikan `(Vec<time_ms>, sisa_teks)`.
fn extract_timestamps_and_text(line: &str) -> (Vec<i64>, String) {
    let mut timestamps = Vec::new();
    let mut remainder = line;

    // Banyak lirik menaruh tag timestamp di awal secara bertumpuk: [00:10.00][00:20.00]Halo
    while let Some(start_bracket) = remainder.find('[') {
        if start_bracket != 0 && remainder[..start_bracket].chars().any(|c| !c.is_whitespace()) {
            // Jika ada teks non-spasi sebelum tanda '[', maka ini bukan tag header baris murni,
            // tapi kita tetap bisa cek apakah itu timestamp inline atau lirik biasa.
            // Sesuai standar LRC umum baris, kita hanya ambil timestamp di awal.
            break;
        }

        if let Some(end_bracket) = remainder[start_bracket..].find(']') {
            let actual_end = start_bracket + end_bracket;
            let tag_content = &remainder[start_bracket + 1..actual_end];

            if let Some(ms) = parse_timestamp_tag(tag_content) {
                timestamps.push(ms);
                remainder = &remainder[actual_end + 1..];
            } else {
                // Bukan timestamp yang valid (mis. [ti:judul] atau [custom])
                break;
            }
        } else {
            break;
        }
    }

    (timestamps, remainder.trim().to_string())
}

/// Parse isi tag `mm:ss.xx` atau `mm:ss.xxx` menjadi milidetik.
fn parse_timestamp_tag(tag: &str) -> Option<i64> {
    let trimmed = tag.trim();
    let (minutes_str, rest) = trimmed.split_once(':')?;

    let minutes: i64 = minutes_str.parse().ok()?;
    if minutes < 0 {
        return None;
    }

    // `rest` bisa berupa `ss.xx`, `ss.xxx`, atau sekadar `ss`
    let (seconds, ms) = if let Some((sec_str, frac_str)) = rest.split_once('.') {
        let sec: i64 = sec_str.parse().ok()?;
        let frac_len = frac_str.len();
        let frac_val: i64 = frac_str.parse().ok()?;

        let millis = match frac_len {
            1 => frac_val * 100,
            2 => frac_val * 10,       // format standar [mm:ss.xx] (centiseconds)
            3 => frac_val,            // format milidetik [mm:ss.xxx]
            _ => {
                // Jika lebih dari 3 digit, ambil 3 digit pertama
                let first_three = &frac_str[..3];
                first_three.parse::<i64>().unwrap_or(0)
            }
        };
        (sec, millis)
    } else {
        let sec: i64 = rest.parse().ok()?;
        (sec, 0)
    };

    if seconds < 0 || seconds >= 60 || ms < 0 || ms >= 1000 {
        return None;
    }

    Some((minutes * 60 + seconds) * 1000 + ms)
}

/// Cek dan ekstrak tag `[offset:+/-1000]`
fn try_parse_offset_tag(line: &str) -> Option<i64> {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let (key, val) = inner.split_once(':')?;
    if key.trim().eq_ignore_ascii_case("offset") {
        val.trim().parse::<i64>().ok()
    } else {
        None
    }
}

/// Deteksi apakah baris merupakan tag metadata yang diabaikan (ti, ar, al, by, length, dll.).
fn is_metadata_tag(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        return false;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    if let Some((key, _)) = inner.split_once(':') {
        let k = key.trim().to_ascii_lowercase();
        matches!(
            k.as_str(),
            "ti" | "ar" | "al" | "by" | "re" | "ve" | "length" | "creator" | "tool"
        )
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_lrc() {
        let lrc = r#"
[ti:Sample Title]
[ar:Sample Artist]
[00:01.50]Line 1
[00:04.200]Line 2
[00:07.00]Line 3
"#;
        let parsed = parse_lrc(lrc);
        assert!(parsed.is_synced);
        assert_eq!(parsed.file_offset_ms, 0);
        assert_eq!(parsed.lines.len(), 3);
        assert_eq!(parsed.lines[0].time_ms, 1500);
        assert_eq!(parsed.lines[0].text, "Line 1");
        assert_eq!(parsed.lines[1].time_ms, 4200);
        assert_eq!(parsed.lines[1].text, "Line 2");
        assert_eq!(parsed.lines[2].time_ms, 7000);
        assert_eq!(parsed.lines[2].text, "Line 3");
    }

    #[test]
    fn test_parse_multi_timestamp() {
        let lrc = "[00:02.00][00:05.00]Repeated chorus";
        let parsed = parse_lrc(lrc);
        assert!(parsed.is_synced);
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].time_ms, 2000);
        assert_eq!(parsed.lines[0].text, "Repeated chorus");
        assert_eq!(parsed.lines[1].time_ms, 5000);
        assert_eq!(parsed.lines[1].text, "Repeated chorus");
    }

    #[test]
    fn test_parse_offset_and_bom() {
        let lrc = "\u{feff}[offset:+500]\n[00:03.00]Intro";
        let parsed = parse_lrc(lrc);
        assert!(parsed.is_synced);
        assert_eq!(parsed.file_offset_ms, 500);
        assert_eq!(parsed.lines.len(), 1);
        assert_eq!(parsed.lines[0].time_ms, 3000);
    }

    #[test]
    fn test_parse_unsynced_plain_text() {
        let lrc = "Baris pertama tanpa waktu\nBaris kedua juga teks polos";
        let parsed = parse_lrc(lrc);
        assert!(!parsed.is_synced);
        assert_eq!(parsed.lines.len(), 2);
        assert_eq!(parsed.lines[0].time_ms, 0);
        assert_eq!(parsed.lines[0].text, "Baris pertama tanpa waktu");
    }

    #[test]
    fn test_active_index_binary_search() {
        let lrc = r#"
[00:02.00]Line 1 (2s)
[00:05.00]Line 2 (5s)
[00:09.00]Line 3 (9s)
"#;
        let parsed = parse_lrc(lrc);
        assert_eq!(parsed.active_index(1000, 0), None);
        assert_eq!(parsed.active_index(2000, 0), Some(0));
        assert_eq!(parsed.active_index(3500, 0), Some(0));
        assert_eq!(parsed.active_index(5000, 0), Some(1));
        assert_eq!(parsed.active_index(8999, 0), Some(1));
        assert_eq!(parsed.active_index(9000, 0), Some(2));
        assert_eq!(parsed.active_index(15000, 0), Some(2));

        // Dengan offset pengguna +1000ms (+1 detik lebih maju)
        assert_eq!(parsed.active_index(1000, 1000), Some(0)); // 1000 + 1000 = 2000ms
    }
}
