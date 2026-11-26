/**
 * Set ikon garis 1.5px (DESIGN-LAYOUT §10 langkah 8, DESIGN-ENDFIELD §6).
 *
 * Kenapa SVG dan bukan glyph teks: glyph teks (`▶ ❙❙ ✕`) punya tiga masalah
 * nyata —
 *
 *  1. Bentuknya ditentukan font, jadi beda mesin bisa beda ukuran dan berat.
 *  2. `▶` (U+25B6) sangat kecil dibanding `❙❙` (U+2759), sehingga tombol
 *     play dan pause terasa berubah ukuran saat lagu dijeda.
 *  3. Emoji volume (🔊) dirender sebagai gambar berwarna oleh sistem, jadi
 *     tidak bisa diwarnai dengan `currentColor` dan tidak ikut tema gelap.
 *
 * Semua ikon di sini memakai kotak 24×24, `stroke-width: 1.5`, `currentColor`,
 * dan `stroke-linecap: round` — supaya warna mengikuti teks di sekitarnya dan
 * tidak perlu `setState` hanya untuk mengubah ikon.
 */

interface IkonProps {
  /** Ukuran sisi dalam piksel. Bawaan 18. */
  size?: number;
  /** Geser optik untuk ikon yang secara visual terasa tidak seimbang. */
  style?: React.CSSProperties;
  className?: string;
}

/** Kerangka bersama: viewBox 24, garis 1.5, warna dari teks sekitarnya. */
function Svg({ size = 18, style, className, children }: IkonProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      {children}
    </svg>
  );
}

/**
 * Play: segitiga berisi (bukan garis).
 *
 * Satu-satunya ikon yang boleh solid — ia duduk di blok kuning dan harus
 * terbaca sebagai "tekan ini", bukan sebagai garis tipis yang tenggelam.
 */
export function IkonPlay({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Pause: dua batang tegak, lebar dan jarak sama dengan play. */
export function IkonPause({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M9 5v14M15 5v14" strokeWidth={2} />
    </Svg>
  );
}

/** Sebelumnya: batang + segitiga kiri. */
export function IkonPrev({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M18 6v12L9 12z" fill="currentColor" stroke="none" />
      <path d="M6 5.5v13" strokeWidth={1.8} />
    </Svg>
  );
}

/** Berikutnya: segitiga kanan + batang. */
export function IkonNext({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M6 6v12l9-6z" fill="currentColor" stroke="none" />
      <path d="M18 5.5v13" strokeWidth={1.8} />
    </Svg>
  );
}

/** Tutup: silang dua garis. */
export function IkonTutup({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

/** Hati garis. `isi` = true untuk favorit aktif. */
export function IkonHati({ size = 18, isi = false, ...rest }: IkonProps & { isi?: boolean }) {
  return (
    <Svg size={size} {...rest}>
      <path
        d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5C19 15.5 12 20 12 20z"
        fill={isi ? "currentColor" : "none"}
      />
    </Svg>
  );
}

/** Menu: tiga titik horizontal. */
export function IkonMenu({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/**
 * Volume: pengeras suara + gelombang yang jumlahnya mengikuti tingkat.
 *
 * Tiga tingkat (0 / rendah / tinggi) dengan bentuk yang sama supaya tombol
 * tidak terasa melompat saat volumenya diubah. Bisu memakai silang.
 */
export function IkonVolume({ size = 18, level = 2, ...rest }: IkonProps & { level?: 0 | 1 | 2 }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z" />
      {level > 0 && <path d="M15.5 9a4 4 0 0 1 0 6" />}
      {level > 1 && <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />}
      {level === 0 && <path d="M16 9.5l4 5M20 9.5l-4 5" />}
    </Svg>
  );
}

/** Riwayat: panah melingkar ke kiri. */
export function IkonRiwayat({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 10a8 8 0 1 1 1.2 6.2" />
      <path d="M4 5.5V10h4.5" />
    </Svg>
  );
}

/** Pencarian: kaca pembesar. */
export function IkonCari({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5" />
    </Svg>
  );
}

/** Pengaturan: roda gigi sederhana (lingkaran + delapan gigi). */
export function IkonPengaturan({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </Svg>
  );
}

/** Tambah: silang dua garis dengan panjang sama. */
export function IkonTambah({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  );
}

/** Acak: dua panah bersilang. */
export function IkonAcak({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 7h3.5l9 10H20" />
      <path d="M4 17h3.5l9-10H20" />
      <path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5" />
    </Svg>
  );
}

/** Statistik: batang naik. */
export function IkonStatistik({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V8M17 20v-9" />
    </Svg>
  );
}

/** Shuffle pintar: batang acak bertanda bintang. */
export function IkonAcakPintar({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 7h3.5l9 10H20" />
      <path d="M4 17h3.5l9-10H20" />
      <path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5" />
      <circle cx="12" cy="12" r="1.4" />
    </Svg>
  );
}

/** Ulangi: dua panah melingkar. `satu` menampilkan angka 1 di tengah. */
export function IkonRepeat({ size = 18, satu = false, ...rest }: IkonProps & { satu?: boolean }) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 12a5 5 0 0 1 5-5h9" />
      <path d="M15.5 4.5L18 7l-2.5 2.5" />
      <path d="M20 12a5 5 0 0 1-5 5H6" />
      <path d="M8.5 19.5L6 17l2.5-2.5" />
      {satu && (
        <text
          x="12"
          y="13.5"
          textAnchor="middle"
          fontSize="7"
          fontFamily="var(--font-mono)"
          fill="currentColor"
          stroke="none"
        >
          1
        </text>
      )}
    </Svg>
  );
}

/** Fullscreen: empat sudut mengembang ke luar. */
export function IkonFullscreen({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M15 3h6v6M9 21H3v-6M21 9V3m0 0l-7 7M3 15v6m0 0l7-7" />
    </Svg>
  );
}

/** Tutup Fullscreen: empat sudut menciut ke dalam. */
export function IkonFullscreenExit({ size = 18, ...rest }: IkonProps) {
  return (
    <Svg size={size} {...rest}>
      <path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7" />
    </Svg>
  );
}

/** Ikon Kaset: tape shell retro */
export function IkonKaset({ size = 18, style, className }: IkonProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      <rect x="2" y="5" width="20" height="14" />
      <circle cx="8" cy="11" r="2" />
      <circle cx="16" cy="11" r="2" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <path d="M6 19L8 15H16L18 19" />
    </svg>
  );
}

/** Ikon Lirik: mikrofon industrial */
export function IkonLirikMic({ size = 18, style, className }: IkonProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      <rect x="9" y="2" width="6" height="11" />
      <path d="M5 10V11C5 14.866 8.134 18 12 18C15.866 18 19 14.866 19 11V10" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

/** Ikon Antrean: lapisan / layers */
export function IkonQueueLayers({ size = 18, style, className }: IkonProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      <polygon points="12 3 2 8 12 13 22 8 12 3" />
      <polyline points="2 13 12 18 22 13" />
      <polyline points="2 18 12 23 22 18" />
    </svg>
  );
}

/** Ikon Besarkan: expand diagonal */
export function IkonExpandDiagonal({ size = 18, style, className }: IkonProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}
