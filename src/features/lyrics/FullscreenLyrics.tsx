import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsResponse, Track } from "../../types";
import { audioEngine } from "../../lib/audio";
import { T } from "../../lib/strings";
import {
  IkonFullscreenExit,
  IkonNext,
  IkonPause,
  IkonPlay,
  IkonPrev,
} from "../../components/icons";
import { invoke, runningInTauri } from "../../lib/tauri";

type UkuranFont = "kecil" | "sedang" | "besar";

/**
 * Tampilan Layar Penuh (Fullscreen) Lirik — L4 `FEATURES-V3.md`.
 *
 * Spesifikasi (§4 L4):
 * - Tampilan nyaman dibaca dari jarak dekat maupun jauh (tipografi besar, kontras tinggi).
 * - Tombol `Esc` untuk menutup layar penuh.
 * - Pengaturan ukuran font: Kecil (18px), Sedang (24px), Besar (32px), disimpan ke DB `lirik.ukuran_font`.
 * - Mode redup (dimmed mode) untuk mendengarkan santai tanpa silau.
 * - Kontrol playback minimal (Play/Pause/Prev/Next/SeekBar).
 * - Click line to seek.
 */
export function FullscreenLyrics({
  track,
  lyricsData,
  isPlaying,
  onClose,
  onSeek,
  onToggle,
  onNext,
  onPrevious,
}: {
  track: Track | null;
  lyricsData: LyricsResponse | null;
  isPlaying: boolean;
  onClose: () => void;
  onSeek?: (ms: number) => void;
  onToggle?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}) {
  const [ukuranFont, setUkuranFont] = useState<UkuranFont>("sedang");
  const [modeRedup, setModeRedup] = useState(false);
  const [tampilRomanisasi, setTampilRomanisasi] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [userScrolled, setUserScrolled] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const userScrolledRef = useRef(userScrolled);
  userScrolledRef.current = userScrolled;

  const dataRef = useRef(lyricsData);
  dataRef.current = lyricsData;

  // Baca setting ukuran font tersimpan saat dibuka
  useEffect(() => {
    if (!runningInTauri) return;
    invoke<string | null>("setting_get", { key: "lirik.ukuran_font" })
      .then((val) => {
        if (val === "kecil" || val === "sedang" || val === "besar") {
          setUkuranFont(val);
        }
      })
      .catch(() => {});
  }, []);

  const gantiUkuran = (ukuran: UkuranFont) => {
    setUkuranFont(ukuran);
    if (runningInTauri) {
      void invoke("setting_set", { key: "lirik.ukuran_font", value: ukuran }).catch(() => {});
    }
  };

  // Tutup dengan keyboard Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === " " && e.target === document.body) {
        e.preventDefault();
        onToggle?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onToggle]);

  // Sinkronisasi posisi audio
  useEffect(() => {
    if (!isPlaying || !lyricsData?.parsed.is_synced || lyricsData.parsed.lines.length === 0) {
      return;
    }

    let rafId: number;

    const tick = () => {
      if (document.hidden) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const current = dataRef.current;
      if (!current || !current.parsed.is_synced) return;

      const lines = current.parsed.lines;
      const currentPos = audioEngine.positionMs();
      const effectivePos = currentPos + current.parsed.file_offset_ms + current.offset_ms;

      let low = 0;
      let high = lines.length - 1;
      let targetIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lines[mid].time_ms <= effectivePos) {
          targetIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      setActiveIndex(targetIdx);

      if (!userScrolledRef.current && targetIdx >= 0) {
        const el = lineRefs.current[targetIdx];
        if (el && containerRef.current) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, lyricsData]);

  const scrollToActive = useCallback(() => {
    setUserScrolled(false);
    if (activeIndex >= 0) {
      const el = lineRefs.current[activeIndex];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeIndex]);

  const fontSizeVal =
    ukuranFont === "kecil" ? "18px" : ukuranFont === "besar" ? "32px" : "24px";
  const lineHeightVal =
    ukuranFont === "kecil" ? 1.6 : ukuranFont === "besar" ? 1.4 : 1.5;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={T.fullscreenLirik}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: modeRedup ? "#050505" : "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        backdropFilter: "blur(20px)",
      }}
    >
      {/* Header Bar */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "var(--s-4) var(--s-5)",
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--ink)",
            }}
          >
            {track?.title ?? T.belumAdaLagu}
          </span>
          <span className="muted" style={{ fontSize: 13 }}>
            {track?.artist ?? "—"}
          </span>
        </div>

        {/* Toolbar Pengaturan Fullscreen */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)" }}>
          {/* Opsi Ukuran Font */}
          <div
            role="group"
            aria-label={T.ukuranFontLirik}
            style={{ display: "flex", gap: 2, background: "var(--panel-2)", padding: 2 }}
          >
            {(["kecil", "sedang", "besar"] as const).map((u) => {
              const aktif = ukuranFont === u;
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => gantiUkuran(u)}
                  aria-pressed={aktif}
                  className="mono"
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    border: aktif ? "1px solid var(--accent)" : "1px solid transparent",
                    background: aktif ? "var(--accent)" : "transparent",
                    color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
                    fontWeight: aktif ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {u.toUpperCase()}
                </button>
              );
            })}
          </div>

          {/* Toggle Romanisasi */}
          <button
            type="button"
            onClick={() => setTampilRomanisasi((r) => !r)}
            aria-pressed={tampilRomanisasi}
            className="mono"
            style={{
              padding: "4px 8px",
              fontSize: 10,
              border: tampilRomanisasi ? "1px solid var(--accent)" : "1px solid var(--line)",
              background: tampilRomanisasi ? "var(--accent)" : "transparent",
              color: tampilRomanisasi ? "var(--accent-ink)" : "var(--ink-muted)",
              cursor: "pointer",
            }}
          >
            {T.romanisasi}
          </button>

          {/* Toggle Mode Redup */}
          <button
            type="button"
            onClick={() => setModeRedup((r) => !r)}
            aria-pressed={modeRedup}
            className="mono"
            style={{
              padding: "4px 8px",
              fontSize: 10,
              border: modeRedup ? "1px solid var(--accent)" : "1px solid var(--line)",
              background: modeRedup ? "var(--accent)" : "transparent",
              color: modeRedup ? "var(--accent-ink)" : "var(--ink-muted)",
              cursor: "pointer",
            }}
          >
            {T.modeRedup}
          </button>

          {/* Tombol Tutup / Esc */}
          <button
            type="button"
            onClick={onClose}
            aria-label={T.keluarFullscreen}
            title={T.keluarFullscreen}
            style={{
              width: 36,
              height: 36,
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink)",
              cursor: "pointer",
            }}
          >
            <IkonFullscreenExit size={20} />
          </button>
        </div>
      </header>

      {/* Konten Lirik Tengah */}
      <main
        ref={containerRef}
        onWheel={() => setUserScrolled(true)}
        onTouchMove={() => setUserScrolled(true)}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "var(--s-6) var(--s-5)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          scrollBehavior: "smooth",
          maxWidth: 900,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {lyricsData && lyricsData.parsed.lines.length > 0 ? (
          lyricsData.parsed.lines.map((line, idx) => {
            const aktif = lyricsData.parsed.is_synced && idx === activeIndex;

            return (
              <div
                key={idx}
                ref={(el) => {
                  lineRefs.current[idx] = el;
                }}
                onClick={() => {
                  if (lyricsData.parsed.is_synced && onSeek) {
                    const targetSeek = Math.max(
                      0,
                      line.time_ms - lyricsData.parsed.file_offset_ms - lyricsData.offset_ms,
                    );
                    onSeek(targetSeek);
                    setUserScrolled(false);
                  }
                }}
                role={lyricsData.parsed.is_synced ? "button" : undefined}
                tabIndex={lyricsData.parsed.is_synced ? 0 : undefined}
                style={{
                  fontSize: fontSizeVal,
                  lineHeight: lineHeightVal,
                  fontWeight: aktif ? 700 : 500,
                  transition: "all 0.2s ease",
                  cursor: lyricsData.parsed.is_synced ? "pointer" : "default",
                  color: aktif
                    ? "var(--accent)"
                    : modeRedup
                      ? "rgba(255, 255, 255, 0.25)"
                      : "var(--ink-muted)",
                  opacity: aktif ? 1 : modeRedup ? 0.35 : 0.65,
                  transform: aktif ? "scale(1.03)" : "scale(1)",
                  transformOrigin: "left center",
                  padding: "8px 16px",
                  borderRadius: 0,
                  borderLeft: aktif ? "4px solid var(--accent)" : "4px solid transparent",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span>{line.text}</span>
                  {tampilRomanisasi && line.romanized && (
                    <span
                      style={{
                        fontSize: `calc(${fontSizeVal} * 0.65)`,
                        lineHeight: 1.3,
                        opacity: 0.8,
                        fontStyle: "italic",
                        fontWeight: 400,
                      }}
                    >
                      {line.romanized}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <p className="muted" style={{ fontSize: 16 }}>
              {T.lirikTidakAda}
            </p>
          </div>
        )}
      </main>

      {/* Floating Button: Kembali ke baris aktif */}
      {userScrolled && activeIndex >= 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={scrollToActive}
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              padding: "8px 16px",
              border: "1px solid var(--accent)",
              background: "var(--accent)",
              color: "var(--accent-ink)",
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            {T.kembaliKeBarisAktif}
          </button>
        </div>
      )}

      {/* Footer Minimal Transport Control */}
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--s-4)",
          padding: "var(--s-3) var(--s-5)",
          borderTop: "1px solid var(--line)",
          background: "var(--panel)",
        }}
      >
        <button
          type="button"
          onClick={onPrevious}
          disabled={!onPrevious}
          aria-label={T.laguSebelumnya}
          style={{
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <IkonPrev size={18} />
        </button>

        <button
          type="button"
          onClick={onToggle}
          disabled={!onToggle}
          aria-label={isPlaying ? T.jeda : T.putar}
          style={{
            width: 50,
            height: 50,
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--accent)",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            cursor: "pointer",
          }}
        >
          {isPlaying ? <IkonPause size={22} /> : <IkonPlay size={22} />}
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={!onNext}
          aria-label={T.laguBerikutnya}
          style={{
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            border: "1px solid var(--line)",
            background: "transparent",
            color: "var(--ink)",
            cursor: "pointer",
          }}
        >
          <IkonNext size={18} />
        </button>
      </footer>
    </div>
  );
}
