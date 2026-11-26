import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsResponse, Track } from "../../types";
import { audioEngine } from "../../lib/audio";
import { T } from "../../lib/strings";
import { CoverArt } from "../../components/CoverArt";
import { useCover } from "../../hooks/useCover";
import { SeekBar } from "../player/SeekBar";
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
 * Tampilan Layar Penuh (Fullscreen) Lirik — Refactor Spec §4 B.
 *
 * Fitur:
 * - Ambient cover art blur 80px + opacity 0.08 di belakang grid 24x24px.
 * - Header: Info lagu ringkas (Cover kecil + Judul + Artis) di kiri atas, kontrol font/romaji/redup/close di kanan atas.
 * - Lirik: Tipografi nyaman (Sedang 28px, Besar 36px), scrollbar visual tersembunyi, kontainer max-width 820px.
 * - Footer: Control Deck lengkap (Progress Bar bersegmen + timestamp kiri/kanan + tombol Prev, Play/Pause, Next).
 * - Keyboard: Esc untuk keluar, Space untuk play/pause.
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
  positionMs = 0,
  durationMs = 0,
}: {
  track: Track | null;
  lyricsData: LyricsResponse | null;
  isPlaying: boolean;
  onClose: () => void;
  onSeek?: (ms: number) => void;
  onToggle?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  positionMs?: number;
  durationMs?: number;
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

  const coverUrl = useCover(track?.coverKey);

  // Baca setting ukuran font tersimpan
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

  // Keyboard shortcut Esc & Space
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

      const currentData = dataRef.current;
      if (!currentData || !currentData.parsed.is_synced) return;

      const lines = currentData.parsed.lines;
      const currentPos = audioEngine.positionMs();
      const effectivePos = currentPos + currentData.parsed.file_offset_ms + currentData.offset_ms;

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

      setActiveIndex((prev) => {
        if (targetIdx !== prev) {
          if (!userScrolledRef.current && targetIdx >= 0) {
            const el = lineRefs.current[targetIdx];
            if (el && containerRef.current) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }
          return targetIdx;
        }
        return prev;
      });

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

  const fontSizeMap: Record<UkuranFont, { main: number; romaji: number }> = {
    kecil: { main: 20, romaji: 13 },
    sedang: { main: 28, romaji: 16 },
    besar: { main: 36, romaji: 19 },
  };

  const { main: fsMain, romaji: fsRomaji } = fontSizeMap[ukuranFont];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: modeRedup ? "#080809" : "var(--bg)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundImage: `linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
      }}
    >
      {/* Ambient Cover Art Blur di belakang */}
      {coverUrl && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${coverUrl})`,
            backgroundPosition: "center",
            backgroundSize: "cover",
            filter: "blur(80px)",
            opacity: 0.08,
            pointerEvents: "none",
            transform: "scale(1.2)",
          }}
        />
      )}

      {/* Header Fullscreen: Info Lagu Kiri Atas & Kontrol Kanan Atas */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--s-4) var(--s-6)",
          borderBottom: "1px solid var(--line)",
          background: "rgba(0,0,0,0.3)",
          backdropFilter: "blur(8px)",
          flex: "0 0 auto",
          zIndex: 10,
        }}
      >
        {/* Info lagu kiri atas */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", minWidth: 0 }}>
          {track && (
            <div
              className="bracketed"
              style={{ padding: 2, background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              <CoverArt coverKey={track.coverKey} title={track.title} size={44} radius={0} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 18,
                fontWeight: 700,
                margin: 0,
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 420,
              }}
            >
              {track?.title ?? T.belumAdaLagu}
            </h1>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>
              {track?.artist ?? "—"}
            </p>
          </div>
        </div>

        {/* Kontrol kanan atas */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
          {/* Toggle Romanisasi */}
          <button
            type="button"
            onClick={() => setTampilRomanisasi((r) => !r)}
            className={`k-btn ${tampilRomanisasi ? "k-btn-accent" : "k-btn-quiet"}`}
            style={{ minHeight: 32, height: 32, padding: "0 10px", fontSize: 10 }}
            title="Tampilkan Romaji"
          >
            ROMAJI
          </button>

          {/* Toggle Ukuran Font */}
          <div
            style={{ display: "flex", border: "1px solid var(--line)", background: "var(--panel)" }}
          >
            {(["kecil", "sedang", "besar"] as const).map((uk) => (
              <button
                key={uk}
                type="button"
                onClick={() => gantiUkuran(uk)}
                className="mono"
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  border: "none",
                  background: ukuranFont === uk ? "var(--accent)" : "transparent",
                  color: ukuranFont === uk ? "var(--accent-ink)" : "var(--ink-muted)",
                  fontWeight: ukuranFont === uk ? 700 : 400,
                  cursor: "pointer",
                }}
              >
                {uk === "kecil" ? "S" : uk === "sedang" ? "M" : "L"}
              </button>
            ))}
          </div>

          {/* Mode Redup */}
          <button
            type="button"
            onClick={() => setModeRedup((m) => !m)}
            className={`k-btn ${modeRedup ? "k-btn-accent" : "k-btn-quiet"}`}
            style={{ minHeight: 32, height: 32, padding: "0 10px", fontSize: 10 }}
            title="Mode Redup"
          >
            {T.modeRedup}
          </button>

          {/* Tutup Fullscreen (Esc) */}
          <button
            type="button"
            onClick={onClose}
            className="k-btn"
            style={{ minHeight: 32, height: 32, padding: "0 10px", fontSize: 11 }}
            title="Keluar Layar Penuh (Esc)"
          >
            <IkonFullscreenExit size={16} />
            <span style={{ marginLeft: 4 }}>ESC</span>
          </button>
        </div>
      </header>

      {/* Main Container Lirik Tengah: Mask Fade + Max Width 820px */}
      <main
        ref={containerRef}
        onWheel={() => setUserScrolled(true)}
        onTouchMove={() => setUserScrolled(true)}
        className="lyrics-scroll-mask"
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "var(--s-12) var(--s-6)",
          scrollBehavior: "smooth",
          zIndex: 10,
          scrollbarWidth: "none",
        }}
      >
        {lyricsData && lyricsData.parsed.lines.length > 0 ? (
          <div
            style={{
              width: "100%",
              maxWidth: 820,
              display: "flex",
              flexDirection: "column",
              gap: ukuranFont === "besar" ? 28 : ukuranFont === "sedang" ? 20 : 14,
            }}
          >
            {lyricsData.parsed.lines.map((line, idx) => {
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
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 16,
                    padding: "6px 16px",
                    cursor: lyricsData.parsed.is_synced ? "pointer" : "default",
                    transition: "all 0.2s ease",
                    borderLeft: aktif ? "4px solid var(--accent)" : "4px solid transparent",
                    opacity: aktif ? 1 : activeIndex >= 0 ? 0.35 : 0.85,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                    <span
                      style={{
                        fontSize: fsMain,
                        fontWeight: aktif ? 700 : 500,
                        lineHeight: 1.35,
                        color: aktif ? (modeRedup ? "var(--accent)" : "var(--ink)") : "var(--ink)",
                        transition: "font-size 0.2s ease",
                      }}
                    >
                      {line.text}
                    </span>
                    {tampilRomanisasi && line.romanized && (
                      <span
                        className="mono muted"
                        style={{
                          fontSize: fsRomaji,
                          lineHeight: 1.3,
                          letterSpacing: "0.02em",
                          opacity: aktif ? 0.9 : 0.6,
                        }}
                      >
                        {line.romanized}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ margin: "auto", textAlign: "center" }}>
            <p className="muted" style={{ fontSize: 18 }}>
              {T.lirikTidakAda}
            </p>
          </div>
        )}
      </main>

      {/* Floating: Kembali ke baris aktif */}
      {userScrolled && activeIndex >= 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 96,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={scrollToActive}
            className="k-btn k-btn-accent"
            style={{
              padding: "0 18px",
              minHeight: 36,
              height: 36,
              fontSize: 11,
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            }}
          >
            {T.kembaliKeBarisAktif}
          </button>
        </div>
      )}

      {/* Footer: Control Deck Lengkap (Progress bar bersegmen + Transport) */}
      <footer
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s-2)",
          padding: "var(--s-3) var(--s-8)",
          borderTop: "1px solid var(--line)",
          background: "rgba(0,0,0,0.4)",
          backdropFilter: "blur(10px)",
          flex: "0 0 auto",
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            width: "100%",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <SeekBar
            positionMs={positionMs}
            durationMs={durationMs}
            onSeek={(ms) => onSeek?.(ms)}
            disabled={!track || !onSeek}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--s-3)",
            }}
          >
            <button
              type="button"
              onClick={onPrevious}
              disabled={!onPrevious}
              aria-label={T.laguSebelumnya}
              className="k-btn"
              style={{ width: 44, height: 44 }}
            >
              <IkonPrev size={18} />
            </button>

            <button
              type="button"
              onClick={onToggle}
              disabled={!onToggle}
              aria-label={isPlaying ? T.jeda : T.putar}
              className="k-btn k-btn-accent"
              style={{ width: 52, height: 52 }}
            >
              {isPlaying ? <IkonPause size={22} /> : <IkonPlay size={22} />}
            </button>

            <button
              type="button"
              onClick={onNext}
              disabled={!onNext}
              aria-label={T.laguBerikutnya}
              className="k-btn"
              style={{ width: 44, height: 44 }}
            >
              <IkonNext size={18} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
