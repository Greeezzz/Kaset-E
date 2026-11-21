-- Riwayat pencarian lokal (MVP.md Fase 1 Search).
--
-- Kenapa tabel sendiri, bukan menyimpan di `settings`: yang dibutuhkan adalah
-- daftar terurut dengan waktu, bisa dipangkas, dan bisa dihapus per baris.
-- Menyimpannya sebagai satu string JSON di settings berarti baca-ubah-tulis
-- seluruh daftar setiap kali user mencari — dan satu baris rusak menghapus
-- semua riwayat.
--
-- `query_norm` adalah bentuk yang sudah dirapikan (huruf kecil, spasi
-- dirapatkan) dan dipakai sebagai kunci unik. Tanpa ini, "Radiohead",
-- "radiohead", dan "radiohead " akan muncul tiga kali di daftar saran.

CREATE TABLE search_history (
  query_norm  TEXT PRIMARY KEY,   -- bentuk ternormalisasi, unik
  query       TEXT NOT NULL,      -- teks asli seperti diketik user
  hits        INTEGER NOT NULL DEFAULT 1,  -- berapa kali dicari
  last_used_at INTEGER NOT NULL
);

-- Daftar "terakhir dicari" selalu diurutkan menurun berdasarkan waktu.
CREATE INDEX idx_search_history_last_used ON search_history(last_used_at DESC);