import type { PlayerState } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";

export function PlayerBar({
  state,
  onToggle,
  onNext,
  onSeek,
  onVolume,
}: {
  state: PlayerState;
  onToggle: () => void;
  /** Lanjut ke lagu berikutnya di antrean. */
  onNext?: () => void;
  /** Lompat ke posisi tertentu (ms). */
  onSeek?: (positionMs: number) => void;
  /** Ubah volume 0..1. */
  onVolume?: (volume: number) => void;
}) {
  const playing = state.status === "playing";
  const loading = state.status === "loading";

  return (
    <div
      style={{
        height: "var(--playerbar-h)",
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
        display: "grid",
        gridTemplateColumns: "minmax(180px, 1fr) minmax(280px, 2.4fr) minmax(160px, 1fr)",
        alignItems: "center",
        gap: "var(--s-4)",
        padding: "0 var(--s-4)",
      }}
    >
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

      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          onSeek={(ms) => onSeek?.(ms)}
          disabled={!state.track || !onSeek}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <button
            type="button"
            onClick={onToggle}
            disabled={!state.track}
            aria-label={playing ? "Jeda" : "Putar"}
            style={{
              minWidth: 40,
              minHeight: 32,
              fontSize: 15,
              border: "1px solid var(--line)",
              background: state.track ? "var(--accent)" : "transparent",
              color: state.track ? "var(--accent-ink)" : "var(--ink-muted)",
              opacity: state.track ? 1 : 0.5,
              cursor: state.track ? "pointer" : "default",
            }}
          >
            {loading ? "…" : playing ? "❙❙" : "▶"}
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!onNext}
            aria-label="Lagu berikutnya"
            title="Lagu berikutnya"
            style={{
              minWidth: 40,
              minHeight: 32,
              fontSize: 13,
              color: onNext ? "var(--ink)" : "var(--ink-muted)",
              opacity: onNext ? 1 : 0.4,
              cursor: onNext ? "pointer" : "default",
            }}
          >
            ⏭
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {state.status}
            {state.shuffle ? " · acak" : ""}
            {state.repeat !== "off" ? ` · repeat ${state.repeat}` : ""}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {onVolume ? (
          <VolumeControl volume={state.volume} onChange={onVolume} />
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            Volume {Math.round(state.volume * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}
