import type { PlayerState } from "../../types";
import { T } from "../../lib/strings";

/**
 * Mode Kaset — placeholder untuk K1.
 *
 * Pada tahap ini sengaja TIDAK menggambar apa pun selain keterangan singkat.
 * K2 mengisi SVG kaset, K3 animasi reel, K4 dek penuh (LCD/LED/tombol).
 *
 * Komponen ini dimuat malas (`React.lazy`) dari `FullPlayer`, jadi selama mode
 * `standar` aktif, bundel ini tidak pernah diunduh maupun dieksekusi.
 */
export function KasetMode({ state }: { state: PlayerState }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        gap: "var(--s-3)",
        padding: "var(--s-6) var(--s-4)",
        border: "1px dashed var(--line-strong)",
        background: "var(--panel)",
        minHeight: 220,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-muted)" }}
      >
        {T.modeKaset}
      </div>
      <p style={{ margin: 0, fontSize: 13, textAlign: "center" }}>{T.modeKasetSegera}</p>
      {state.track && (
        <p
          className="mono muted"
          style={{ margin: 0, fontSize: 11, textAlign: "center", maxWidth: 320 }}
        >
          {state.track.title} · {state.track.artist}
        </p>
      )}
    </div>
  );
}
