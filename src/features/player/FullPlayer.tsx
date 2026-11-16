import type { PlayerState, QueueItem } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";
import { formatDuration } from "../../lib/format";

/**
 * Layar pemutar penuh (mobile). Slide-up dari mini player — DESIGN.md §3/§4.
 * Fase 0: menampilkan state + antrean; kontrol play/seek menyusul di Fase 1.
 */
export function FullPlayer({
  state,
  queue,
  onClose,
}: {
  state: PlayerState;
  queue: QueueItem[];
  onClose: () => void;
}) {
  const progress = state.durationMs > 0 ? Math.min(1, state.positionMs / state.durationMs) : 0;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "var(--s-4)",
        gap: "var(--s-4)",
        overflowY: "auto",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 16 }}>Sedang Diputar</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup pemutar penuh"
          style={{ width: 44, height: 44, color: "var(--text-muted)" }}
        >
          ⌄
        </button>
      </header>

      <div style={{ display: "grid", placeItems: "center", gap: "var(--s-4)" }}>
        {state.track ? (
          <>
            <CoverArt
              coverKey={state.track.coverKey}
              title={state.track.title}
              size={220}
              radius={20}
            />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>
                {state.track.title}
              </div>
              <div className="muted">{state.track.artist}</div>
            </div>
          </>
        ) : (
          <EmptyState title="Belum ada lagu" hint="Pilih lagu dari Search." />
        )}
      </div>

      <div
        aria-hidden="true"
        style={{ height: 4, background: "var(--surface-2)", borderRadius: 999 }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: "var(--accent)",
            borderRadius: 999,
          }}
        />
      </div>
      <div
        className="mono muted"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
      >
        <span>{formatDuration(state.positionMs)}</span>
        <span>{formatDuration(state.durationMs)}</span>
      </div>

      <h2 style={{ fontSize: 15 }}>Antrean</h2>
      {queue.length === 0 ? (
        <EmptyState title="Antrean kosong" hint="Lagu yang kamu putar akan muncul di sini." />
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          {queue.map((it) => (
            <TrackRow key={`${it.position}-${it.track.videoId}`} track={it.track} />
          ))}
        </div>
      )}
    </section>
  );
}
