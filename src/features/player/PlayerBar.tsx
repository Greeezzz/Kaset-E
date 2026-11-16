import type { PlayerState } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { formatDuration } from "../../lib/format";

export function PlayerBar({ state, onToggle }: { state: PlayerState; onToggle: () => void }) {
  const progress = state.durationMs > 0 ? Math.min(1, state.positionMs / state.durationMs) : 0;
  const playing = state.status === "playing";
  const loading = state.status === "loading";

  return (
    <div
      style={{
        height: "var(--playerbar-h)",
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
        display: "grid",
        gridTemplateColumns: "minmax(180px, 1fr) 2fr minmax(180px, 1fr)",
        alignItems: "center",
        gap: "var(--s-4)",
        padding: "0 var(--s-4)",
        position: "relative",
      }}
    >
      {/* progress tipis di tepi atas (DESIGN.md) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 2,
          width: `${progress * 100}%`,
          background: "var(--accent)",
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", minWidth: 0 }}>
        {state.track ? (
          <CoverArt coverKey={state.track.coverKey} title={state.track.title} size={44} />
        ) : (
          <CoverArt coverKey={null} title="Kaset" size={44} />
        )}
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {state.track?.title ?? "Belum ada lagu"}
          </span>
          <span className="muted" style={{ display: "block", fontSize: 13 }}>
            {state.track?.artist ?? "—"}
          </span>
        </span>
      </div>

      <div style={{ textAlign: "center" }}>
        <div className="mono muted" style={{ fontSize: 13 }}>
          {formatDuration(state.positionMs)} / {formatDuration(state.durationMs)}
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={!state.track}
          aria-label={playing ? "Jeda" : "Putar"}
          style={{
            minWidth: 44,
            minHeight: 44,
            fontSize: 16,
            color: state.track ? "var(--accent)" : "var(--text-muted)",
            opacity: state.track ? 1 : 0.4,
          }}
        >
          {loading ? "…" : playing ? "❙❙" : "▶"}
        </button>
        <div className="muted" style={{ fontSize: 11 }}>
          {state.status}
          {state.shuffle ? " · acak" : ""}
          {state.repeat !== "off" ? ` · repeat ${state.repeat}` : ""}
        </div>
      </div>

      <div className="muted" style={{ textAlign: "right", fontSize: 13 }}>
        Volume {Math.round(state.volume * 100)}%
      </div>
    </div>
  );
}
