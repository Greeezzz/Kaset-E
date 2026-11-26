-- Tabel lirik lagu (FEATURES-V3 §4 L1).
--
-- Menyimpan lirik asli (LRC atau teks polos) per track.
-- `sumber`: 'impor' (manual oleh user) atau 'lrclib' (opt-in otomatis).
-- `offset_ms`: offset waktu dalam milidetik (positif = lirik maju, negatif = lirik mundur).
-- `diambil_pada`: timestamp epoch milliseconds saat lirik disimpan/diperbarui.

CREATE TABLE IF NOT EXISTS lyrics (
    video_id     TEXT PRIMARY KEY REFERENCES tracks(video_id) ON DELETE CASCADE,
    lrc          TEXT NOT NULL,
    sumber       TEXT NOT NULL DEFAULT 'impor',
    offset_ms    INTEGER NOT NULL DEFAULT 0,
    diambil_pada INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lyrics_sumber ON lyrics(sumber);
