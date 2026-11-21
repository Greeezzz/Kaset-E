import type { PlayerState } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { T } from "../../lib/strings";

/**
 * Player bar tiga zona (DESIGN-LAYOUT bagian 6).
 *
 * Hirarki yang dipegang: tombol play/pause adalah elemen paling besar dan
 * satu-satunya yang berlatar kuning penuh. Kontrol lain tanpa latar supaya
 * mata langsung jatuh ke satu tempat. Tinggi bar tetap, jadi perubahan state
 * tidak menggeser layout.
 */
export function PlayerBar({
  state,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onVolume,
  onToggleQueue,
  onOpenNowPlaying,
  queueOpen = false,
}: {
  state: PlayerState;
  onToggle: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (positionMs: number) => void;
  onVolume?: (volume: number) => void;
  onToggleQueue?: () => void;
  onOpenNowPlaying?: () => void;
  queueOpen?: boolean;
}) {
  const playing = state.status === "playing";
  const loading = state.status === "loading";
  const ada = Boolean(state.track);

  return (
    <div
      style={{
        height: "var(--playerbar-h)",
        borderTop: "1px solid var(--line)",
        background: "var(--panel)",
        display: "grid",
        // minmax(0, ...) supaya judul panjang tidak mendorong kolom lain keluar.
        gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 2.2fr) minmax(0, 1fr)",
        alignItems: "center",
        gap: "var(--s-4)",
        padding: "0 var(--s-4)",
      }}
    >
      {/* Zona kiri: identitas lagu (klik membuka tab SEDANG DIPUTAR). */}
      <button
        type="button"
        onClick={onOpenNowPlaying}
        disabled={!onOpenNowPlaying}
        aria-label={T.bukaSedangDiputar}
        title={T.bukaSedangDiputar}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-3)",
          minWidth: 0,
          textAlign: "left",
          padding: 0,
          cursor: onOpenNowPlaying ? "pointer" : "default",
        }}
      >
        {ada ? (
          <CoverArt
            coverKey={state.track!.coverKey}
            title={state.track!.title}
            size={52}
            radius={0}
          />
        ) : (
          <CoverArt coverKey={null} title="Kaset" size={52} radius={0} />
        )}
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: ada ? 600 : 400,
              color: ada ? "var(--ink)" : "var(--ink-muted)",
            }}
          >
            {state.track?.title ?? T.standby}
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
            {state.track?.artist ?? "\u2014"}
          </span>
        </span>
      </button>

      {/* Zona tengah: transport + progress */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <TombolIkon label={T.laguSebelumnya} onClick={onPrevious} disabled={!ada || !onPrevious}>
            {"\u23ee"}
          </TombolIkon>

          {/* Elemen paling mencolok di bar: blok kuning, ikon hitam. */}
          <button
            type="button"
            onClick={onToggle}
            disabled={!ada}
            aria-label={playing ? T.jeda : T.putar}
            style={{
              width: 44,
              height: 40,
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              border: "1px solid var(--accent)",
              background: ada ? "var(--accent)" : "transparent",
              color: ada ? "var(--accent-ink)" : "var(--ink-muted)",
              cursor: ada ? "pointer" : "default",
              opacity: ada ? 1 : 0.45,
            }}
          >
            {loading ? "\u2026" : playing ? "\u2759\u2759" : "\u25b6"}
          </button>

          <TombolIkon label={T.laguBerikutnya} onClick={onNext} disabled={!ada || !onNext}>
            {"\u23ed"}
          </TombolIkon>
        </div>

        <SeekBar
          positionMs={state.positionMs}
          durationMs={state.durationMs}
          onSeek={(ms) => onSeek?.(ms)}
          disabled={!ada || !onSeek}
        />
      </div>

      {/* Zona kanan: antrean + volume */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        {onToggleQueue ? (
          <button
            type="button"
            onClick={onToggleQueue}
            aria-label={T.antrean}
            aria-pressed={queueOpen}
            title={`${T.antrean} (Ctrl+Q)`}
            style={{
              minHeight: 32,
              padding: "0 10px",
              display: "flex",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              // Aktif = blok kuning + teks hitam (aturan kontras Endfield).
              background: queueOpen ? "var(--accent)" : "transparent",
              color: queueOpen ? "var(--accent-ink)" : "var(--ink-muted)",
              border: queueOpen ? "1px solid var(--accent)" : "1px solid var(--line)",
              cursor: "pointer",
            }}
          >
            {T.antrean}
          </button>
        ) : null}

        {onVolume ? (
          <VolumeControl volume={state.volume} onChange={onVolume} />
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            {Math.round(state.volume * 100)}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Tombol ikon tanpa latar. Kotak sentuhnya 40px walau ikonnya kecil, dan
 * tidak diberi latar supaya tidak bersaing dengan tombol play.
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
        width: 40,
        height: 40,
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        background: "transparent",
        border: "none",
        color: disabled ? "var(--ink-muted)" : "var(--ink)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
