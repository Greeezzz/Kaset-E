import { lazy, Suspense } from "react";
import type { PlayerState, QueueItem } from "../../types";
import type { ModeNowPlaying } from "../../hooks/useModeNowPlaying";
import { CoverArt } from "../../components/CoverArt";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";
import { IkonTutup } from "../../components/icons";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";

/**
 * Layar pemutar penuh (mobile). Slide-up dari mini player — DESIGN.md §3/§4.
 * Fase 0: menampilkan state + antrean; kontrol play/seek menyusul di Fase 1.
 */
/**
 * Mode kaset dimuat malas: selama pengguna memakai mode standar, bundelnya
 * tidak pernah diunduh. Itu syarat §0.2 di `FEATURES-V3.md` — fitur opsional
 * tidak boleh membebani jalur yang tidak memakainya.
 */
const KasetMode = lazy(() => import("./KasetMode").then((m) => ({ default: m.KasetMode })));
const LyricsView = lazy(() => import("../lyrics/LyricsView").then((m) => ({ default: m.LyricsView })));

export function FullPlayer({
  state,
  queue,
  onClose,
  mode = "standar",
  onModeChange,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
}: {
  state: PlayerState;
  queue: QueueItem[];
  onClose: () => void;
  /** Mode tampilan aktif (K1). Default `standar` = perilaku lama. */
  mode?: ModeNowPlaying;
  /** Ganti mode. Kalau tidak diberikan, switcher tidak ditampilkan. */
  onModeChange?: (m: ModeNowPlaying) => void;
  /**
   * Handler transport — SAMA yang dipakai `PlayerBar` (§K4: "Prev/Play/Next
   * memakai handler yang sama"). Diteruskan apa adanya ke `KasetMode`; tidak
   * ada logika pemutaran di layar ini.
   */
  onToggle?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (positionMs: number) => void;
}) {
  const progress = state.durationMs > 0 ? Math.min(1, state.positionMs / state.durationMs) : 0;

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "var(--s-4)",
        gap: "var(--s-4)",
        overflowY: "auto",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 16 }}>{T.sedangDiputar}</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label={T.tutupPemutarPenuh}
          style={{
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-muted)",
          }}
        >
          <IkonTutup size={18} />
        </button>
      </header>

      {onModeChange && (
        <div
          role="group"
          aria-label={T.modeTampilan}
          style={{ display: "flex", gap: 4, justifyContent: "center" }}
        >
          {(["standar", "kaset"] as const).map((m) => {
            const aktif = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => onModeChange(m)}
                aria-pressed={aktif}
                className="mono"
                style={{
                  minHeight: 32,
                  padding: "0 10px",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  border: aktif ? "1px solid var(--accent)" : "1px solid var(--line)",
                  background: aktif ? "var(--accent)" : "transparent",
                  color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
                  fontWeight: aktif ? 600 : 400,
                }}
              >
                {m === "standar" ? T.modeStandar : T.modeKaset}
              </button>
            );
          })}
        </div>
      )}

      {mode === "kaset" ? (
        <Suspense
          fallback={
            <p className="mono muted" style={{ textAlign: "center", fontSize: 11 }}>
              {T.memuat}
            </p>
          }
        >
          <KasetMode
            state={state}
            onToggle={onToggle}
            onNext={onNext}
            onPrevious={onPrevious}
            onSeek={onSeek}
          />
        </Suspense>
      ) : (
        <div style={{ display: "grid", placeItems: "center", gap: "var(--s-4)" }}>
          {state.track ? (
            <>
              <CoverArt
                coverKey={state.track.coverKey}
                title={state.track.title}
                size={220}
                radius={0}
              />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>
                  {state.track.title}
                </div>
                <div className="muted">{state.track.artist}</div>
              </div>

              {/* Lirik Lagu (L2/L3) */}
              <div style={{ width: "100%", maxWidth: 440 }}>
                <Suspense
                  fallback={
                    <p className="mono muted" style={{ textAlign: "center", fontSize: 11 }}>
                      {T.memuat}
                    </p>
                  }
                >
                  <LyricsView track={state.track} />
                </Suspense>
              </div>
            </>
          ) : (
            <EmptyState title={T.belumAdaLagu} hint={T.pilihLaguDariCari} />
          )}
        </div>
      )}

      <div aria-hidden="true" style={{ height: 4, background: "var(--panel-2)" }}>
        <div
          style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: "var(--accent)",
          }}
        />
      </div>
      <div
        className="mono muted"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
      >
        <span>{formatDuration(state.positionMs)}</span>
        <span>{formatDuration(state.durationMs)}</span>
      </div>

      <h2 style={{ fontSize: 15 }}>{T.antrean}</h2>
      {queue.length === 0 ? (
        <EmptyState title={T.antreanKosong} hint={T.antreanKosongFullHint} />
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          {queue.map((it) => (
            <TrackRow key={`${it.position}-${it.track.videoId}`} track={it.track} />
          ))}
        </div>
      )}
    </section>
  );
}
