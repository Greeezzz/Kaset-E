# DESIGN — Kaset

> Dokumen ini adalah **arah awal**. Token warna, font, dan gaya visual boleh diganti total sesuai selera pemilik proyek. Yang paling penting dijaga adalah struktur layar dan perilaku komponen.

## 1. Arah Visual (usulan)

- **Mood:** gelap, bersih, fokus ke sampul album dan tipografi. Editorial, bukan "dashboard".
- **Prinsip:** konten dulu (cover art + judul), kontrol seperlunya, ruang kosong yang disengaja.
- **Aksen:** satu warna aksen saja untuk status aktif (lagu yang sedang diputar, tombol utama).

## 2. Design Tokens

```css
:root {
  /* Warna */
  --bg:            #0B0B0D;
  --surface:       #141417;
  --surface-2:     #1C1C21;
  --border:        #2A2A31;
  --text:          #F2F2F4;
  --text-muted:    #9A9AA5;
  --accent:        #C6F24E;  /* ganti sesuai identitas kamu */
  --accent-ink:    #0B0B0D;  /* teks di atas aksen */
  --danger:        #FF5C5C;

  /* Tipografi */
  --font-display:  "Space Grotesk", system-ui, sans-serif;
  --font-body:     "Inter", system-ui, sans-serif;
  --font-mono:     "JetBrains Mono", ui-monospace, monospace;

  /* Spacing (kelipatan 4) */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px;  --s-4: 16px;
  --s-6: 24px; --s-8: 32px; --s-12: 48px;

  /* Radius */
  --r-sm: 6px; --r-md: 12px; --r-lg: 20px; --r-full: 999px;
}
```

Sediakan mode terang sebagai opsi nanti (backlog). Mulai dari gelap saja.

## 3. Layout per Platform

### Desktop (≥ 900px)

```
┌───────────┬────────────────────────────────────────┬──────────────┐
│ Sidebar   │  Konten utama                          │ Queue panel  │
│  Search   │  (hasil cari / playlist / library)     │ (bisa tutup) │
│  Library  │                                        │              │
│  Playlist │                                        │              │
│  Settings │                                        │              │
├───────────┴────────────────────────────────────────┴──────────────┤
│ Player bar:  [cover] judul/artis   ⏮ ⏯ ⏭   ─────●────   🔀 🔁 🔊  │
└───────────────────────────────────────────────────────────────────┘
```

### Android (< 900px)

```
┌─────────────────────────┐
│ Konten (scroll)         │
│                         │
│                         │
├─────────────────────────┤
│ Mini player (tap = buka)│
├─────────────────────────┤
│ Home  Search  Library   │  ← bottom nav
└─────────────────────────┘
```

Tap mini player membuka **Full Player** (layar penuh, slide-up).

## 4. Daftar Layar

1. **Search** — input di atas, saran saat mengetik, hasil dikelompokkan (Lagu / Album / Artis / Playlist). Layar awal sebelum mengetik: history pencarian singkat.
2. **Now Playing (Full Player)** — cover besar, judul/artis, progress bar bisa di-seek, kontrol utama, tombol shuffle/repeat, tombol favorit, tombol buka queue.
3. **Queue** — daftar lagu, item aktif disorot, drag handle untuk reorder, geser/tombol untuk hapus, tombol "Kosongkan". Pemisah antara "Sedang diputar", "Berikutnya".
4. **Library** — tab: Playlist, Favorit, History.
5. **Playlist Detail** — header (nama, jumlah lagu), tombol Putar dan Acak, daftar lagu.
6. **Settings** — tema, kualitas audio, export/import library, tentang + disclaimer.

## 5. Komponen Inti

| Komponen | Catatan |
|----------|---------|
| `TrackRow` | Cover kecil, judul, artis, durasi, menu `⋯` (Putar berikutnya, Tambah ke queue, Tambah ke playlist, Favorit) |
| `PlayerBar` / `MiniPlayer` | Judul berjalan jika kepanjangan, progress tipis di tepi atas |
| `ProgressSlider` | Area sentuh besar, tampilkan waktu saat drag |
| `QueueList` | Dukung drag-and-drop dan gestur geser |
| `CoverArt` | Placeholder saat loading, sudut membulat konsisten |
| `EmptyState` | Pesan singkat + satu aksi jelas |
| `Toast` | Untuk error ringan ("Gagal memuat lagu, lompat ke berikutnya") |

## 6. Interaksi dan Status

- **Loading lagu:** spinner kecil di tombol play, jangan blokir UI.
- **Error resolve:** toast singkat, retry otomatis sekali, lalu skip.
- **Tidak ada koneksi:** Library tetap bisa dibuka; pencarian menampilkan pesan "Offline".
- **Item aktif di list mana pun** harus diberi penanda visual yang sama (warna aksen + ikon equalizer kecil).
- **Haptic** ringan di Android untuk tombol utama (opsional).

## 7. Aksesibilitas

- Kontras teks minimal WCAG AA terhadap latar.
- Semua tombol ikon punya label aksesibel (`aria-label`).
- Area sentuh minimal 44×44px.
- Navigasi keyboard penuh di desktop (spasi = play/pause, panah = seek/volume).

## 8. Shortcut Desktop

| Tombol | Aksi |
|--------|------|
| Space | Play / pause |
| ← / → | Seek -5s / +5s |
| Ctrl + ← / → | Previous / Next |
| ↑ / ↓ | Volume |
| Ctrl + K | Fokus ke pencarian |
| Ctrl + Q | Buka/tutup panel queue |

## 9. Aset yang Perlu Disiapkan

- Ikon aplikasi (1024×1024, versi adaptive untuk Android)
- Tray icon (monokrom)
- Splash sederhana
- Font (self-host, jangan andalkan CDN supaya jalan offline)
