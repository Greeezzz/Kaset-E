import { fnv1a, initials } from "../lib/format";

interface Props {
  /** Kunci cover; null = belum ada data sama sekali. */
  coverKey: string | null;
  title: string;
  /** Path file lokal dari Rust (hasil command cover_get). Null = belum ter-cache. */
  localPath?: string | null;
  size?: number;
  radius?: number;
}

/**
 * Cover art. YouTube hanya punya thumbnail 16:9, jadi selalu di-crop tengah 1:1
 * (object-fit: cover) — lihat docs/THUMBNAILS.md.
 *
 * Aturan penting: kalau cover belum ada di cache, JANGAN render <img> ke
 * i.ytimg.com. Tampilkan placeholder generatif deterministik supaya: (a) offline
 * tetap rapi, (b) tidak ada IP user yang bocor ke Google tiap render.
 */
export function CoverArt({ coverKey, title, localPath, size = 48, radius = 6 }: Props) {
  const style = {
    width: size,
    height: size,
    borderRadius: radius,
    flex: `0 0 ${size}px`,
  } as const;

  if (localPath) {
    return (
      <img
        src={localPath}
        alt=""
        aria-hidden="true"
        style={{ ...style, objectFit: "cover", background: "var(--surface-2)" }}
      />
    );
  }

  // Placeholder deterministik: lagu yang sama selalu dapat warna yang sama.
  const h = fnv1a(coverKey ?? title);
  const hueA = 180 + (h % 60);
  const hueB = (hueA + 40) % 360;

  return (
    <div
      aria-hidden="true"
      style={{
        ...style,
        display: "grid",
        placeItems: "center",
        background: `linear-gradient(135deg, hsl(${hueA} 38% 42%), hsl(${hueB} 34% 28%))`,
        color: "rgba(255,255,255,0.82)",
        fontFamily: "var(--font-display)",
        fontWeight: 600,
        fontSize: Math.max(11, Math.round(size * 0.3)),
        letterSpacing: "0.02em",
        userSelect: "none",
      }}
    >
      {initials(title)}
    </div>
  );
}
