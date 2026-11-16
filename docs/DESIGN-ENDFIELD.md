# DESIGN-ENDFIELD — Arah Visual Kaset

> Menggantikan bagian **Arah Visual** dan **Design Tokens** di `DESIGN.md`.
> Struktur layar, komponen, shortcut, dan aksesibilitas di `DESIGN.md` **tetap berlaku**.
> Terinspirasi dari estetika UI *Arknights: Endfield* (industrial-taktis, HUD, tipografi teknis). **Terinspirasi saja, bukan menyalin.**

## 0. Batasan Hukum dan Etika (WAJIB)

Boleh: gaya, bahasa bentuk, komposisi, pola layout, kesan "terminal industri".
**Dilarang:** logo, nama, karakter, ilustrasi, ikon, font berlisensi, tangkapan layar, atau aset apa pun milik game tersebut; menyebut Kaset sebagai produk resmi/terafiliasi.
Semua ikon, ornamen, dan tekstur dibuat sendiri atau memakai aset berlisensi terbuka. Nama aplikasi tetap **Kaset**. Tambahkan satu baris di README: "Gaya visual terinspirasi estetika sci-fi industrial; tidak berafiliasi dengan pihak mana pun."

## 1. Karakter Visual

**Kata kunci:** industrial · taktis · bersih · presisi · terminal · sistem.

- Kesan: panel kontrol di fasilitas industri futuristik, bukan "gaming neon".
- **Hitam, putih/abu kertas, dan satu aksen kuning.** Hemat warna, kontras tajam.
- **Garis tipis 1px**, grid halus, penanda sudut (corner brackets), tick marks, label teknis kecil.
- **Sudut dipotong (chamfer), bukan membulat.** Tidak ada radius besar.
- Informasi disusun seperti **data**: indeks nomor, label mono kecil, angka besar.
- Ruang kosong disengaja; dekorasi hanya di tepi dan kepala panel, bukan di atas konten.

## 2. Tema

Sediakan dua tema dengan token yang sama:

- **`light` (default, "Terminal Kertas")**: latar abu-putih hangat, teks hitam, aksen kuning.
- **`dark` ("Terminal Malam")**: latar hampir hitam, teks putih tulang, aksen kuning.

## 3. Design Tokens

```css
:root,
:root[data-theme="light"] {
  /* Permukaan */
  --bg:           #E8E8E2;   /* latar utama, abu kertas */
  --panel:        #F4F4EF;   /* panel/kartu */
  --panel-2:      #DADAD3;   /* panel sekunder / hover */
  --ink:          #111111;   /* teks utama */
  --ink-muted:    #55554F;   /* teks sekunder */
  --line:         rgba(17, 17, 17, 0.14);   /* garis halus */
  --line-strong:  #111111;                   /* garis tegas */

  /* Aksen */
  --accent:       #FFE600;   /* kuning peringatan */
  --accent-ink:   #111111;   /* teks DI ATAS kuning (selalu hitam) */
  --danger:       #E5372E;
  --ok:           #2F8F4E;

  /* Grid dekoratif */
  --grid:         rgba(17, 17, 17, 0.05);
}

:root[data-theme="dark"] {
  --bg:           #0F1011;
  --panel:        #171819;
  --panel-2:      #212325;
  --ink:          #EEEEE8;
  --ink-muted:    #9A9A94;
  --line:         rgba(238, 238, 232, 0.14);
  --line-strong:  #EEEEE8;
  --accent:       #FFE600;
  --accent-ink:   #111111;
  --danger:       #FF5C52;
  --ok:           #4CC27A;
  --grid:         rgba(238, 238, 232, 0.05);
}

:root {
  /* Tipografi — gunakan font open-source, self-host */
  --font-display: "Barlow Condensed", "Oswald", system-ui, sans-serif;
  --font-body:    "IBM Plex Sans", "Inter", system-ui, sans-serif;
  --font-mono:    "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace;

  /* Spacing (kelipatan 4) */
  --s-1: 4px;  --s-2: 8px;  --s-3: 12px; --s-4: 16px;
  --s-6: 24px; --s-8: 32px; --s-12: 48px;

  /* Chamfer (pemotong sudut) */
  --cut-sm: 6px;
  --cut-md: 12px;
  --cut-lg: 20px;

  /* Gerak */
  --t-fast: 120ms;
  --t-base: 180ms;
  --ease:   cubic-bezier(0.2, 0, 0, 1);   /* tegas, tanpa memantul */
}
```

**Aturan kontras (penting):**
- Kuning **hanya** sebagai latar (dengan teks hitam) atau garis/ikon kecil di atas latar gelap.
- **Jangan** memakai teks kuning di atas latar terang (kontras gagal).
- Teks muted harus tetap lolos WCAG AA terhadap `--bg` dan `--panel`.

## 4. Tipografi

| Peran | Font | Gaya |
|-------|------|------|
| Judul layar, angka besar | `--font-display` | HURUF BESAR, bobot 600–700, letter-spacing 0.02em |
| Teks isi, judul lagu | `--font-body` | normal, 400/500 |
| Label teknis, indeks, durasi, metadata | `--font-mono` | 11–12px, HURUF BESAR, letter-spacing 0.08em |

Contoh label: `01 / SEARCH`, `QUEUE · 12 ITEMS`, `SYS//PLAYBACK`, `00:42 / 03:15`.
Font di-**self-host** (jangan CDN), cek lisensi (Barlow, Oswald, IBM Plex umumnya OFL).

## 5. Bahasa Bentuk (Recipes CSS)

### 5.1 Panel chamfer

```css
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  clip-path: polygon(
    var(--cut-md) 0, 100% 0,
    100% calc(100% - var(--cut-md)),
    calc(100% - var(--cut-md)) 100%,
    0 100%, 0 var(--cut-md)
  );
}
```

> `clip-path` memotong `border` di sudut. Untuk garis tegas di sudut potong, gambar garis diagonal kecil dengan pseudo-element atau SVG, atau tambahkan lapisan di belakang.

### 5.2 Corner brackets

```css
.bracketed { position: relative; }
.bracketed::before,
.bracketed::after {
  content: "";
  position: absolute;
  width: 10px; height: 10px;
  border: 1.5px solid var(--line-strong);
  pointer-events: none;
}
.bracketed::before { top: 0; left: 0;  border-right: 0; border-bottom: 0; }
.bracketed::after  { right: 0; bottom: 0; border-left: 0;  border-top: 0; }
```

### 5.3 Latar grid halus

```css
body {
  background-color: var(--bg);
  background-image:
    linear-gradient(var(--grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid) 1px, transparent 1px);
  background-size: 24px 24px;
}
```

### 5.4 Strip peringatan (pakai hemat, hanya aksen kecil)

```css
.hazard {
  height: 6px;
  background: repeating-linear-gradient(
    -45deg, var(--accent) 0 8px, var(--ink) 8px 16px
  );
}
```

### 5.5 Kepala panel bergaya sistem

```
┌─ 02 / QUEUE ─────────────────────── 12 ITEMS ─┐
```
Indeks angka + garis + metadata kanan, semuanya `--font-mono`.

## 6. Pemetaan Komponen

| Komponen (`DESIGN.md`) | Gaya Endfield |
|------------------------|---------------|
| **Sidebar** | Kolom sempit, item bernomor (`01 SEARCH`, `02 LIBRARY`, `03 STATS`); item aktif = blok kuning dengan teks hitam |
| **PlayerBar** ("control deck") | Panel chamfer di bawah, cover persegi dengan corner brackets, judul `--font-body`, metadata `--font-mono` |
| **ProgressSlider** | Bar **bersegmen** dengan tick marks tiap 10%, kepala berupa blok kuning kecil, waktu mono di kedua ujung |
| **TrackRow** | Nomor indeks mono di kiri, garis pemisah 1px, hover = latar `--panel-2` + garis kuning 3px di tepi kiri |
| **Item aktif** | Garis kuning tepi kiri + equalizer **bar-segmen** (balok kotak, bukan gelombang halus) |
| **QueueList** | Mirip daftar log: indeks `01 02 03…`, pemisah "NOW PLAYING" / "NEXT", drag handle berupa 6 titik kotak |
| **Tombol utama** | Blok kuning chamfer, teks hitam HURUF BESAR; sekunder = outline 1px hitam |
| **CoverArt** | Persegi 1:1, corner brackets kecil, placeholder berupa pola grid + inisial mono |
| **Toast** | Strip di tepi atas, ikon status kotak, teks mono; error = garis merah |
| **EmptyState** | Pesan gaya sistem: `NO DATA / STANDBY`, plus satu aksi |
| **Mini-player & bottom nav (Android)** | Panel chamfer tipis, item aktif = blok kuning |

## 7. Layar Khusus

### 7.1 Stats sebagai telemetri

Layar **Stats** (dari `FEATURES-V2.md`) tampil seperti dasbor telemetri:

- Angka besar `--font-display` (mis. `128.4 H` untuk total jam), label mono kecil di atasnya.
- Heatmap jam dengar = grid kotak 24 kolom, intensitas lewat opasitas kuning.
- Top lagu = tabel bernomor dengan bar horizontal bersegmen.
- Streak = deretan kotak kecil per hari (terisi = kuning).
- Semua bisa difilter rentang: `7D · 30D · 365D · ALL`.

### 7.2 Import sebagai proses sistem

Layar import tampil seperti job log: `PARSING… 142 / 300`, baris status berwarna (`OK`, `REVIEW`, `NOT FOUND`), progres bersegmen, tombol `ABORT`.

### 7.3 Smart shuffle

Toggle diberi label `SHUFFLE / SMART` dengan indikator kuning saat aktif. Item sisipan rekomendasi (Tingkat B) memakai tag `[SARAN]` bergaya label mono.

## 8. Gerak

- Cepat dan tegas: **120–180 ms**, `--ease`, **tanpa bounce/spring**.
- Transisi layar: panel muncul dengan **wipe/slide pendek**, teks label muncul bertahap (stepped).
- Loading: **garis scan** tipis atau bar bersegmen yang terisi, bukan spinner bulat.
- Pergantian lagu: cover cross-fade cepat + label `NOW PLAYING` berkedip sekali.
- **Wajib** menghormati `prefers-reduced-motion`: matikan wipe dan kedipan.

## 9. Performa (Terutama Android WebView)

- Andalkan **CSS dan SVG kecil**. Tanpa shader, canvas berat, atau video latar.
- Batasi `clip-path` pada elemen besar yang sering di-repaint; pakai di kartu/tombol/panel statis.
- Latar grid dibuat dengan `background-image` CSS (murah), bukan gambar besar.
- Uji di perangkat Android kelas menengah; kalau jank, sederhanakan chamfer jadi sudut siku + garis diagonal dekoratif.

## 10. Aksesibilitas

- Dekorasi (brackets, grid, label sistem) bersifat **dekoratif**: `aria-hidden="true"`.
- Info penting **jangan hanya lewat warna** (kuning vs abu); sertakan ikon/label/teks.
- Fokus keyboard: outline 2px `--line-strong` + offset, jelas terlihat di kedua tema.
- Area sentuh minimal 44×44px meskipun tombolnya tampak "tipis".
- Label mono kecil (11px) hanya untuk metadata; teks yang harus dibaca pakai minimal 14px.

## 11. Aset yang Perlu Dibuat Sendiri

- Set ikon garis 1.5px bersudut tegas (play, pause, next, prev, shuffle, repeat, queue, library, stats, settings, search)
- Ikon aplikasi: bentuk geometris sederhana (mis. kaset/segitiga play dalam bingkai chamfer), kuning + hitam
- Tray icon monokrom
- Pola placeholder cover (grid + inisial)
- Ornamen: bracket, tick, strip hazard (SVG kecil)

## 12. Urutan Penerapan

1. Ganti token di `src/styles/tokens.css` dan tambahkan toggle tema.
2. Terapkan ke komponen dasar: `Panel`, `Button`, `TrackRow`, `CoverArt`.
3. Bangun ulang `PlayerBar` dan `ProgressSlider` bersegmen.
4. Rapikan `Sidebar`/`BottomNav`, lalu layar Search, Queue, Library.
5. Terakhir: layar Stats dan Import (setelah fiturnya ada).

> Kerjakan lewat mode UI-di-browser (`npm run dev` dengan mock) supaya iterasi desain tidak menunggu kompilasi Rust.
