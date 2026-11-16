-- Cache cover art. Lihat docs/THUMBNAILS.md.
-- Wajib: proyek menjanjikan offline-first, jadi cover tidak boleh bergantung
-- pada server gambar YouTube setiap kali render.

CREATE TABLE covers (
  key         TEXT PRIMARY KEY,   -- 'v:<video_id>' atau 'a:<collection_id>'
  kind        TEXT NOT NULL,      -- 'track' | 'collection'
  path        TEXT,               -- path relatif di <app_data>/covers/, NULL kalau gagal
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  status      TEXT NOT NULL,      -- 'ok' | 'missing' | 'error'
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_try_at INTEGER,
  fetched_at  INTEGER
);

CREATE INDEX idx_covers_status ON covers(status);
CREATE INDEX idx_covers_fetched_at ON covers(fetched_at);
