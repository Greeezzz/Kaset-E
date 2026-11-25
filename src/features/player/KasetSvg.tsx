import { useMemo } from "react";

import type { Track } from "../../types";
import { useCover } from "../../hooks/useCover";
import { formatDuration } from "../../lib/format";
import { labelKaset, pangkas, polaStrip } from "./kasetLabel";

/**
 * Gambar kaset (SVG) — K2 `FEATURES-V3.md`.
 *
 * Semua bentuk digambar sendiri dengan path/rect; tidak ada raster, tidak ada
 * aset pihak lain. Yang diambil hanya prinsip umum anatomi kaset (cangkang,
 * sekrup di empat sudut, panel label, jendela reel, jendela pita, bagian bawah
 * trapesium) — sesuai batasan §1 dokumen itu.
 *
 * Kenapa SVG dan bukan div bertumpuk: skala tetap tajam di semua ukuran, dan
 * seluruh dekorasi bisa diberi `aria-hidden` sebagai satu kesatuan sehingga
 * pembaca layar tidak perlu menelusuri puluhan elemen hiasan.
 *
 * Warna diambil dari token (`var(--ink)`, `var(--accent)`, …), jadi kedua tema
 * (Kertas/Malam) ikut otomatis tanpa cabang kode.
 */

const LEBAR = 420;
const TINGGI = 268;

export function KasetSvg({
  track,
  ukuran = 1,
}: {
  track: Track | null;
  /** Pengali ukuran; 1 = 420x268. */
  ukuran?: number;
}) {
  const label = useMemo(() => labelKaset(track?.videoId ?? "kaset"), [track?.videoId]);
  const strip = polaStrip(label.pola);

  const judul = pangkas(track?.title ?? "Tidak ada lagu", 26);
  const artis = pangkas(track?.artist ?? "—", 30);
  const durasi = track?.durationMs ? formatDuration(track.durationMs) : "--:--";

  return (
    <svg
      role="img"
      aria-label={`Kaset: ${track?.title ?? "tidak ada lagu"} — ${track?.artist ?? ""}`}
      viewBox={`0 0 ${LEBAR} ${TINGGI}`}
      width={LEBAR * ukuran}
      height={TINGGI * ukuran}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      {/* Bentuk dekoratif: disembunyikan dari pembaca layar sebagai satu grup,
          supaya mereka tidak menelusuri puluhan rect/line. TEKS label sengaja
          diletakkan di grup terpisah di bawah, karena itu informasi nyata. */}
      <g aria-hidden="true">
        {/* Cangkang */}
        <rect
          x="1"
          y="1"
          width={LEBAR - 2}
          height={TINGGI - 2}
          fill="var(--ink)"
          stroke="var(--line-strong)"
          strokeWidth="2"
        />
        {/* Bevel dalam: garis tipis yang membuat cangkang terlihat punya tebal */}
        <rect
          x="9"
          y="9"
          width={LEBAR - 18}
          height={TINGGI - 18}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.28"
          strokeWidth="1"
        />

        {/* Sekrup empat sudut */}
        {[
          [18, 18],
          [LEBAR - 18, 18],
          [18, TINGGI - 18],
          [LEBAR - 18, TINGGI - 18],
        ].map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="5.5" fill="var(--panel-2)" stroke="var(--line)" />
            <line
              x1={cx - 3}
              y1={cy}
              x2={cx + 3}
              y2={cy}
              stroke="var(--ink-muted)"
              strokeWidth="1.2"
            />
          </g>
        ))}

        {/* Panel label: kertas, sedikit miring supaya tidak terlihat cetakan */}
        <g transform={`rotate(${label.kemiringan} 210 78)`}>
          <rect x="40" y="26" width="340" height="104" fill="var(--panel)" stroke="var(--line)" />

          {/* Strip warna: pola berbeda per lagu */}
          <StripWarna x={40} y={label.stripDiAtas ? 26 : 112} lebar={340} pola={strip} />
        </g>

        {/* Teks label: bagian yang benar-benar dibaca. Teks asli, bukan path,
            sehingga tetap bisa diseleksi dan dibacakan. */}
        <g transform={`rotate(${label.kemiringan} 210 78)`}>
          <text
            x="52"
            y={label.stripDiAtas ? 74 : 62}
            fill="var(--ink)"
            fontFamily="var(--font-display)"
            fontSize="26"
            fontWeight="700"
            letterSpacing="0.5"
          >
            {judul}
          </text>
          <text
            x="52"
            y={label.stripDiAtas ? 96 : 84}
            fill="var(--ink-muted)"
            fontFamily="var(--font-mono)"
            fontSize="11"
            letterSpacing="1.2"
          >
            {artis.toUpperCase()}
          </text>

          {/* Metadata kanan: sisi + kode pita + seri */}
          <text
            x="368"
            y={label.stripDiAtas ? 48 : 36}
            textAnchor="end"
            fill="var(--ink)"
            fontFamily="var(--font-mono)"
            fontSize="11"
            fontWeight="700"
            letterSpacing="1.5"
          >
            SIDE {label.sisi}
          </text>
          <text
            x="368"
            y={label.stripDiAtas ? 62 : 50}
            textAnchor="end"
            fill="var(--ink-muted)"
            fontFamily="var(--font-mono)"
            fontSize="9"
            letterSpacing="1.2"
          >
            {label.kode} · {label.seri}
          </text>
          <text
            x="368"
            y={label.stripDiAtas ? 120 : 108}
            textAnchor="end"
            fill="var(--ink-muted)"
            fontFamily="var(--font-mono)"
            fontSize="9"
            letterSpacing="1.2"
          >
            {durasi}
          </text>
        </g>

        {/* Jendela reel: cekungan gelap dengan dua hub bergigi */}
        <rect x="96" y="146" width="228" height="76" fill="var(--bg)" stroke="var(--line)" />
        <Hub cx={136} cy={184} />
        <Hub cx={284} cy={184} />
        {/* Jendela pita di antara hub */}
        <rect x="158" y="176" width="104" height="16" fill="var(--panel-2)" stroke="var(--line)" />

        {/* Bagian bawah trapesium + lubang sekrup tengah */}
        <path
          d={`M 60 ${TINGGI - 20} L 96 ${TINGGI - 48} L ${LEBAR - 96} ${TINGGI - 48} L ${
            LEBAR - 60
          } ${TINGGI - 20} Z`}
          fill="var(--panel-2)"
          stroke="var(--line)"
        />
        <circle cx={LEBAR / 2} cy={TINGGI - 34} r="4" fill="var(--bg)" stroke="var(--line)" />
      </g>
    </svg>
  );
}

/** Hub reel bergigi. `aria-hidden` diwarisi dari grup induk. */
function Hub({ cx, cy }: { cx: number; cy: number }) {
  const gigi = Array.from({ length: 6 }, (_, i) => {
    const sudut = (i * Math.PI) / 3;
    return {
      x1: cx + Math.cos(sudut) * 13,
      y1: cy + Math.sin(sudut) * 13,
      x2: cx + Math.cos(sudut) * 21,
      y2: cy + Math.sin(sudut) * 21,
    };
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r="24" fill="var(--ink)" stroke="var(--line)" />
      {gigi.map((g, i) => (
        <line
          key={i}
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          stroke="var(--ink-muted)"
          strokeWidth="3"
        />
      ))}
      <circle cx={cx} cy={cy} r="7" fill="var(--bg)" stroke="var(--line)" />
    </g>
  );
}

/** Strip warna dengan pola berbeda per lagu. */
function StripWarna({
  x,
  y,
  lebar,
  pola,
}: {
  x: number;
  y: number;
  lebar: number;
  pola: number[];
}) {
  const tinggi = 8;
  let kursor = x;
  return (
    <g>
      {pola.map((p, i) => {
        const w = lebar * p;
        const el = (
          <rect
            key={i}
            x={kursor}
            y={y}
            width={w}
            height={tinggi}
            fill={i % 2 === 0 ? "var(--accent)" : "var(--ink)"}
          />
        );
        kursor += w;
        return el;
      })}
    </g>
  );
}

/**
 * Label generatif dengan cover lagu mini (opsi `kaset.label = cover`).
 *
 * Cover tetap lewat `useCover` → Rust → cache disk, BUKAN `<img src=ytimg>`
 * (aturan `THUMBNAILS.md`). Kalau cover belum siap, kaset tetap tampil dengan
 * label generatif — tidak ada kotak kosong.
 */
export function KasetSvgBercover({ track, ukuran = 1 }: { track: Track | null; ukuran?: number }) {
  const url = useCover(track?.coverKey);
  if (!url) return <KasetSvg track={track} ukuran={ukuran} />;

  // Cover ditempel di jendela reel sebagai "foto di label", bukan menggantikan
  // seluruh kaset: cangkang dan label tetap khas Kaset.
  return (
    <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
      <KasetSvg track={track} ukuran={ukuran} />
      <img
        src={url}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "23.5%",
          top: "55.5%",
          width: "21%",
          aspectRatio: "1",
          objectFit: "cover",
          border: "1px solid var(--line-strong)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
