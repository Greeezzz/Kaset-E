import { useCallback, useRef, useState } from "react";

import { formatDuration } from "../../lib/format";

interface Props {
  positionMs: number;
  durationMs: number;
  /** Dipanggil sekali saat user melepas jari/mouse, bukan tiap gerakan. */
  onSeek: (positionMs: number) => void;
  disabled?: boolean;
}

/**
 * Bar seek yang bisa diklik, di-drag, dan dioperasikan keyboard.
 *
 * Kenapa seek baru dikirim saat pointer dilepas, bukan tiap gerakan: stream
 * berasal dari googlevideo, dan setiap `currentTime` baru memicu permintaan
 * range ke server. Menembak seek puluhan kali selama drag membuat audio
 * tersendat dan resolver kebanjiran. Selama drag, UI menampilkan posisi
 * pratinjau saja.
 */
export function SeekBar({ positionMs, durationMs, onSeek, disabled }: Props) {
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
      <span className="mono muted" style={{ fontSize: 12, minWidth: 42, textAlign: "right" }}>
        {formatDuration(tampil)}
      </span>

      {/* Hitbox 14px supaya mudah diklik, walau visualnya tetap tipis. */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={bisa ? 0 : -1}
        aria-label="Posisi pemutaran"
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
          height: 14,
          display: "flex",
          alignItems: "center",
          cursor: bisa ? (drag ? "grabbing" : "pointer") : "default",
          touchAction: "none",
          opacity: bisa ? 1 : 0.45,
        }}
      >
        {/* jalur */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: drag ? 4 : 2,
            background: "var(--line)",
            transition: "height 120ms ease",
          }}
        />
        {/* terisi */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${rasio * 100}%`,
            height: drag ? 4 : 2,
            background: "var(--accent)",
            transition: drag ? "none" : "height 120ms ease",
          }}
        />
        {/* gagang: hanya terlihat saat drag/hover supaya tidak berisik */}
        <div
          style={{
            position: "absolute",
            left: `calc(${rasio * 100}% - 5px)`,
            width: 10,
            height: 10,
            background: "var(--accent)",
            border: "1px solid var(--line-strong)",
            opacity: bisa ? (drag ? 1 : 0.55) : 0,
            transition: "opacity 120ms ease",
            pointerEvents: "none",
          }}
        />
      </div>

      <span className="mono muted" style={{ fontSize: 12, minWidth: 42 }}>
        {formatDuration(durationMs)}
      </span>
    </div>
  );
}
