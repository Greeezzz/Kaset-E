-- 0009_sync_metadata.sql: Tambah kolom UUID dan timestamp tracking untuk sinkronisasi cloud Supabase

-- 1. Tambah kolom uuid dan deleted_at pada playlists
ALTER TABLE playlists ADD COLUMN uuid TEXT;
ALTER TABLE playlists ADD COLUMN deleted_at INTEGER;

-- Isi UUID untuk playlist lama yang belum punya UUID
UPDATE playlists SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL;

-- Indeks UUID playlist untuk lookup cepat
CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_uuid ON playlists(uuid);

-- 2. Tambah deleted_at pada favorites untuk soft-delete saat sinkronisasi
ALTER TABLE favorites ADD COLUMN deleted_at INTEGER;
ALTER TABLE favorites ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE favorites SET updated_at = added_at WHERE updated_at = 0;

-- 3. Tambah deleted_at dan updated_at pada playlist_tracks
ALTER TABLE playlist_tracks ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE playlist_tracks ADD COLUMN deleted_at INTEGER;
UPDATE playlist_tracks SET updated_at = added_at WHERE updated_at = 0;
