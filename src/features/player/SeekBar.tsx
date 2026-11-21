import { useCallback, useRef, useState } from "react";

import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";

interface Props {
  positionMs: number;
  durationMs: number;
  /** Dipanggil sekali saat user melepas jari/mouse, bukan tiap gerakan. */
  onSeek: (positionMs: number) => void;
  disabled?: boolean;
  /** Tampilkan garis scan tipis saat stream sedang dimuat (DESIGN-ENDFIELD §8). */
  loading?: boolean;
}

const SEGMENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TICKS = [10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

/**
 * Bar seek bersegmen (DESIGN-ENDFIELD §6, DESIGN-LAYOUT §6): 10 segmen dengan
 * tick tiap 10%, kepala blok kuning kecil, waktu mono di kedua ujung.
 *
 * Kenapa seek baru dikirim saat pointer dilepas, bukan tiap gerakan: stream
 * berasal dari googlevideo, dan setiap `currentTime` baru memicu permintaan
 * range ke server. Menembak seek puluhan kali selama drag membuat audio
 * tersendat dan resolver kebanjiran. Selama drag, UI menampilkan posisi
 * pratinjau saja.
 */
export function SeekBar({ positionMs, durationMs, onSeek, disabled, loading = false }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [pratinjau, setPratinjau] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  /**
   * Status drag disimpan juga di ref.
   *
   * `setDrag` adalah update state React yang baru berlaku pada render
   * berikutnya, sedangkan `pointerup` bisa datang di tick yang sama dengan
   * `pointerdown` (klik cepat). Kalau `lepas` membaca state itu, nilainya
   * masih `false` dan seek-nya dibatalkan diam-diam — bar terlihat bisa
   * diklik tapi tidak melompat. Ref selalu berisi nilai terbaru.
   */
  const dragRef = useRef(false);

  const bisa = !disabled && durationMs > 0;
  const tampil = pratinjau ?? positionMs;
  const rasio = durationMs > 0 ? Math.min(1, Math.max(0, tampil / durationMs)) : 0;

  /** Ubah posisi pointer jadi milidetik, dihitung dari kotak bar. */
  const keMs = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el || durationMs <= 0) return 0;
      const r = el.getBoundingClientRect();
      if (r.width <= 0) return 0;
      const rasioKlik = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return Math.round(rasioKlik * durationMs);
    },
    [durationMs],
  );

  const mulai = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!bisa) return;
    // Capture supaya drag tetap terlacak walau pointer keluar dari bar.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = true;
    setDrag(true);
    setPratinjau(keMs(e.clientX));
  };

  const gerak = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !bisa) return;
    setPratinjau(keMs(e.clientX));
  };

  const lepas = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = false;
    const target = keMs(e.clientX);
    setDrag(false);
    setPratinjau(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onSeek(target);
  };

  const tombol = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!bisa) return;
    // Shift = lompat jauh, sama seperti pemutar musik lain.
    const langkah = (e.shiftKey ? 30_000 : 5_000) * (e.key === "ArrowLeft" ? -1 : 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(durationMs, Math.max(0, positionMs + langkah)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onSeek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onSeek(durationMs);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", width: "100%" }}>
      <span
        className="mono"
        style={{
          fontSize: 11,
          minWidth: 42,
          textAlign: "right",
          color: drag ? "var(--ink)" : "var(--ink-muted)",
        }}
      >
        {formatDuration(tampil)}
      </span>

      {/* Hitbox 22px supaya mudah diklik/drag meski batang visualnya ramping. */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={bisa ? 0 : -1}
        aria-label={T.posisiPemutaran}
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={Math.round(tampil)}
        aria-valuetext={`${formatDuration(tampil)} dari ${formatDuration(durationMs)}`}
        aria-disabled={!bisa}
        onPointerDown={mulai}
        onPointerMove={gerak}
        onPointerUp={lepas}
        onPointerCancel={lepas}
        onLostPointerCapture={lepas}
        onKeyDown={tombol}
        style={{
          position: "relative",
          flex: 1,
          height: 22,
          display: "flex",
          alignItems: "center",
          cursor: bisa ? (drag ? "grabbing" : "pointer") : "default",
          touchAction: "none",
        }}
      >
        {/* 10 segmen (masing-masing 10%) dengan celah 2px antar segmen. */}
        <div
          aria-hidden="true"
          style={{
            position: "relative",
            width: "100%",
            height: drag ? 6 : 4,
            display: "grid",
            gridTemplateColumns: "repeat(10, 1fr)",
            gap: 2,
            transition: "height var(--t-fast) var(--ease)",
          }}
        >
          {SEGMENTS.map((seg) => {
            const isi = Math.min(1, Math.max(0, rasio * 10 - seg));
            return (
              <span
                key={seg}
                style={{
                  position: "relative",
                  display: "block",
                  height: "100%",
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                {isi > 0 && (
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${isi * 100}%`,
                      background: "var(--accent)",
                    }}
                  />
                )}
              </span>
            );
          })}

          {loading && <span className="scan-bar" />}
        </div>

        {/* Tick marks dekoratif tiap 10% di tepi bawah bar. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 1,
            height: 4,
            pointerEvents: "none",
          }}
        >
          {TICKS.map((pct) => (
            <span
              key={pct}
              style={{
                position: "absolute",
                left: `${pct}%`,
                bottom: 0,
                width: 1,
                height: pct === 50 ? 4 : 3,
                background: "var(--line)",
              }}
            />
          ))}
        </div>

        {/* Kepala blok kuning kecil (selalu tajam saat ada lagu). */}
        {bisa && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `calc(${rasio * 100}% - 4px)`,
              width: 8,
              height: drag ? 16 : 12,
              background: "var(--accent)",
              border: "1px solid var(--line-strong)",
              transition: drag ? "none" : "height var(--t-fast) var(--ease)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <span className="mono muted" style={{ fontSize: 11, minWidth: 42 }}>
        {formatDuration(durationMs)}
      </span>
    </div>
  );
}
