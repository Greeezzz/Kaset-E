import type { Track } from "../../types";
import { CoverArt } from "../../components/CoverArt";

interface Props {
  track: Track | null;
  playing: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

export function MiniPlayer({ track, playing, onToggle, onOpen }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-3)",
        padding: "var(--s-2) var(--s-3)",
        borderTop: "1px solid var(--border)",
        background: "var(--surface-2)",
        minHeight: 56,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label="Buka pemutar penuh"
        style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flex: 1, minWidth: 0 }}
      >
        {track ? (
          <CoverArt coverKey={track.coverKey} title={track.title} size={36} />
        ) : (
          <CoverArt coverKey={null} title="Kaset" size={36} />
        )}
        <span style={{ minWidth: 0, textAlign: "left" }}>
          <span
            style={{
              display: "block",
              fontSize: 14,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track?.title ?? "Belum ada lagu"}
          </span>
          <span className="muted" style={{ display: "block", fontSize: 12 }}>
            {track?.artist ?? "—"}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-label={playing ? "Jeda" : "Putar"}
        style={{
          width: 44,
          height: 44,
          fontSize: 18,
          border: "1px solid var(--line)",
          color: "var(--ink)",
        }}
      >
        {playing ? "❙❙" : "▶"}
      </button>
    </div>
  );
}
