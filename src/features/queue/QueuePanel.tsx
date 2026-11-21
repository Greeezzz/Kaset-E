import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";
import { CoverArt } from "../../components/CoverArt";
import type { QueueView } from "../../hooks/useQueue";

interface Props {
  view: QueueView;
  onClose: () => void;
  onPlayIndex: (position: number) => void;
  onRemove: (position: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}

const REPEAT_LABEL: Record<QueueView["repeat"], string> = {
  off: "REPEAT OFF",
  one: "REPEAT ONE",
  all: "REPEAT ALL",
};

/**
 * Panel antrean.
 *
 * Mengikuti DESIGN-ENDFIELD §6: kepala panel bergaya sistem
 * (`02 / ANTREAN — n ITEM`), pemisah "SEDANG DIPUTAR" / "BERIKUTNYA", indeks
 * mono, penanda aktif garis kuning di tepi kiri.
 */
export function QueuePanel({
  view,
  onClose,
  onPlayIndex,
  onRemove,
  onMove,
  onClear,
  onToggleShuffle,
  onCycleRepeat,
}: Props) {
  // Indeks baris yang sedang di-drag. HTML5 drag tidak perlu dependensi.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { items, cursor, shuffle, repeat } = view;
  const current = items[cursor];
  // Baris yang sedang diputar SUDAH tampil di blok SEDANG DIPUTAR di atas.
  // Kalau ikut dirender lagi di daftar BERIKUTNYA, lagu yang sama muncul dua
  // kali dan user mengira antreannya dobel.
  const berikutnya = items.map((it, pos) => ({ it, pos })).filter(({ pos }) => pos !== cursor);

  return (
    <aside
      aria-label="Antrean"
      style={{
        width: "var(--queue-w)",
        flex: "0 0 var(--queue-w)",
        borderLeft: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-2)",
          padding: "var(--s-3) var(--s-3) var(--s-2)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span className="label">02 / ANTREAN</span>
        <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
        <span className="label">{items.length} ITEM</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup antrean"
          style={{ width: 32, height: 32, color: "var(--ink-muted)" }}
        >
          ✕
        </button>
      </header>

      <div
        style={{
          display: "flex",
          gap: "var(--s-1)",
          padding: "var(--s-2) var(--s-3)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <button
          type="button"
          onClick={onToggleShuffle}
          aria-pressed={shuffle}
          title={shuffle ? "Matikan acak" : "Acak antrean"}
          style={{
            flex: 1,
            minHeight: 32,
            background: shuffle ? "var(--accent)" : "transparent",
            color: shuffle ? "var(--accent-ink)" : "var(--ink-muted)",
            border: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          ACAK {shuffle ? "ON" : "OFF"}
        </button>
        <button
          type="button"
          onClick={onCycleRepeat}
          title="Ubah mode ulang"
          style={{
            flex: 1,
            minHeight: 32,
            background: repeat !== "off" ? "var(--accent)" : "transparent",
            color: repeat !== "off" ? "var(--accent-ink)" : "var(--ink-muted)",
            border: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          {REPEAT_LABEL[repeat]}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={items.length === 0}
          title="Kosongkan antrean"
          style={{
            minHeight: 32,
            padding: "0 var(--s-2)",
            border: "1px solid var(--line)",
            color: items.length === 0 ? "var(--ink-muted)" : "var(--danger)",
            opacity: items.length === 0 ? 0.5 : 1,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
          }}
        >
          KOSONGKAN
        </button>
      </div>

      <div style={{ overflowY: "auto", padding: "var(--s-2)", flex: 1 }}>
        {items.length === 0 ? (
          <EmptyState
            title="ANTREAN KOSONG"
            hint="Tekan + pada lagu hasil pencarian untuk menambahkannya."
          />
        ) : (
          <>
            {current && (
              <section style={{ marginBottom: "var(--s-3)" }}>
                <div className="label" style={{ padding: "var(--s-1) var(--s-2)" }}>
                  SEDANG DIPUTAR
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
                  <CoverArt
                    coverKey={current.track.coverKey}
                    title={current.track.title}
                    size={48}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {current.track.title}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {current.track.artist}
                    </div>
                  </div>
                </div>
              </section>
            )}

            <div className="label" style={{ padding: "var(--s-1) var(--s-2)" }}>
              BERIKUTNYA
            </div>

            {berikutnya.length === 0 && current ? (
              <p className="muted" style={{ padding: "var(--s-2)", fontSize: 13 }}>
                Tidak ada lagu setelah ini.
              </p>
            ) : null}

            {berikutnya.map(({ it, pos }) => {
              return (
                <div
                  key={`${pos}-${it.track.videoId}`}
                  draggable
                  onDragStart={() => setDragFrom(pos)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(pos);
                  }}
                  onDrop={() => {
                    if (dragFrom !== null && dragFrom !== pos) onMove(dragFrom, pos);
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    borderTop:
                      dragOver === pos && dragFrom !== pos
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                >
                  <TrackRow
                    track={it.track}
                    index={pos}
                    onPlay={() => onPlayIndex(pos)}
                    onRemove={() => onRemove(pos)}
                    labelHapus="Hapus dari antrean"
                  />
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
