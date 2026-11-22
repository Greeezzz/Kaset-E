-- Detail playlist kustom: deskripsi dan cover (DESIGN-LAYOUT §5).
--
-- `cover_mode`:
--   'auto'       → mosaik 4 cover lagu pertama (default).
--   'custom'     → gambar upload yang sudah diproses Rust (crop 1:1, 512px).
--   'generative' → placeholder deterministik (FNV-1a + inisial).
--
-- `cover_path` hanya menyimpan NAMA FILE relatif di `<app_data>/playlist_covers/`,
-- bukan path absolut dan bukan gambar mentah/base64 — folder data bisa pindah,
-- dan SQLite tidak boleh membengkak oleh blob gambar.

ALTER TABLE playlists ADD COLUMN description TEXT;
ALTER TABLE playlists ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE playlists ADD COLUMN cover_path TEXT;
