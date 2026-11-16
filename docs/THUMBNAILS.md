# THUMBNAILS — Desain Cache Cover Art

> Dokumen ini menutup celah `ARCHITECTURE.md`: proyek mengklaim *offline-first*, tapi tidak pernah menjelaskan dari mana cover album datang dan bagaimana ia tidak bergantung pada server YouTube. Cover art **wajib** di-cache ke disk.

## 1. Prinsip

1. **Cover diambil lewat Rust, bukan `<img src="...ytimg...">` di webview.** Alasannya: (a) kita bisa kontrol User-Agent + Referer, (b) tidak ada kebocoran IP/session webview ke server gambar, (c) bisa disimpan ke disk dan dibaca offline, (d) bisa dipakai di Android tanpa webview aktif.
2. **Sekali ambil, tersimpan.** Setelah cover pertama berhasil diunduh, aplikasi tidak pernah butuh internet untuk menampilkannya lagi.
3. **Tidak pernah ada kotak kosong.** Kalau cover tidak ada (video privat, dihapus, atau offline sebelum pernah di-cache), tampilkan **placeholder generatif** yang deterministik dari `video_id`: gradien dua warna turunan `--accent` + inisial judul. Ini bukan sekadar pencegahan error, ini bagian dari arah visual "editorial".
4. **Thumbnail YouTube bukan cover art sejati.** YouTube cuma punya thumbnail 16:9 (rasio video), bukan kotak 1:1 album. Kaset harus **crop tengah jadi 1:1** saat menampilkan, dan menyimpan versi asli 16:9 di cache supaya bisa di-crop ulang tanpa unduh lagi.

## 2. Tangga Kualitas

YouTube menyediakan beberapa resolusi. Kita turun tangga sampai dapat yang pertama berhasil:

| Urutan | Nama | Ukuran | Catatan |
|--------|------|--------|---------|
| 1 | `maxresdefault` | 1280×720 | Sering 404 untuk lagu lama/regional |
| 2 | `sddefault` | 640×480 | — |
| 3 | `hqdefault` | 480×360 | Hampir selalu ada, ini fallback andalan |
| 4 | `mqdefault` | 320×180 | Terakhir, kualitas rendah tapi pasti ada |

Pola URL: `https://i.ytimg.com/vi/{video_id}/{name}.jpg`. Respons `404` + body kecil = lanjut ke tangga berikutnya, jangan anggap sukses.

## 3. Skema Database (tambahan)

Tambahkan di migrasi baru (`0002_covers.sql`), **jangan edit `0001_init.sql`**:

```sql
CREATE TABLE covers (
  key         TEXT PRIMARY KEY,   -- 'v:' + video_id  ATAU  'a:' + album/playlist_id
  kind        TEXT NOT NULL,      -- 'track' | 'collection'
  path        TEXT,               -- path relatif di app-data/covers/, NULL kalau gagal
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  status      TEXT NOT NULL,      -- 'ok' | 'missing' | 'error'
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_try_at INTEGER,
  fetched_at  INTEGER
);

CREATE INDEX idx_covers_status ON covers(status);
```

File disimpan di `<app_data_dir>/covers/<key>.jpg` (pakai `tauri::Manager::app_data_dir`, bukan folder repo). Kunci:
- `v:<video_id>` untuk lagu.
- `a:<collection_id>` untuk album/playlist (ID `MPRE...`/`OLAK...`), supaya satu cover dipakai seluruh lagu dalam album.

## 4. Alur Ambil Cover

1. UI butuh cover untuk `track`. Panggil command `cover_get({ key })`.
2. Rust: cek `covers` — kalau `status='ok'` dan file masih ada di disk → kembalikan **path lokal** (bukan URL). UI render dari `asset://` lokal.
3. Kalau belum ada: kembalikan **placeholder deterministik** segera (UI tidak boleh nunggu), dan jalankan job unduh di background.
4. Job unduh: turun tangga kualitas, tulis ke disk, update `covers`. Kalau sukses, emit event `cover://ready` ke UI supaya cover asli menggantikan placeholder tanpa reload.

**Anti-pattern yang dilarang:** menaruh `thumb_url` langsung ke `<img>` di JSX dan berharap browser yang nge-cache. Itu bukan offline-first, dan bocorin IP ke Google tiap render.

## 5. Eviction dan Batas

- Batas default: **250 MB** atau **3000 file**, mana yang tercapai dulu.
- Eviction: LRU berdasarkan `fetched_at`, tapi **cover lagu yang ada di playlist/favorit dipertahankan lebih lama** (skor: `fetched_at` + bonus kalau masih direferensikan).
- Jangan pernah menghapus cover lagu yang sedang diputar atau ada di queue aktif.
- Background prefetch: saat queue berjalan, unduh cover untuk 3 lagu berikutnya, dengan antrean seri (bukan paralel) supaya tidak kena rate-limit YouTube.

## 6. Kegagalan dan Offline

- **Offline + belum pernah di-cache:** tampilkan placeholder generatif, catat `status='missing'`, coba lagi nanti. Jangan tulis toast error — cover bukan hal krusial.
- **404 di semua tangga:** `status='error'`, `attempts++`. Coba ulang paling banyak 3×, jeda bertambah (1 jam, lalu 24 jam). Setelah itu menyerah.
- **Respons bukan gambar** (mis. halaman HTML challenge dari YouTube): tolak, jangan simpan. Ini penting untuk mencegah cache penuh file sampah.
- Validasi tipe: cek magic bytes JPEG/PNG sebelum menulis. Batas ukuran maksimal 5 MB per file.

## 7. Placeholder Generatif

Deterministik dari hash `video_id` supaya lagu yang sama selalu dapat warna yang sama (dari palet aksen, bukan acak murni):

```
hash = fnv1a(video_id)
hue_a = 180 + (hash % 60)      // area biru-lavender
hue_b = (hue_a + 40) % 360
```

Render sebagai dua gradien diagonal + inisial judul lagu di tengah (font `--font-display`). Ini yang bikin library tetap kelihatan rapi walau offline penuh.
