-- Migrasi 0010: Cache terjemahan lirik lokal (Google Translate gtx)
CREATE TABLE IF NOT EXISTS lyrics_translations (
    track_id       TEXT NOT NULL,
    target_lang    TEXT NOT NULL,
    lyrics_hash    TEXT NOT NULL,
    source_lang    TEXT NOT NULL,
    same_language  INTEGER NOT NULL DEFAULT 0,
    lines_json     TEXT NOT NULL,
    created_at     INTEGER NOT NULL,
    PRIMARY KEY (track_id, target_lang, lyrics_hash)
);

CREATE INDEX IF NOT EXISTS idx_lyrics_translations_track ON lyrics_translations(track_id);
