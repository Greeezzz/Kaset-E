//! Modul terjemahan lirik otomatis menggunakan Google Translate (gtx endpoint)
//! dan cache SQLite lokal.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

use crate::db::{now_ms, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslationResult {
    pub source_lang: String,
    pub target_lang: String,
    pub same_language: bool,
    pub lines: Vec<Option<String>>,
}

/// Menghitung SHA-256 hash dari gabungan seluruh baris lirik input.
pub fn calculate_lyrics_hash(lines: &[String]) -> String {
    let mut hasher = Sha256::new();
    for line in lines {
        hasher.update(line.as_bytes());
        hasher.update(b"\n");
    }
    let hash = hasher.finalize();
    hash.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Mengambil terjemahan dari cache SQLite jika tersedia.
pub fn get_cached_translation(
    db: &Db,
    track_id: &str,
    target_lang: &str,
    lyrics_hash: &str,
) -> AppResult<Option<TranslationResult>> {
    db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT source_lang, same_language, lines_json
             FROM lyrics_translations
             WHERE track_id = ?1 AND target_lang = ?2 AND lyrics_hash = ?3",
        )?;

        let mut rows = stmt.query(rusqlite::params![track_id, target_lang, lyrics_hash])?;
        if let Some(row) = rows.next()? {
            let source_lang: String = row.get(0)?;
            let same_language_int: i64 = row.get(1)?;
            let lines_json: String = row.get(2)?;

            let lines: Vec<Option<String>> = serde_json::from_str(&lines_json)
                .map_err(|e| AppError::invalid(format!("Gagal parse lines_json: {e}")))?;

            Ok(Some(TranslationResult {
                source_lang,
                target_lang: target_lang.to_string(),
                same_language: same_language_int != 0,
                lines,
            }))
        } else {
            Ok(None)
        }
    })
}

/// Menyimpan terjemahan ke cache SQLite.
pub fn save_cached_translation(
    db: &Db,
    track_id: &str,
    target_lang: &str,
    lyrics_hash: &str,
    result: &TranslationResult,
) -> AppResult<()> {
    let lines_json = serde_json::to_string(&result.lines)
        .map_err(|e| AppError::invalid(format!("Gagal serialize lines: {e}")))?;
    let now = now_ms();
    let same_lang_int = if result.same_language { 1 } else { 0 };

    db.with(|conn| {
        conn.execute(
            "INSERT INTO lyrics_translations
             (track_id, target_lang, lyrics_hash, source_lang, same_language, lines_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(track_id, target_lang, lyrics_hash) DO UPDATE SET
                source_lang = excluded.source_lang,
                same_language = excluded.same_language,
                lines_json = excluded.lines_json,
                created_at = excluded.created_at",
            rusqlite::params![
                track_id,
                target_lang,
                lyrics_hash,
                result.source_lang,
                same_lang_int,
                lines_json,
                now
            ],
        )?;
        Ok(())
    })
}

/// URL-encode string untuk x-www-form-urlencoded
fn url_encode(input: &str) -> String {
    let mut encoded = String::with_capacity(input.len() * 3);
    for b in input.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            b' ' => encoded.push('+'),
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}

/// Memanggil API Google Translate gtx dengan POST application/x-www-form-urlencoded
async fn call_gtx_translate(
    client: &reqwest::Client,
    text: &str,
    target_lang: &str,
) -> Result<(String, String), AppError> {
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={}&dt=t",
        target_lang
    );

    let body = format!("q={}", url_encode(text));

    let res = client
        .post(&url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Koneksi Google Translate gagal: {e}")))?;

    if !res.status().is_success() {
        return Err(AppError::Network(format!(
            "Google Translate HTTP error: {}",
            res.status()
        )));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| AppError::invalid(format!("Gagal membaca respons Google Translate: {e}")))?;

    // json[0] adalah array segmen hasil terjemahan: [[translated_text, original_text, ...], ...]
    let mut translated_full = String::new();
    if let Some(segments) = json.get(0).and_then(|v| v.as_array()) {
        for seg in segments {
            if let Some(t) = seg.get(0).and_then(|v| v.as_str()) {
                translated_full.push_str(t);
            }
        }
    }

    // json[2] adalah detected source language, mis. "en", "ja", "ko", "id"
    let source_lang = json
        .get(2)
        .and_then(|v| v.as_str())
        .unwrap_or("auto")
        .to_string();

    Ok((translated_full, source_lang))
}

/// Menangani terjemahan sub-chunk (misal 5 baris) saat batch besar kehilangan keselarasan baris.
async fn translate_sub_chunk(
    client: &reqwest::Client,
    sub_lines: &[String],
    target_lang: &str,
) -> Vec<String> {
    let delimiter = "\n---\n";
    let combined = sub_lines.join(delimiter);

    if let Ok((res, _)) = call_gtx_translate(client, &combined, target_lang).await {
        let parts: Vec<&str> = res.split("---").map(|s| s.trim()).collect();
        if parts.len() == sub_lines.len() {
            return parts.into_iter().map(|s| s.to_string()).collect();
        }
    }

    // Fallback ekstrem per baris jika delimiter rusak
    let mut out = Vec::with_capacity(sub_lines.len());
    for line in sub_lines {
        if line.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        match call_gtx_translate(client, line, target_lang).await {
            Ok((t, _)) => out.push(t.trim().to_string()),
            Err(_) => out.push(String::new()),
        }
    }
    out
}

/// Menerjemahkan seluruh daftar baris lirik dengan line-alignment safeguard & batching.
pub async fn translate_lyrics_lines(
    lines: Vec<String>,
    target_lang: &str,
) -> Result<TranslationResult, AppError> {
    if lines.is_empty() {
        return Ok(TranslationResult {
            source_lang: "auto".into(),
            target_lang: target_lang.into(),
            same_language: false,
            lines: Vec::new(),
        });
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::Network(format!("Gagal membuat HTTP client: {e}")))?;

    // 1. Filter baris kosong / instrumental, catat indeks asli
    let mut meaningful_indices = Vec::new();
    let mut meaningful_texts = Vec::new();

    for (idx, text) in lines.iter().enumerate() {
        let trimmed = text.trim();
        // Lewati baris kosong atau sekadar simbol musik instrumental
        if !trimmed.is_empty() && trimmed != "♪" && trimmed != "♬" {
            meaningful_indices.push(idx);
            meaningful_texts.push(trimmed.to_string());
        }
    }

    if meaningful_texts.is_empty() {
        return Ok(TranslationResult {
            source_lang: "auto".into(),
            target_lang: target_lang.into(),
            same_language: false,
            lines: vec![None; lines.len()],
        });
    }

    // 2. Chunking ~3.000 karakter untuk batching utama
    let mut all_translated_meaningful = Vec::with_capacity(meaningful_texts.len());
    let mut detected_source_lang = "auto".to_string();

    let mut current_chunk = Vec::new();
    let mut current_char_len = 0;

    for text in meaningful_texts {
        if current_char_len + text.len() > 3000 && !current_chunk.is_empty() {
            let chunk_combined = current_chunk.join("\n");
            let (translated_full, src) = call_gtx_translate(&client, &chunk_combined, target_lang).await?;
            detected_source_lang = src;

            let split_lines: Vec<&str> = translated_full.lines().map(|s| s.trim()).collect();
            if split_lines.len() == current_chunk.len() {
                for s in split_lines {
                    all_translated_meaningful.push(s.to_string());
                }
            } else {
                // Line count mismatch: Fallback per 5 baris
                for sub in current_chunk.chunks(5) {
                    let sub_res = translate_sub_chunk(&client, sub, target_lang).await;
                    all_translated_meaningful.extend(sub_res);
                }
            }

            current_chunk = Vec::new();
            current_char_len = 0;
        }

        current_char_len += text.len() + 1;
        current_chunk.push(text);
    }

    if !current_chunk.is_empty() {
        let chunk_combined = current_chunk.join("\n");
        let (translated_full, src) = call_gtx_translate(&client, &chunk_combined, target_lang).await?;
        detected_source_lang = src;

        let split_lines: Vec<&str> = translated_full.lines().map(|s| s.trim()).collect();
        if split_lines.len() == current_chunk.len() {
            for s in split_lines {
                all_translated_meaningful.push(s.to_string());
            }
        } else {
            // Line count mismatch: Fallback per 5 baris
            for sub in current_chunk.chunks(5) {
                let sub_res = translate_sub_chunk(&client, sub, target_lang).await;
                all_translated_meaningful.extend(sub_res);
            }
        }
    }

    // 3. Deteksi bahasa sama (same-language short circuit)
    let same_language = detected_source_lang.to_lowercase() == target_lang.to_lowercase();

    // 4. Petakan kembali ke array hasil dengan panjang tepat sama dengan input `lines`
    let mut final_lines: Vec<Option<String>> = vec![None; lines.len()];
    for (i, &orig_idx) in meaningful_indices.iter().enumerate() {
        if let Some(trans_str) = all_translated_meaningful.get(i) {
            let t = trans_str.trim();
            if !t.is_empty() {
                final_lines[orig_idx] = Some(t.to_string());
            }
        }
    }

    Ok(TranslationResult {
        source_lang: detected_source_lang,
        target_lang: target_lang.to_string(),
        same_language,
        lines: final_lines,
    })
}
