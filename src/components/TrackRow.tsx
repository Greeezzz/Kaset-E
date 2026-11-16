import type { Track } from "../types";
import { CoverArt } from "./CoverArt";
import { formatDuration } from "../lib/format";

interface Props {
  track: Track;
  active?: boolean;
  onPlay?: (track: Track) => void;
  /** Path cover lokal, diisi setelah event cover://ready (Fase 1). */
  coverPath?: string | null;
}

export function TrackRow({ track, active = false, onPlay, coverPath }: Props) {
  return (
    <button
      type="button"
      onClick={() => onPlay?.(track)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-3)",
        width: "100%",
        padding: "var(--s-2)",
        borderRadius: "var(--r-sm)",
        textAlign: "left",
        background: active ? "var(--surface-2)" : "transparent",
        color: active ? "var(--accent)" : "var(--text)",
      }}
    >
      <CoverArt coverKey={track.coverKey} title={track.title} localPath={coverPath} size={40} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.title}
        </span>
        <span
          className="muted"
          style={{
            display: "block",
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.artist}
        </span>
      </span>
      <span className="muted mono" style={{ fontSize: 13 }}>
        {formatDuration(track.durationMs)}
      </span>
    </button>
  );
}
