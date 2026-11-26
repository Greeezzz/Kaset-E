import type { PlayerState } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { T } from "../../lib/strings";
import {
  IkonPlay,
  IkonPause,
  IkonPrev,
  IkonNext,
  IkonKaset,
  IkonLirikMic,
  IkonQueueLayers,
  IkonExpandDiagonal,
} from "../../components/icons";

/**
 * Player bar tiga zona ("control deck", DESIGN-LAYOUT §6, DESIGN-ENDFIELD §6).
 *
 * Hirarki:
 * - Zona kiri: cover 56px + identitas lagu.
 * - Zona tengah: transport controls + seek bar.
 * - Zona kanan: Deretan aksi ikon SVG (Kaset, Mic/Lirik, Queue/Layers, Divider, Volume, Fullscreen/Expand).
 */
export function PlayerBar({
  state,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onVolume,
  onToggleKaset,
  onToggleLyrics,
  onToggleQueue,
  onOpenFullscreen,
  kasetActive = false,
  lyricsActive = false,
  queueOpen = false,
}: {
  state: PlayerState;
  onToggle: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (positionMs: number) => void;
  onVolume?: (volume: number) => void;
  onToggleKaset?: () => void;
  onToggleLyrics?: () => void;
  onToggleQueue?: () => void;
  onOpenFullscreen?: () => void;
  kasetActive?: boolean;
  lyricsActive?: boolean;
  queueOpen?: boolean;
}) {
  const playing = state.status === "playing";
  const loading = state.status === "loading";
  const failed = state.status === "error";
  const ada = Boolean(state.track);

  return (
    <footer
      aria-label="Kontrol pemutar"
      style={{
        height: "var(--playerbar-h)",
        flex: "0 0 var(--playerbar-h)",
        borderTop: "1px solid var(--line)",
        background: "var(--panel)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 2.2fr) minmax(0, 1.25fr)",
        alignItems: "center",
        gap: "var(--s-4)",
        padding: "0 var(--s-4)",
        overflow: "hidden",
      }}
    >
      {/* Zona kiri: cover 56px dengan corner brackets + identitas lagu. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-3)",
          minWidth: 0,
          textAlign: "left",
          padding: 0,
        }}
      >
        <span
          className="bracketed"
          style={{
            padding: 3,
            flex: "0 0 auto",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            display: "inline-flex",
          }}
        >
          {ada ? (
            <CoverArt
              coverKey={state.track!.coverKey}
              title={state.track!.title}
              size={56}
              radius={0}
            />
          ) : (
            <span
              style={{
                width: 56,
                height: 56,
                display: "block",
                background: "var(--panel-2)",
              }}
              aria-hidden="true"
            />
          )}
        </span>

        <div style={{ minWidth: 0, overflow: "hidden" }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {state.track?.title ?? T.belumAdaLagu}
          </div>
          <div
            className="muted"
            style={{
              fontSize: 12,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {failed ? "Gagal memutar audio" : (state.track?.artist ?? "\u2014")}
          </div>
        </div>
      </div>

      {/* Zona tengah: kontrol transport + seek bar. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--s-1)",
          minWidth: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
          <TombolIkon label={T.laguSebelumnya} onClick={onPrevious} disabled={!ada || !onPrevious}>
            <IkonPrev size={16} />
          </TombolIkon>

          <button
            type="button"
            onClick={onToggle}
            disabled={!ada}
            aria-label={playing ? T.jeda : T.putar}
            title={playing ? T.jeda : T.putar}
            style={{
              width: 52,
              height: 52,
              background: "var(--accent)",
              color: "var(--accent-ink)",
              border: "1px solid #111111",
              display: "grid",
              placeItems: "center",
              cursor: ada ? "pointer" : "not-allowed",
              opacity: ada ? 1 : 0.5,
              clipPath:
                "polygon(var(--cut-sm) 0, 100% 0, 100% calc(100% - var(--cut-sm)), calc(100% - var(--cut-sm)) 100%, 0 100%, 0 var(--cut-sm))",
            }}
          >
            {loading ? (
              <span aria-hidden="true" style={{ fontSize: 18, letterSpacing: 1 }}>
                {"\u2026"}
              </span>
            ) : playing ? (
              <IkonPause size={20} />
            ) : (
              <IkonPlay size={20} />
            )}
          </button>

          <TombolIkon label={T.laguBerikutnya} onClick={onNext} disabled={!ada || !onNext}>
            <IkonNext size={16} />
          </TombolIkon>
        </div>

        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          onSeek={(ms) => onSeek?.(ms)}
          disabled={!ada || !onSeek}
          loading={loading}
        />
      </div>

      {/* Zona kanan: Icon-Only SVG Controls (Kaset, Mic, Queue, Divider, Volume, Expand) */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
        }}
      >
        {/* 1. Mode Kaset */}
        {onToggleKaset && (
          <TombolAksiIkon
            label="Mode Kaset"
            aktif={kasetActive}
            onClick={onToggleKaset}
            title="Tampilkan Mode Kaset"
          >
            <IkonKaset size={18} />
          </TombolAksiIkon>
        )}

        {/* 2. Lirik (Mic) */}
        {onToggleLyrics && (
          <TombolAksiIkon
            label="Lirik Lagu"
            aktif={lyricsActive}
            onClick={onToggleLyrics}
            title="Tampilkan Lirik"
          >
            <IkonLirikMic size={18} />
          </TombolAksiIkon>
        )}

        {/* 3. Panel Kanan (Queue/Layers) */}
        {onToggleQueue && (
          <TombolAksiIkon
            label="Panel Antrean & Sedang Diputar"
            aktif={queueOpen}
            onClick={onToggleQueue}
            title="Buka / Tutup Panel Kanan (Ctrl+Q)"
          >
            <IkonQueueLayers size={18} />
          </TombolAksiIkon>
        )}

        {/* Divider Vertikal */}
        <div
          style={{
            width: 1,
            height: 20,
            background: "var(--line)",
            margin: "0 2px",
          }}
          aria-hidden="true"
        />

        {/* Volume */}
        {onVolume ? (
          <VolumeControl volume={state.volume} onChange={onVolume} />
        ) : (
          <span className="muted mono" style={{ fontSize: 12 }}>
            {Math.round(state.volume * 100)}%
          </span>
        )}

        {/* 4. Fullscreen / Expand */}
        {onOpenFullscreen && (
          <TombolAksiIkon
            label="Layar Penuh"
            aktif={false}
            onClick={onOpenFullscreen}
            title="Layar Penuh (Fullscreen)"
          >
            <IkonExpandDiagonal size={18} />
          </TombolAksiIkon>
        )}
      </div>
    </footer>
  );
}

/**
 * Tombol aksi ikon SVG kanan bawah dengan status aktif kuning Endfield.
 */
function TombolAksiIkon({
  children,
  label,
  title,
  aktif = false,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  label: string;
  title?: string;
  aktif?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={aktif}
      title={title ?? label}
      style={{
        width: 36,
        height: 36,
        minWidth: 36,
        display: "grid",
        placeItems: "center",
        background: aktif ? "var(--accent)" : "transparent",
        color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
        border: aktif ? "1px solid #111111" : "1px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--t-fast) var(--ease), color var(--t-fast) var(--ease)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Tombol ikon tanpa latar (area sentuh 44x44px).
 */
function TombolIkon({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 44,
        height: 44,
        display: "grid",
        placeItems: "center",
        fontSize: 14,
        background: "transparent",
        border: "none",
        color: disabled ? "var(--ink-muted)" : "var(--ink)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
