import type { PlayerState } from "../../types";
import type { QueueView } from "../../hooks/useQueue";
import { CoverArt } from "../../components/CoverArt";
import { EmptyState } from "../../components/EmptyState";
import { QueuePanel } from "./QueuePanel";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";
import { IkonTutup } from "../../components/icons";

export type RightPanelTab = "now" | "queue";

interface Props {
  tab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
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
}

/**
 * Panel kanan dua mode: SEDANG DIPUTAR · ANTREAN (DESIGN-LAYOUT bagian 4).
 *
 * Scroll vertikal independen di dalam setiap tab; tidak pernah memicu scroll
 * halaman maupun scroll horizontal.
 */
export function RightPanel({
  tab,
  onTabChange,
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
}: Props) {
  const isPlaying = playerState.status === "playing";
  const activeTrack = playerState.track ?? view.current;

  // 1–2 lagu teratas berikutnya setelah cursor (membungkus ke awal saat repeat all).
  const upcoming: { pos: number; track: QueueView["items"][number]["track"] }[] = [];
  if (view.items.length > 1) {
    for (let step = 1; step <= 2 && step < view.items.length; step++) {
      const idx = view.cursor + step;
      if (idx < view.items.length) {
        upcoming.push({ pos: idx, track: view.items[idx].track });
      } else if (view.repeat === "all") {
        const wrapped = idx % view.items.length;
        if (wrapped !== view.cursor) {
          upcoming.push({ pos: wrapped, track: view.items[wrapped].track });
        }
      }
    }
  }

  return (
    <aside
      aria-label={tab === "now" ? T.sedangDiputar : T.antrean}
      style={{
        borderLeft: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Kepala panel: dua tab mono kecil + tombol tutup (✕). */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-1)",
          padding: "var(--s-2)",
          borderBottom: "1px solid var(--line)",
          flex: "0 0 auto",
        }}
      >
        <div
          role="tablist"
          aria-label="Mode panel kanan"
          style={{ display: "flex", gap: "var(--s-1)", flex: 1, minWidth: 0 }}
        >
          <TabBtn aktif={tab === "now"} onClick={() => onTabChange("now")}>
            {T.sedangDiputar}
          </TabBtn>
          <TabBtn aktif={tab === "queue"} onClick={() => onTabChange("queue")}>
            {T.antrean}
          </TabBtn>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={T.tutupPanel}
          title={T.tutupPanel}
          style={{
            width: 44,
            height: 44,
            flex: "0 0 44px",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-muted)",
            fontSize: 14,
          }}
        >
          <IkonTutup size={16} />
        </button>
      </header>

      {tab === "queue" ? (
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
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            padding: "var(--s-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-4)",
          }}
        >
          {!activeTrack ? (
            <EmptyState title={T.noDataStandby} hint={T.belumAdaLaguHint} />
          ) : (
            <>
              {/* Baris status sistem */}
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
                <span className="label" aria-hidden="true">
                  03 /
                </span>
                <span
                  className={`status-dot ${playerState.status === "loading" ? "status-dot-muat" : isPlaying ? "status-dot-aktif" : ""}`}
                  aria-hidden="true"
                />
                <span className="label" style={{ color: "var(--ink)" }} aria-live="polite">
                  {playerState.status === "loading" ? T.memuat : isPlaying ? T.memutar : T.dijeda}
                </span>
                <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
                {isPlaying && (
                  <span className="eq-bars" style={{ color: "var(--ink)" }} aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </div>

              {/* Cover besar persegi selebar panel dengan corner brackets. */}
              <div
                className="bracketed"
                style={{
                  padding: 6,
                  background: "var(--bg)",
                  border: "1px solid var(--line)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <CoverArt
                  coverKey={activeTrack.coverKey}
                  title={activeTrack.title}
                  size={288}
                  radius={0}
                />
              </div>

              {/* Identitas lagu: judul maks 2 baris, artis, album mono kecil. */}
              <div style={{ minWidth: 0 }}>
                <h2
                  style={{
                    fontSize: 26,
                    lineHeight: 1.1,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    wordBreak: "break-word",
                  }}
                >
                  {activeTrack.title}
                </h2>
                <p
                  className="muted"
                  style={{
                    margin: "var(--s-1) 0 0",
                    fontSize: 14,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {activeTrack.artist}
                </p>
                {activeTrack.album && (
                  <p
                    className="label"
                    style={{
                      margin: "var(--s-2) 0 0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activeTrack.album}
                  </p>
                )}
              </div>

              {/* Pintasan 1–2 lagu berikutnya dari antrean (klik = lompat). */}
              <section
                style={{
                  borderTop: "1px solid var(--line)",
                  paddingTop: "var(--s-3)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--s-2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
                  <span className="label">{T.berikutnya}</span>
                  <span
                    style={{ flex: 1, borderTop: "1px solid var(--line)" }}
                    aria-hidden="true"
                  />
                </div>

                {upcoming.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {T.tidakAdaBerikutnya}
                  </p>
                ) : (
                  <>
                    {upcoming.map(({ pos, track }) => (
                      <button
                        key={`${pos}-${track.videoId}`}
                        type="button"
                        onClick={() => onPlayIndex(pos)}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "40px minmax(0, 1fr) 44px",
                          alignItems: "center",
                          gap: "var(--s-2)",
                          width: "100%",
                          padding: "var(--s-2)",
                          textAlign: "left",
                          background: "var(--bg)",
                          border: "1px solid var(--line)",
                          color: "var(--ink)",
                        }}
                      >
                        <CoverArt
                          coverKey={track.coverKey}
                          title={track.title}
                          size={40}
                          radius={0}
                        />
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 13,
                              fontWeight: 500,
                            }}
                          >
                            {track.title}
                          </span>
                          <span
                            className="muted"
                            style={{
                              display: "block",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 12,
                            }}
                          >
                            {track.artist}
                          </span>
                        </span>
                        <span className="mono muted" style={{ fontSize: 11, textAlign: "right" }}>
                          {formatDuration(track.durationMs)}
                        </span>
                      </button>
                    ))}

                    {/* Sisa antrean setelah 2 lagu teratas */}
                    {Math.max(0, view.items.length - 1 - view.cursor - 2) > 0 && (
                      <button
                        type="button"
                        className="k-btn k-btn-quiet"
                        onClick={() => onTabChange("queue")}
                        style={{
                          width: "100%",
                          marginTop: "var(--s-1)",
                          minHeight: 36,
                          fontSize: 11,
                        }}
                      >
                        {T.laguLagi(Math.max(0, view.items.length - 1 - view.cursor - 2))}
                      </button>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function TabBtn({
  aktif,
  onClick,
  children,
}: {
  aktif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={aktif}
      onClick={onClick}
      className={`k-btn ${aktif ? "k-btn-accent" : ""}`}
      style={{
        flex: 1,
        minHeight: 44,
        padding: "0 var(--s-2)",
        whiteSpace: "nowrap",
        fontSize: 10,
      }}
    >
      {children}
    </button>
  );
}
