import { useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { CoverArt } from "../../components/CoverArt";
import type { QueueView } from "../../hooks/useQueue";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";
import { IkonTutup } from "../../components/icons";
import type { Track } from "../../types";

interface Props {
  view: QueueView;
  /** Lagu aktif dari playerStore agar tetap sinkron dengan PlayerBar. */
  activeTrack?: Track | null;
  isPlaying?: boolean;
  onPlayIndex: (position: number) => void;
  onRemove: (position: number) => void;
  onMove: (from: number, to: number) => void;
  onClear: () => void;
  onToggleShuffle: () => void;
  /** Ganti jenis shuffle. Hanya berarti saat shuffle menyala. */
  onToggleShufflePintar?: () => void;
  onCycleRepeat: () => void;
}

const REPEAT_LABEL: Record<QueueView["repeat"], string> = {
  off: T.repeatOff,
  one: T.repeatOne,
  all: T.repeatAll,
};

/**
 * Isi tab ANTREAN di panel kanan (DESIGN-LAYOUT bagian 4.2).
 *
 * Setiap baris memakai CSS grid dengan lebar tetap untuk handle, indeks,
 * cover, durasi, dan ✕ — supaya kolom durasi dan ✕ sejajar sempurna antar
 * baris dan tidak pernah memicu scroll horizontal.
 */
export function QueuePanel({
  view,
  activeTrack = null,
  isPlaying = false,
  onPlayIndex,
  onRemove,
  onMove,
  onClear,
  onToggleShuffle,
  onToggleShufflePintar,
  onCycleRepeat,
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const { items, cursor, shuffle, shufflePintar, repeat } = view;
  const currentItem = items[cursor] ?? null;
  const currentTrack = currentItem?.track ?? activeTrack;

  // Hanya tampilkan lagu yang BENAR-BENAR akan diputar berikutnya (`pos > cursor`).
  // Sebelumnya filter `pos !== cursor` ikut menampilkan lagu yang sudah lewat
  // (`pos < cursor`) di bawah BERIKUTNYA, sehingga lagu lama muncul lagi saat
  // di-skip dan tombol Next tampak macet di lagu terakhir.
  // Saat `repeat === "all"`, lagu sebelum cursor ikut masuk di belakang sesuai
  // urutan pemutaran berikutnya.
  const setelahCursor = items.map((it, pos) => ({ it, pos })).filter(({ pos }) => pos > cursor);
  const berikutnya =
    repeat === "all"
      ? [
          ...setelahCursor,
          ...items.map((it, pos) => ({ it, pos })).filter(({ pos }) => pos < cursor),
        ]
      : setelahCursor;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* Kepala sistem: 04 / ANTREAN ──── N ITEM */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-2)",
          padding: "var(--s-3) var(--s-3) var(--s-2)",
          flex: "0 0 auto",
        }}
      >
        <span className="label" aria-hidden="true">
          04 /
        </span>
        <span className="label" style={{ color: "var(--ink)" }}>
          {T.antrean}
        </span>
        <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
        <span className="label">
          {items.length} {T.item}
        </span>
      </div>

      {/* Baris kontrol: ACAK, REPEAT, KOSONGKAN (outline merah + konfirmasi). */}
      <div
        style={{
          display: "flex",
          gap: "var(--s-1)",
          padding: "0 var(--s-3) var(--s-2)",
          borderBottom: "1px solid var(--line)",
          flex: "0 0 auto",
        }}
      >
        <button
          type="button"
          onClick={onToggleShuffle}
          aria-pressed={shuffle}
          style={{
            flex: 1,
            minHeight: 36,
            padding: "0 6px",
            background: shuffle ? "var(--accent)" : "transparent",
            color: shuffle ? "var(--accent-ink)" : "var(--ink-muted)",
            border: shuffle ? "1px solid var(--accent)" : "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: shuffle ? 600 : 400,
          }}
        >
          {T.acak}
        </button>
        {shuffle && onToggleShufflePintar && (
          <button
            type="button"
            onClick={onToggleShufflePintar}
            aria-pressed={shufflePintar}
            title={T.acakPintarHint}
            style={{
              flex: 1,
              minHeight: 36,
              padding: "0 6px",
              background: shufflePintar ? "var(--accent)" : "transparent",
              color: shufflePintar ? "var(--accent-ink)" : "var(--ink-muted)",
              border: shufflePintar ? "1px solid var(--accent)" : "1px solid var(--line)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              fontWeight: shufflePintar ? 600 : 400,
            }}
          >
            {T.acakPintar}
          </button>
        )}
        <button
          type="button"
          onClick={onCycleRepeat}
          style={{
            flex: 1,
            minHeight: 36,
            padding: "0 6px",
            background: repeat !== "off" ? "var(--accent)" : "transparent",
            color: repeat !== "off" ? "var(--accent-ink)" : "var(--ink-muted)",
            border: repeat !== "off" ? "1px solid var(--accent)" : "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: repeat !== "off" ? 600 : 400,
          }}
        >
          {REPEAT_LABEL[repeat]}
        </button>
        <button
          type="button"
          onClick={() => {
            if (items.length === 0) return;
            if (confirm(T.konfirmasiKosongkanAntrean)) onClear();
          }}
          disabled={items.length === 0}
          style={{
            minHeight: 36,
            padding: "0 var(--s-2)",
            border: items.length === 0 ? "1px solid var(--line)" : "1px solid var(--danger)",
            color: items.length === 0 ? "var(--ink-muted)" : "var(--danger)",
            opacity: items.length === 0 ? 0.45 : 1,
            cursor: items.length === 0 ? "default" : "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.08em",
          }}
        >
          {T.kosongkan}
        </button>
      </div>

      {/* Daftar antrean — scroll vertikal sendiri, tanpa scroll horizontal. */}
      <div
        style={{
          overflowY: "auto",
          overflowX: "hidden",
          padding: "var(--s-2)",
          flex: 1,
          minHeight: 0,
        }}
      >
        {items.length === 0 && !currentTrack ? (
          <EmptyState title={T.antreanKosong} hint={T.antreanKosongHint} />
        ) : (
          <>
            {currentTrack && (
              <section style={{ marginBottom: "var(--s-3)" }}>
                <div className="label" style={{ padding: "var(--s-1) var(--s-2)" }}>
                  {T.sedangDiputar}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px minmax(0, 1fr) 44px",
                    alignItems: "center",
                    gap: "var(--s-2)",
                    padding: "var(--s-2)",
                    background: "var(--panel-2)",
                    boxShadow: "inset 3px 0 0 var(--accent)",
                  }}
                >
                  <CoverArt
                    coverKey={currentTrack.coverKey}
                    title={currentTrack.title}
                    size={40}
                    radius={0}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {currentTrack.title}
                    </div>
                    <div
                      className="muted"
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                      }}
                    >
                      {currentTrack.artist}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}
                  >
                    {isPlaying ? (
                      <span
                        className="eq-bars"
                        style={{ color: "var(--ink)" }}
                        aria-label={T.sedangDiputar}
                      >
                        <span />
                        <span />
                        <span />
                      </span>
                    ) : (
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {formatDuration(currentTrack.durationMs)}
                      </span>
                    )}
                  </div>
                </div>
              </section>
            )}

            <div className="label" style={{ padding: "var(--s-1) var(--s-2)" }}>
              {T.berikutnya}
            </div>

            {berikutnya.length === 0 ? (
              <p className="muted" style={{ padding: "var(--s-2)", fontSize: 13, margin: 0 }}>
                {T.tidakAdaBerikutnya}
              </p>
            ) : (
              berikutnya.map(({ it, pos }, idx) => (
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
                    display: "grid",
                    // Lebar tetap untuk handle, indeks, cover, durasi, dan ✕:
                    // judul/artis menyerap sisa dengan ellipsis (tanpa scroll X).
                    gridTemplateColumns: "14px 20px 36px minmax(0, 1fr) 42px 36px",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 4px",
                    minHeight: 52,
                    borderBottom: "1px solid var(--line)",
                    borderTop:
                      dragOver === pos && dragFrom !== pos
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                  }}
                >
                  <DragHandle />

                  <span
                    className="mono muted"
                    style={{ fontSize: 10, textAlign: "right" }}
                    aria-hidden="true"
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>

                  <CoverArt
                    coverKey={it.track.coverKey}
                    title={it.track.title}
                    size={36}
                    radius={0}
                  />

                  <button
                    type="button"
                    onClick={() => onPlayIndex(pos)}
                    style={{
                      minWidth: 0,
                      textAlign: "left",
                      padding: "4px 0",
                      color: "var(--ink)",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                      }}
                    >
                      {it.track.title}
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
                      {it.track.artist}
                    </span>
                    {it.prioritas && (
                      <span
                        className="mono"
                        title={T.antreanPrioritasHint}
                        style={{
                          display: "inline-block",
                          marginTop: 2,
                          padding: "1px 5px",
                          fontSize: 9,
                          letterSpacing: "0.08em",
                          background: "var(--accent)",
                          color: "var(--accent-ink)",
                        }}
                      >
                        {T.antreanPrioritas}
                      </span>
                    )}
                  </button>

                  <span className="mono muted" style={{ fontSize: 11, textAlign: "right" }}>
                    {formatDuration(it.track.durationMs)}
                  </span>

                  <button
                    type="button"
                    onClick={() => onRemove(pos)}
                    aria-label={`${T.hapusDariAntrean}: ${it.track.title}`}
                    title={T.hapusDariAntrean}
                    style={{
                      width: 36,
                      height: 44,
                      display: "grid",
                      placeItems: "center",
                      color: "var(--ink-muted)",
                      fontSize: 12,
                    }}
                  >
                    <IkonTutup size={13} />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Handle drag 6 titik kotak (DESIGN-ENDFIELD §6, DESIGN-LAYOUT §4.2). */
function DragHandle() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 3px)",
        gap: 2,
        justifyContent: "center",
        color: "var(--ink-muted)",
        cursor: "grab",
        opacity: 0.65,
      }}
    >
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
      <span style={{ width: 3, height: 3, background: "currentColor" }} />
    </span>
  );
}
