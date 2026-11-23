-- Antrean prioritas (fitur "custom queue" ala Spotify).
--
-- Dua jenis lagu dalam satu antrean:
--
--   prioritas = 1  lagu yang pengguna tambahkan sendiri ("Tambah ke antrean").
--                  Selalu diputar lebih dulu, sesuai urutan penambahan.
--   prioritas = 0  lagu dari playlist / hasil ACAK. Urutannya boleh acak.
--
-- Kenapa kolom dan bukan tabel terpisah: keduanya satu antrean yang dilihat
-- pengguna sebagai satu daftar. Memisahnya jadi dua tabel berarti dua sumber
-- kebenaran untuk cursor, dan bug sinkronisasi antrean sudah pernah terjadi
-- di proyek ini (lihat PROGRESS.md).
--
-- `prioritas_urut` menyimpan urutan penambahan antar lagu prioritas, supaya
-- lagu yang ditambahkan duluan tetap diputar duluan walau shuffle menyala.

ALTER TABLE queue_items ADD COLUMN prioritas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE queue_items ADD COLUMN prioritas_urut INTEGER NOT NULL DEFAULT 0;
