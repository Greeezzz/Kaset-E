import type { QueueItem } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";

export function QueuePanel({ items, onClose }: { items: QueueItem[]; onClose: () => void }) {
  return (
    <aside
      aria-label="Antrean"
      style={{
        width: "var(--queue-w)",
        flex: `0 0 var(--queue-w)`,
        borderLeft: "1px solid var(--border)",
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--s-3) var(--s-4)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h2 style={{ fontSize: 15 }}>Antrean</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup antrean"
          style={{ width: 44, height: 44, color: "var(--text-muted)" }}
        >
          ✕
        </button>
      </header>

      <div style={{ overflowY: "auto", padding: "var(--s-2)", flex: 1 }}>
        {items.length === 0 ? (
          <EmptyState title="Antrean kosong" hint="Lagu yang kamu putar akan muncul di sini." />
        ) : (
          items.map((it) => (
            <TrackRow key={`${it.position}-${it.track.videoId}`} track={it.track} />
          ))
        )}
      </div>
    </aside>
  );
}
