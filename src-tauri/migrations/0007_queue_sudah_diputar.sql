-- Tandai lagu yang sudah dilewati/memutar cursor (perbaikan "antrean
-- prioritas hantu").
--
-- Kenapa perlu kolom: urutan pemutaran (`order`) di QueueManager sengaja TIDAK
-- disimpan, karena shuffle harus bisa dibatalkan ke urutan asli `items`. Saat
-- aplikasi dibuka lagi, `order` dibangun ulang dari nol — sehingga informasi
-- "lagu ini sudah diputar" hilang dan lagu prioritas yang sudah lewat muncul
-- lagi sebagai "berikutnya".
--
-- Nama `sudah_diputar` dipilih sesuai laporan bug, tapi maknanya lebih tepat
-- "posisi cursor sudah melewati lagu ini": lagu yang di-skip dengan melompat
-- ke depan juga bertanda, karena pemutaran tidak akan kembali ke sana dengan
-- sendirinya. Penanda ini dipakai `restore` dan `enable_shuffle_for` untuk
-- menaruh lagu tersebut SEBELUM lagu aktif, bukan sesudahnya.
--
-- `NOT NULL DEFAULT 0` membuat antrean lama (dari sebelum migrasi ini) tetap
-- valid: semuanya dianggap belum diputar, perilaku yang sama seperti dulu.

ALTER TABLE queue_items ADD COLUMN sudah_diputar INTEGER NOT NULL DEFAULT 0;
