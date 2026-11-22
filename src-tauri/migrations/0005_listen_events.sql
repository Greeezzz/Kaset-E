-- Peristiwa mendengar (Fase 4a: pencatat delta).
--
-- Kenapa DELTA dan bukan satu baris "mulai → selesai":
-- satu sesi mendengar bisa berakhir karena app ditutup, lagu di-skip, atau
-- mesin mati. Kalau kita baru menulis saat lagu selesai, semua sesi yang
-- terputus hilang begitu saja. Dengan menyimpan potongan waktu (delta) yang
-- sudah benar-benar diputar, tidak ada yang hilang — dan seek ke depan tidak
-- dihitung sebagai waktu mendengar.
--
-- `started_at` adalah epoch milidetik UTC. Zona waktu perangkat dipakai saat
-- MENGHITUNG (heatmap 24 jam, streak); database tidak pernah menyimpan waktu
-- lokal. Lihat REVIEW-V2.md §2.
--
-- `delta_ms` sengaja INTEGER dan bukan REAL: pembulatan sub-milidetik tidak
-- berguna, dan bilangan bulat membuat penjumlahan statistik eksak.

CREATE TABLE listen_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id    TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,   -- epoch ms UTC, awal potongan
  delta_ms    INTEGER NOT NULL,   -- durasi yang benar-benar diputar
  FOREIGN KEY (video_id) REFERENCES tracks(video_id) ON DELETE CASCADE
);

-- Statistik hampir selalu dibaca per rentang waktu ("minggu ini", "tahun ini"),
-- jadi mulai dari waktu. Tanpa indeks ini, layar Stats memindai seluruh tabel.
CREATE INDEX idx_listen_events_started ON listen_events(started_at);

-- Top lagu/artis mengelompokkan per lagu dalam rentang waktu.
CREATE INDEX idx_listen_events_video ON listen_events(video_id, started_at);