import type { PlayerState } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { SeekBar } from "./SeekBar";
import { VolumeControl } from "./VolumeControl";
import { T } from "../../lib/strings";
import { IkonPlay, IkonPause, IkonPrev, IkonNext } from "../../components/icons";

/**
 * Player bar tiga zona ("control deck", DESIGN-LAYOUT §6, DESIGN-ENDFIELD §6).
 *
 * Hirarki yang dipegang: tombol play/pause adalah elemen paling besar dan
 * satu-satunya yang berlatar kuning chamfer penuh. Kontrol lain tanpa latar
 * kecuali saat aktif/hover supaya mata langsung jatuh ke satu tempat. Tinggi
 * bar tetap (88px) agar perubahan state tidak pernah menggeser layout.
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
        // minmax(0, ...) supaya judul panjang tidak mendorong kolom lain keluar.
        gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 2.2fr) minmax(0, 1fr)",
        alignItems: "center",
        gap: "var(--s-4)",
        padding: "0 var(--s-4)",
        overflow: "hidden",
      }}
    >
      {/* Zona kiri: cover 56px dengan corner brackets + identitas lagu. */}
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
            <CoverArt coverKey={null} title="Kaset" size={56} radius={0} />
          )}
        </span>

        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--s-2)",
              minWidth: 0,
            }}
          >
            <span
              className={ada ? undefined : "mono"}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: ada ? 14 : 12,
                letterSpacing: ada ? undefined : "0.1em",
                fontWeight: 600,
                color: ada ? "var(--ink)" : "var(--ink-muted)",
              }}
            >
              {state.track?.title ?? T.standby}
            </span>

            {/* Tampilkan label status HANYA saat loading/error (tanpa teks debug idle). */}
            {loading && (
              <span
                className="mono"
                style={{
                  flex: "0 0 auto",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  padding: "1px 5px",
                  border: "1px solid var(--line)",
                  color: "var(--ink-muted)",
                }}
              >
                {T.memuat}
              </span>
            )}
            {failed && (
              <span
                className="mono"
                style={{
                  flex: "0 0 auto",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  padding: "1px 5px",
                  border: "1px solid var(--danger)",
                  color: "var(--danger)",
                }}
              >
                {T.gagal}
              </span>
            )}
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

      {/* Zona tengah: transport + progress bersegmen */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <TombolIkon label={T.laguSebelumnya} onClick={onPrevious} disabled={!ada || !onPrevious}>
            <IkonPrev size={16} />
          </TombolIkon>

          {/* Elemen paling mencolok di bar: blok kuning chamfer, ikon hitam. */}
          <button
            type="button"
            onClick={onToggle}
            disabled={!ada}
            aria-label={playing ? T.jeda : T.putar}
            style={{
              width: 48,
              height: 44,
              display: "grid",
              placeItems: "center",
              fontSize: 16,
              fontWeight: 700,
              border: ada ? "none" : "1px solid var(--line)",
              background: ada ? "var(--accent)" : "var(--panel-2)",
              color: ada ? "var(--accent-ink)" : "var(--ink-muted)",
              clipPath: ada
                ? "polygon(var(--cut-sm) 0, 100% 0, 100% calc(100% - var(--cut-sm)), calc(100% - var(--cut-sm)) 100%, 0 100%, 0 var(--cut-sm))"
                : undefined,
              cursor: ada ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "\u2026" : playing ? <IkonPause size={18} /> : <IkonPlay size={18} />}
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

      {/* Zona kanan: tombol ANTREAN + volume */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "var(--s-2)",
          minWidth: 0,
        }}
      >
        {onToggleQueue ? (
          <button
            type="button"
            onClick={onToggleQueue}
            aria-label={T.antrean}
            aria-pressed={queueOpen}
            title={`${T.antrean} (Ctrl+Q)`}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              display: "flex",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              fontWeight: queueOpen ? 600 : 400,
              // Tanpa latar saat pasif; blok kuning + teks hitam saat aktif.
              background: queueOpen ? "var(--accent)" : "transparent",
              color: queueOpen ? "var(--accent-ink)" : "var(--ink)",
              border: queueOpen ? "1px solid var(--accent)" : "1px solid transparent",
              cursor: "pointer",
            }}
          >
            {T.antrean}
          </button>
        ) : null}

        {onVolume ? (
          <VolumeControl volume={state.volume} onChange={onVolume} />
        ) : (
          <span className="muted mono" style={{ fontSize: 12 }}>
            {Math.round(state.volume * 100)}%
          </span>
        )}
      </div>
    </footer>
  );
}

/**
 * Tombol ikon tanpa latar (area sentuh 44x44px, DESIGN-LAYOUT §6 & §8).
 * Disabled dibedakan jelas lewat warna muted dan cursor not-allowed.
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
