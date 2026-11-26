import type { PlayerState, Track } from "../../types";
import type { QueueView } from "../../hooks/useQueue";
import { CoverArt } from "../../components/CoverArt";
import { QueuePanel } from "./QueuePanel";
import { T } from "../../lib/strings";
import { IkonTutup, IkonHati } from "../../components/icons";

interface Props {
  onClose: () => void;
  playerState: PlayerState;
  view: QueueView;
  onPlayIndex: (position: number) => void;
  onRemove: (position: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onToggleShuffle: () => void;
  onToggleShufflePintar?: () => void;
  onCycleRepeat: () => void;
  onFavorite?: (track: Track) => void;
  isFavorite?: boolean;
}

/**
 * Panel kanan terintegrasi (Spec §1):
 * - Bagian Atas (Sticky): Kartu Sedang Diputar (Cover 1:1, corner brackets, judul, artis, tombol favorit).
 * - Bagian Bawah (Scrollable): Daftar Antrean (Queue) lengkap dengan header, controls, dan items.
 */
export function RightPanel({
  onClose,
  playerState,
  view,
  onPlayIndex,
  onRemove,
  onMove,
  onClear,
  onToggleShuffle,
  onToggleShufflePintar,
  onCycleRepeat,
  onFavorite,
  isFavorite = false,
}: Props) {
  const isPlaying = playerState.status === "playing";
  const activeTrack = playerState.track ?? view.current;

  return (
    <aside
      aria-label={`${T.sedangDiputar} & ${T.antrean}`}
      style={{
        borderLeft: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header Sticky Atas: Status 03 / SEDANG DIPUTAR + Tombol Tutup */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--s-2) var(--s-3)",
          borderBottom: "1px solid var(--line)",
          flex: "0 0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
          <span className="label" aria-hidden="true">
            03 /
          </span>
          <span
            className={`status-dot ${playerState.status === "loading" ? "status-dot-muat" : isPlaying ? "status-dot-aktif" : ""}`}
            aria-hidden="true"
          />
          <span className="label" style={{ color: "var(--ink)" }} aria-live="polite">
            {activeTrack
              ? playerState.status === "loading"
                ? T.memuat
                : isPlaying
                  ? T.memutar
                  : T.dijeda
              : T.noDataStandby}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={T.tutup}
          title={`${T.tutup} (Ctrl+Q)`}
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-muted)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <IkonTutup size={16} />
        </button>
      </header>

      {/* Bagian Atas (Sticky): Kartu Sedang Diputar (Cover 1:1, Judul, Artis, Favorit) */}
      {activeTrack && (
        <div
          style={{
            flex: "0 0 auto",
            padding: "var(--s-3)",
            borderBottom: "1px solid var(--line)",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2)",
          }}
        >
          <div
            className="bracketed"
            style={{
              padding: 4,
              background: "var(--panel)",
              border: "1px solid var(--line)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <CoverArt
              coverKey={activeTrack.coverKey}
              title={activeTrack.title}
              size={240}
              radius={0}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "var(--s-2)",
              minWidth: 0,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2
                style={{
                  fontSize: 18,
                  lineHeight: 1.2,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                  margin: 0,
                }}
              >
                {activeTrack.title}
              </h2>
              <p
                className="muted"
                style={{
                  margin: "2px 0 0",
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeTrack.artist}
              </p>
            </div>

            {onFavorite && (
              <button
                type="button"
                onClick={() => onFavorite(activeTrack)}
                className={`k-btn ${isFavorite ? "k-btn-accent" : "k-btn-quiet"}`}
                style={{
                  width: 36,
                  height: 36,
                  minWidth: 36,
                  minHeight: 36,
                  padding: 0,
                  flexShrink: 0,
                }}
                title={isFavorite ? "Hapus dari favorit" : "Tambah ke favorit"}
                aria-label={isFavorite ? "Hapus dari favorit" : "Tambah ke favorit"}
              >
                <IkonHati size={16} isi={isFavorite} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bagian Bawah (Scrollable): Antrean (Queue) */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <QueuePanel
          view={view}
          activeTrack={activeTrack}
          isPlaying={isPlaying}
          onPlayIndex={onPlayIndex}
          onRemove={onRemove}
          onMove={onMove}
          onClear={onClear}
          onToggleShuffle={onToggleShuffle}
          onToggleShufflePintar={onToggleShufflePintar}
          onCycleRepeat={onCycleRepeat}
        />
      </div>
    </aside>
  );
}
