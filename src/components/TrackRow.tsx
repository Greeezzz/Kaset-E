import type { Track } from "../types";
import { CoverArt } from "./CoverArt";
import { formatDuration } from "../lib/format";

interface Props {
  track: Track;
  active?: boolean;
  onPlay?: (track: Track) => void;
  /** Antrekan lagu ini di akhir antrean. */
  onQueue?: (track: Track) => void;
  /** Putar lagu ini berikutnya. */
  onPlayNext?: (track: Track) => void;
  /** Path cover lokal, diisi setelah event cover://ready (Fase 1). */
  coverPath?: string | null;
  /** Indeks urut untuk label teknis mono (opsional). */
  index?: number;
}

export function TrackRow({
  track,
  active = false,
  onPlay,
  onQueue,
  onPlayNext,
  coverPath,
  index,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-2)",
        background: active ? "var(--panel-2)" : "transparent",
        // Penanda aktif = garis kuning di tepi kiri (DESIGN-ENDFIELD §6),
        // bukan teks kuning (kontras gagal di tema terang).
        boxShadow: active ? "inset 3px 0 0 var(--accent)" : "none",
      }}
    >
      <button
        type="button"
        onClick={() => onPlay?.(track)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-3)",
          flex: 1,
          minWidth: 0,
          padding: "var(--s-2)",
          textAlign: "left",
          color: "var(--ink)",
        }}
      >
        {index !== undefined && (
          <span className="label" style={{ width: 20, textAlign: "right", flex: "0 0 20px" }}>
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
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

      {(onPlayNext ?? onQueue) && (
        <span style={{ display: "flex", flex: "0 0 auto" }}>
          {onPlayNext && (
            <button
              type="button"
              onClick={() => onPlayNext(track)}
              aria-label={`Putar ${track.title} berikutnya`}
              title="Putar berikutnya"
              style={{ width: 36, height: 36, color: "var(--ink-muted)", fontSize: 14 }}
            >
              ⏭
            </button>
          )}
          {onQueue && (
            <button
              type="button"
              onClick={() => onQueue(track)}
              aria-label={`Tambahkan ${track.title} ke antrean`}
              title="Tambah ke antrean"
              style={{ width: 36, height: 36, color: "var(--ink-muted)", fontSize: 15 }}
            >
              +
            </button>
          )}
        </span>
      )}
    </div>
  );
}
