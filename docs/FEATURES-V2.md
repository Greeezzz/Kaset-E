# FEATURES-V2 — Kaset

> Fitur tambahan di luar MVP awal: **listen stats**, **import playlist lintas aplikasi**, **smart shuffle**, dan **login opsional**.
> **Jangan dikerjakan sebelum Fase 1 beres** (terutama queue, shuffle dasar, auto-next). Dokumen ini menggantikan bagian "Backlog" di `MVP.md` untuk fitur-fitur ini.

## 0. Urutan dan Dependensi

```
Fase 1 (queue dasar selesai)
   └─► Fase 4: Listen Stats (lokal)
          ├─► Fase 4b: Smart Shuffle lokal   (butuh data skip/selesai dari Stats)
          └─► Fase 5: Import Playlist        (independen, tapi enak setelah library stabil)
                 └─► Fase 6: Login + Sync (opsional)
```

Semua fitur di Fase 4–5 **tetap lokal**: tanpa akun, tanpa server, tanpa telemetri.

---

## 1. Listen Stats (Fase 4, target `v0.4.0`)

### 1.1 Tujuan
Menunjukkan kebiasaan mendengar pengguna: berapa lama, lagu/artis apa, seberapa sering diulang. Semua data hanya ada di perangkat.

### 1.2 Yang Dicatat
Satu baris `listen_events` per sesi putar sebuah lagu.

| Field | Arti |
|-------|------|
| `video_id` | lagu yang diputar |
| `started_at` | epoch ms saat mulai |
| `listened_ms` | **waktu yang benar-benar didengar** |
| `track_duration_ms` | durasi lagu (untuk menghitung persen) |
| `outcome` | `completed` / `skipped` / `interrupted` |
| `source` | dari mana lagu datang: `search`, `queue`, `playlist`, `shuffle`, `smart` |

### 1.3 Aturan Perhitungan (penting)

- `listened_ms` dihitung dengan **mengakumulasi delta pemutaran** (dari event posisi/`timeupdate`), **bukan** `waktu_selesai - waktu_mulai`. Kalau tidak, pause dan seek merusak angkanya.
- Seek tidak dihitung, tapi **jangan** memakai ambang tetap seperti "> 2 detik berarti seek". Saat jendela tidak aktif — atau nanti di Android ketika layar mati — `timeupdate` jarang dipanggil (bisa 3–5 detik sekali), dan delta normal akan salah dibuang sehingga `listened_ms` terlalu kecil.
- Aturan yang benar: bandingkan kemajuan posisi audio dengan waktu nyata yang lewat. Delta dianggap seek hanya bila **posisi audio maju lebih jauh daripada selang waktu nyata** (mis. posisi lompat 30 detik padahal baru 2 detik berlalu). Kalau 5 detik nyata lewat dan posisi maju 5 detik, itu pemutaran normal dan **harus** dihitung.
- Saat jeda (pause), posisi audio tidak maju sehingga delta-nya nol dan otomatis tidak menambah apa pun. Delta negatif (seek mundur) juga diabaikan.
- Event ditulis saat lagu berganti atau app ditutup. Simpan juga secara berkala (mis. tiap 15 detik) ke buffer agar crash tidak menghilangkan data.
- `outcome`:
  - `completed`: lagu selesai alami (≥ 90% durasi didengar).
  - `skipped`: pengguna pindah lagu sebelum ambang "play".
  - `interrupted`: app ditutup / error / pindah setelah ambang "play" tapi sebelum selesai.
- Sebuah lagu dihitung sebagai **"play"** jika `listened_ms ≥ min(30 detik, 50% durasi)`.

### 1.4 Skema (migrasi `0005_listen_events.sql`)

> **Koreksi:** dokumen ini semula menyebut `0003`. Nomor itu sudah dipakai
> `search_history` (Fase 1) dan `0004` dipakai `playlist_details`, jadi
> `listen_events` masuk sebagai `0005`. Skema yang benar-benar dipakai lebih
> ramping daripada contoh di bawah: satu baris per POTONGAN waktu, bukan per
> sesi — lihat alasannya di `MVP.md` Fase 4a.

```sql
CREATE TABLE listen_events (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id           TEXT NOT NULL REFERENCES tracks(video_id),
  started_at         INTEGER NOT NULL,
  listened_ms        INTEGER NOT NULL CHECK (listened_ms >= 0),
  track_duration_ms  INTEGER,
  outcome            TEXT NOT NULL CHECK (outcome IN ('completed','skipped','interrupted')),
  source             TEXT
);
CREATE INDEX idx_listen_video   ON listen_events(video_id);
CREATE INDEX idx_listen_started ON listen_events(started_at DESC);
```

Tabel `history` yang sudah ada boleh dipertahankan sebagai daftar "baru diputar"; `listen_events` untuk analitik. Jangan digabung.

### 1.5 Metrik yang Ditampilkan

- Total waktu dengar: hari ini / 7 hari / 30 hari / sepanjang masa
- Jumlah play per lagu; **Top lagu** dan **Top artis** (per rentang waktu)
- "Lagu yang paling sering diulang" (play count tertinggi)
- Streak hari berturut-turut mendengar
- Distribusi jam dengar (heatmap 24 jam)
- Rasio selesai vs skip (indikator selera)
- Opsional: ringkasan tahunan ("Kaset Wrapped"), murni lokal

### 1.5b Query contoh

```sql
-- Top lagu 30 hari terakhir (hanya yang dihitung "play")
SELECT video_id, COUNT(*) AS plays, SUM(listened_ms) AS total_ms
FROM listen_events
WHERE started_at >= :since
  AND listened_ms >= MIN(30000, COALESCE(track_duration_ms, 60000) / 2)
GROUP BY video_id
ORDER BY plays DESC, total_ms DESC
LIMIT 20;
```

### 1.6 Kriteria Selesai

- [ ] Migrasi `0005` + repository `listen`
- [ ] Pencatat di Rust yang menerima event posisi dan menulis event saat lagu berganti
- [ ] Unit test: seek tidak menggelembungkan `listened_ms`; pause tidak dihitung; ambang "play"
- [ ] Layar **Stats** di UI (lihat `DESIGN-ENDFIELD.md` bagian "Stats sebagai telemetri")
- [ ] Opsi di Settings: **hapus semua data statistik** dan **matikan pencatatan**
- [ ] Data ikut dalam export/import library JSON (opsional, bisa dimatikan)

---

## 2. Smart Shuffle (Fase 4b, target `v0.4.x`)

### 2.1 Dua Tingkat

| Tingkat | Deskripsi | Butuh |
|---------|-----------|-------|
| **A. Lokal berbobot** | Acak yang mempertimbangkan kebiasaanmu. **Target utama.** | Data `listen_events` |
| **B. Sisipan rekomendasi** | Menyisipkan lagu baru dari "radio"/up-next YouTube Music tiap N lagu. **Opsional.** | Sumber rekomendasi (unofficial) |

### 2.2 Tingkat A — Algoritma

Untuk tiap kandidat lagu dalam queue, hitung bobot lalu lakukan **weighted random** (bukan sortir mentah).

```
weight = base
       × recency_penalty      // baru diputar → bobot turun
       × skip_penalty         // sering di-skip → turun
       × affinity_boost       // sering selesai / favorit → naik
       × artist_spacing       // artis sama baru saja diputar → turun tajam
```

Usulan awal (semua **bisa di-tuning**, simpan sebagai konstanta terpusat):

| Faktor | Aturan awal |
|--------|-------------|
| `base` | 1.0 |
| `recency_penalty` | ×0.2 jika diputar dalam 10 lagu terakhir; ×0.6 jika dalam 24 jam terakhir |
| `skip_penalty` | ×(1 − skip_rate × 0.7), `skip_rate` dari 20 event terakhir lagu itu |
| `affinity_boost` | ×1.3 jika favorit; ×(1 + completion_rate × 0.3) |
| `artist_spacing` | ×0.1 jika artis sama dengan 1 lagu sebelumnya; ×0.5 jika dalam 3 lagu terakhir |

Aturan keras:
- Tidak pernah memutar **lagu yang sama dua kali berturut-turut** (kecuali repeat-one).
- Lagu tanpa riwayat memakai bobot netral (jangan dihukum).
- Hasil bisa **dikembalikan ke urutan asli** (kolom `original_order` tetap dipakai).
- Deterministik untuk tes: terima `seed` agar test bisa mereproduksi urutan.

### 2.3 Tingkat B — Sisipan Rekomendasi (opsional)

- Setiap N lagu (default 4), sisipkan 1 lagu dari radio/up-next lagu yang sedang diputar.
- Item sisipan **ditandai jelas** di queue (label "SARAN"), bisa dihapus dengan sekali tap.
- Bila sumber rekomendasi gagal, **diam-diam kembali ke Tingkat A**; jangan memblokir pemutaran.
- Verifikasi dulu apakah crate katalog yang dipakai mendukung endpoint ini. Jangan mengarang API.
- Hormati kebijakan di `RESILIENCE.md` (rate limit, backoff).

### 2.3b Antrean Dua Jenis — SELESAI

Setiap item antrean punya penanda `prioritas`, bukan dua daftar terpisah.
Dua daftar berarti dua sumber kebenaran untuk cursor, dan bug sinkronisasi
antrean sudah pernah terjadi (lihat catatan cursor di `PROGRESS.md`).

| | `prioritas = true` | `prioritas = false` |
|---|---|---|
| Dari mana | "Tambah ke antrean", "Putar berikutnya" | isi playlist, hasil ACAK |
| Urutan | sesuai `prioritas_urut` (urutan penambahan) | diacak |
| Posisi main | **selalu sebelum** lagu acak | setelah semua prioritas |

Urutan hasil shuffle: `[lagu aktif]` → `[prioritas berurutan]` → `[sisa diacak]`.
Itulah "custom queue" ala Spotify: lagu yang kamu pilih sendiri tidak pernah
tenggelam di antara lagu acak.

Aturan penting:

- Lagu aktif **selalu** di depan, termasuk saat shuffle dinyalakan ulang.
- Menyalakan shuffle lagi **tidak mengacak** lagu prioritas.
- `replace()` (isi dari playlist) menandai semua lagu `prioritas = false`.
- Saat shuffle mati, prioritas kembali ke posisi aslinya di `items` — perilaku
  shuffle non-destruktif dipertahankan, jadi urutan asli tidak pernah hilang.

Di UI, lagu prioritas diberi label **PILIHANMU** di panel antrean.

### 2.4 Kriteria Selesai

- [ ] Modul `queue::smart_shuffle` murni (tanpa I/O) menerima daftar lagu + statistik + seed
- [ ] Unit test: tidak ada artis berurutan bila ada alternatif; lagu yang sering di-skip jarang muncul; repeat-one tetap bekerja; seed menghasilkan urutan sama
- [ ] Toggle di UI: **Shuffle biasa / Shuffle pintar**
- [ ] Tingkat B hanya setelah A stabil

---

## 3. Import Playlist (Fase 5, target `v0.5.0`)

### 3.1 Prinsip

1. **Tanpa login dulu.** Dua jalur masuk: **link playlist YouTube Music** dan **file CSV/JSON**.
2. Semua sumber lain (Spotify, Apple Music, Deezer, dll.) cukup lewat **file** yang diekspor pengguna, satu importer generik.
3. Pencocokan lagu ke YouTube Music selalu lewat **layar review** untuk hasil yang meragukan.
4. Jangan menaruh API key/secret pihak ketiga di repo. Jangan menyimpan token apa pun.

### 3.2 Kenapa Tidak Langsung Pakai API Spotify

Per panduan Spotify Februari 2026, app development mode baru dibatasi: owner harus Premium, maksimal 5 user, dan membaca isi playlist hanya untuk playlist milik/kolaborasi akun itu. Itu tidak praktis untuk proyek yang ingin dicoba orang lain. **Verifikasi lagi aturan terbaru sebelum mempertimbangkan integrasi API langsung.**

### 3.3 Format Import Generik

CSV (header wajib, urutan bebas, kolom tak dikenal diabaikan):

```csv
title,artist,album,duration_ms
"Judul Lagu","Nama Artis","Nama Album",215000
```

JSON:

```json
{
  "name": "Nama Playlist",
  "tracks": [
    { "title": "Judul Lagu", "artist": "Nama Artis", "album": "Nama Album", "duration_ms": 215000 }
  ]
}
```

Adapter kecil per sumber boleh ditambah belakangan (memetakan nama kolom ekspor sumber tertentu ke format di atas). Verifikasi kolom ekspor tiap sumber dengan contoh file nyata sebelum menulis adapter; jangan menebak.

### 3.4 Alur Pencocokan

1. Normalisasi judul dan artis: huruf kecil, hapus tanda baca, buang noise seperti `(Official Video)`, `[Remastered]`, `feat.`.
2. Untuk tiap baris: cari di `MusicCatalog` dengan query `"{artist} {title}"`.
3. Beri skor tiap kandidat:

```
score = 0.5 × kemiripan_judul
      + 0.3 × kemiripan_artis
      + 0.2 × kecocokan_durasi     // 1.0 jika selisih ≤ 3 dtk, turun linear sampai 0 di ≥ 15 dtk
```

4. Keputusan (ambang awal, bisa di-tuning):

| Skor | Aksi |
|------|------|
| ≥ 0.85 | Cocok otomatis |
| 0.60–0.85 | Masuk **review**: tampilkan 3 kandidat teratas, pengguna memilih atau melewati |
| < 0.60 | **Tidak ditemukan**, masuk daftar terpisah |

5. Penalti untuk kandidat bertanda `live`, `cover`, `remix`, `karaoke`, `instrumental` bila baris sumber tidak mengandung kata itu.
6. Hormati rate limit resolver/katalog: **antre dan beri jeda**, tampilkan progres ("142 / 300"), bisa dibatalkan, bisa dilanjutkan.

### 3.5 Skema (migrasi `0006_queue_prioritas.sql`)

> **Koreksi:** impor TIDAK punya tabel sendiri. Hasil impor hidup di memori
> dialog sampai pengguna menekan simpan, lalu masuk ke `playlists` +
> `playlist_tracks` yang sudah ada. Nomor `0004` dipakai `playlist_details`,
> `0005` dipakai `listen_events`, dan `0006` menambah penanda prioritas
> antrean — bukan tabel impor.

```sql
CREATE TABLE import_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,            -- 'ytmusic_link' | 'csv' | 'json'
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running','review','done','cancelled'))
);

CREATE TABLE import_items (
  job_id       INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  src_title    TEXT NOT NULL,
  src_artist   TEXT,
  src_album    TEXT,
  src_duration_ms INTEGER,
  matched_video_id TEXT,
  score        REAL,
  state        TEXT NOT NULL CHECK (state IN ('pending','auto','review','skipped','not_found','confirmed')),
  PRIMARY KEY (job_id, position)
);
```

### 3.6 Layar Import (alur UI)

1. **Pilih sumber**: tempel link / pilih file.
2. **Pratinjau**: nama playlist, jumlah lagu, contoh 5 baris pertama.
3. **Proses**: progres + tombol batal.
4. **Review**: daftar yang meragukan; per baris pilih kandidat / lewati.
5. **Ringkasan**: "X cocok, Y dilewati, Z tidak ditemukan" → tombol **Simpan sebagai playlist**.
6. Daftar "tidak ditemukan" bisa diekspor ke CSV.

### 3.7 Kriteria Selesai

- [ ] Parser CSV/JSON dengan tes (kutip, koma di judul, UTF-8, baris kosong)
- [ ] Normalisasi + skor kecocokan dengan tes untuk kasus nyata (versi live, remix, judul campur bahasa)
- [ ] Import dari link playlist YouTube Music (publik)
- [ ] Layar review dan ringkasan
- [ ] Batalkan dan lanjutkan job
- [ ] Rate limit dan backoff sesuai `RESILIENCE.md`

---

## 4. Login + Sync (Fase 6, **opsional**)

### 4.1 Kapan Dibutuhkan
Hanya jika ingin: (a) sinkron statistik/playlist antar device, atau (b) menarik data pribadi dari akun YouTube Music. **Listen stats dan import tidak membutuhkannya.**

### 4.2 Pilihan Arsitektur

| Opsi | Catatan |
|------|---------|
| **Tanpa akun, sinkron lewat file** | Export/import JSON atau Syncthing. Paling sederhana, nol server. **Default.** |
| **Akun sendiri + backend kecil** | Supabase atau Turso. Perlu skema sync, penanganan konflik, dan keamanan. |
| **Login ke akun YouTube Music** | Jalur unofficial (cookie/OAuth tiruan). **Ada risiko akun dibatasi.** Jangan jadikan fitur inti. |

### 4.3 Aturan Keamanan (jika dikerjakan)

- Token/cookie disimpan di **keychain/keystore OS**, bukan di SQLite polos, bukan di log, bukan di repo.
- Jangan mencatat kredensial atau isi respons mentah.
- Beri peringatan jelas soal risiko ToS sebelum pengguna login ke akun Google.
- Sync harus **opt-in** dan bisa dimatikan; data lokal tetap bisa dipakai tanpa akun.
- Data sync dienkripsi di sisi klien bila memakai backend sendiri.

### 4.4 Catatan Konflik Data (jika sync)

- `listen_events` bersifat **append-only** → mudah digabung (union berdasarkan `id` global/UUID).
- Playlist dan queue butuh aturan konflik (last-write-wins per playlist sudah cukup untuk proyek pribadi).
- Ganti `INTEGER AUTOINCREMENT` dengan UUID untuk tabel yang akan disinkronkan **sebelum** fitur sync dibangun.

---

## 5. Pertimbangan Lintas Fitur

- **Privasi:** semua statistik lokal; sediakan tombol hapus dan matikan.
- **Performa:** query statistik diindeks; hitung agregat di Rust, jangan tarik ribuan baris ke UI.
- **Android:** pencatat listen harus tahan terhadap proses di-background; event ditulis berkala.
- **Ukuran data:** `listen_events` tumbuh terus; sediakan pemangkasan opsional (mis. ringkas event > 2 tahun jadi agregat).
- **Hukum:** jangan memakai merek/logo layanan lain (Spotify dll.) di UI import; tulis nama mereka sebagai teks biasa saja.
