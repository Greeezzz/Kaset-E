-- Kaset: skema awal. Migrasi yang sudah dirilis JANGAN diedit — buat file baru.
PRAGMA foreign_keys = ON;

CREATE TABLE tracks (
  video_id     TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  artist       TEXT NOT NULL,
  album        TEXT,
  duration_ms  INTEGER,
  thumbnail    TEXT,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE playlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES tracks(video_id),
  position    INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE favorites (
  video_id   TEXT PRIMARY KEY REFERENCES tracks(video_id),
  added_at   INTEGER NOT NULL
);

CREATE TABLE history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id   TEXT NOT NULL REFERENCES tracks(video_id),
  played_at  INTEGER NOT NULL
);
CREATE INDEX idx_history_played_at ON history(played_at DESC);

-- Queue disimpan agar bisa dipulihkan saat app dibuka.
CREATE TABLE queue_items (
  position       INTEGER PRIMARY KEY,
  video_id       TEXT NOT NULL REFERENCES tracks(video_id),
  original_order INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Catatan: tabel `schema_migrations` TIDAK dibuat di sini. Ia dikelola oleh
-- db::migrations::run() sebelum migrasi mana pun dijalankan.
