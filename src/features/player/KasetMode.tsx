import { useCallback, useEffect, useRef, useState } from "react";

import type { PlayerState } from "../../types";
import { T } from "../../lib/strings";
import { formatDuration } from "../../lib/format";
import { invoke, runningInTauri } from "../../lib/tauri";
import { IkonNext, IkonPause, IkonPlay, IkonPrev } from "../../components/icons";
import { useActiveLyric } from "../../hooks/useActiveLyric";
import { useAnimasiKaset } from "../../hooks/useAnimasiKaset";
import { useProgresKaset } from "../../hooks/useProgresKaset";
import { SeekBar } from "./SeekBar";
import { KasetSvg, KasetSvgBercover } from "./KasetSvg";

/**
 * Mode Kaset — K4 `FEATURES-V3.md` (dek penuh).
 *
 * K1 kerangka, K2 gambar + label generatif, K3 animasi, K4 dek:
 * LCD, counter mono, LED, tombol chamfer, dan `SeekBar` yang dipakai ulang.
 *
 * ## Handler tidak diduplikasi
 *
 * Prev/Play/Next menerima `onPrevious`/`onToggle`/`onNext` yang SAMA dengan
 * `PlayerBar` — diteruskan dari `App` lewat `FullPlayer`. Tidak ada logika
 * pemutaran di file ini. Kalau kontrol di sini punya jalur sendiri, cepat atau
 * lambat perilakunya berbeda dari bar (repeat, shuffle, penanganan error), dan
 * itu jenis bug yang mahal untuk ditemukan.
 *
 * `SeekBar` juga dipakai ulang apa adanya, bukan ditulis ulang: ia sudah
 * menangani drag, pratinjau, dan pengiriman seek sekali saat pointer dilepas.
 *
 * ## Aksesibilitas
 *
 * SVG kaset `aria-hidden` — ia dekoratif. Informasi lagu ada sebagai TEKS NYATA
 * di LCD, jadi pembaca layar membacanya sekali, bukan dua kali. Semua kontrol
 * adalah `<button>` asli, jadi Tab/Enter/Space bekerja tanpa handler buatan.
 */
type JenisLabel = "generatif" | "cover";

const KUNCI_LABEL = "kaset.label";

export function KasetMode({
  state,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
}: {
  state: PlayerState;
  onToggle?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSeek?: (positionMs: number) => void;
}) {
  const [jenisLabel, setJenisLabel] = useState<JenisLabel>("generatif");

  // Berputar hanya saat lagu BENAR-BENAR berbunyi dan jendela terlihat.
  // `loading` sengaja tidak memutar: reel yang berputar saat buffer terasa
  // seperti aplikasi yang bohong.
  const { berputar, kurangiGerak, terlihat } = useAnimasiKaset(state.status === "playing");

  // Di-throttle 1 detik (§K3): radius pita tidak boleh dihitung tiap frame.
  const progres = useProgresKaset(state.positionMs, state.durationMs, state.track?.videoId);

  useEffect(() => {
    if (!runningInTauri) return;
    let batal = false;
    void invoke<string | null>("setting_get", { key: KUNCI_LABEL })
      .then((v) => {
        if (batal) return;
        if (v === "cover" || v === "generatif") setJenisLabel(v);
      })
      .catch(() => {
        // Gagal baca: tetap generatif, yang tidak butuh jaringan apa pun.
      });
    return () => {
      batal = true;
    };
  }, []);

  const ubahLabel = useCallback((baru: JenisLabel) => {
    setJenisLabel(baru);
    if (!runningInTauri) return;
    void invoke("setting_set", { key: KUNCI_LABEL, value: baru }).catch(() => {});
  }, []);

  const ada = Boolean(state.track);
  const memutar = state.status === "playing";
  const memuat = state.status === "loading";

  // §5 I1: Hubungkan lirik aktif ke LCD kaset
  const { activeLineText, hasSyncedLyrics } = useActiveLyric(state.track?.videoId, memutar);

  return (
    <div
      style={{
        display: "grid",
        gap: "var(--s-4)",
        padding: "var(--s-4)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
        // `minWidth: 0` wajib: tanpa ini grid item menolak menyusut di bawah
        // lebar isinya, dan SVG 420px akan memaksa scroll horizontal di layar
        // sempit (§K4: tidak boleh ada scroll horizontal).
        minWidth: 0,
        width: "100%",
      }}
    >
      <div className="kaset-layout">
        <div className="kaset-panggung">
          {jenisLabel === "cover" ? (
            <KasetSvgBercover
              track={state.track}
              berputar={berputar}
              progres={progres}
              kurangiGerak={kurangiGerak}
            />
          ) : (
            <KasetSvg
              track={state.track}
              berputar={berputar}
              progres={progres}
              kurangiGerak={kurangiGerak}
            />
          )}
        </div>

        <div className="kaset-dek">
          <Lcd
            status={state.status}
            judul={state.track?.title ?? T.belumAdaLagu}
            artis={state.track?.artist ?? "\u2014"}
            lirikAktif={activeLineText}
            adaLirik={hasSyncedLyrics}
            kurangiGerak={kurangiGerak}
            terlihat={terlihat}
          />

          {/* Counter mono: posisi / durasi. Angka tabular (kelas `.mono`)
              supaya lebar digit tidak berubah dan baris tidak "bergetar". */}
          <div
            className="mono"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              fontSize: 13,
            }}
          >
            <span style={{ color: "var(--ink)" }}>{formatDuration(state.positionMs)}</span>
            <span className="muted" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
              {T.kasetCounter}
            </span>
            <span className="muted">{formatDuration(state.durationMs)}</span>
          </div>

          <SeekBar
            positionMs={state.positionMs}
            durationMs={state.durationMs}
            onSeek={(ms) => onSeek?.(ms)}
            disabled={!ada || !onSeek}
            loading={memuat}
          />

          <div className="kaset-dek-kontrol">
            <button
              type="button"
              className="kaset-tombol"
              onClick={onPrevious}
              disabled={!ada || !onPrevious}
              aria-label={T.laguSebelumnya}
              title={T.laguSebelumnya}
            >
              <IkonPrev size={18} />
            </button>

            {/* Satu-satunya blok kuning, paling besar — hirarki sama dengan
                PlayerBar supaya mata jatuh ke tempat yang sama di kedua mode. */}
            <button
              type="button"
              className="kaset-tombol kaset-tombol-utama"
              onClick={onToggle}
              disabled={!ada || !onToggle}
              aria-label={memutar ? T.jeda : T.putar}
              title={memutar ? T.jeda : T.putar}
            >
              {memuat ? (
                <span aria-hidden="true" style={{ fontSize: 16, letterSpacing: 1 }}>
                  {"\u2026"}
                </span>
              ) : memutar ? (
                <IkonPause size={22} />
              ) : (
                <IkonPlay size={22} />
              )}
            </button>

            <button
              type="button"
              className="kaset-tombol"
              onClick={onNext}
              disabled={!ada || !onNext}
              aria-label={T.laguBerikutnya}
              title={T.laguBerikutnya}
            >
              <IkonNext size={18} />
            </button>
          </div>

          {/* Indikator: LED status + LED shuffle. Teks selalu menyertai supaya
              tidak bergantung pada warna saja. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--s-3)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LedStatus status={state.status} terlihat={terlihat} />
              <span className="mono muted" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
                {memutar
                  ? T.memutar
                  : memuat
                    ? T.memuat
                    : state.status === "error"
                      ? T.gagal
                      : T.dijeda}
              </span>
            </span>

            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                aria-hidden="true"
                className="kaset-led"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  background: state.shuffle ? "var(--accent)" : "var(--line)",
                  border: "1px solid var(--line-strong)",
                  opacity: state.shuffle ? 1 : 0.35,
                }}
              />
              <span className="mono muted" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
                {state.shuffle ? T.kasetShuffleAktif : T.kasetShuffle}
              </span>
            </span>
          </div>

          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span className="mono muted" style={{ fontSize: 9, letterSpacing: "0.1em" }}>
              {T.kasetLabel}
            </span>
            {(["generatif", "cover"] as const).map((j) => {
              const aktif = jenisLabel === j;
              return (
                <button
                  key={j}
                  type="button"
                  onClick={() => ubahLabel(j)}
                  aria-pressed={aktif}
                  className="mono"
                  style={{
                    minHeight: 44,
                    padding: "0 10px",
                    fontSize: 9,
                    letterSpacing: "0.08em",
                    border: aktif ? "1px solid var(--accent)" : "1px solid var(--line)",
                    background: aktif ? "var(--accent)" : "transparent",
                    color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
                    fontWeight: aktif ? 600 : 400,
                    cursor: "pointer",
                  }}
                >
                  {j === "generatif" ? T.kasetLabelGeneratif : T.kasetLabelCover}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * LCD: judul bergulir + status.
 *
 * Kenapa mengukur lebar teks: kalau animasi memakai jarak tetap (mis. -50%),
 * judul pendek bergulir terlalu jauh dan judul panjang tidak sampai ujung.
 * Jarak dihitung dari `scrollWidth - clientWidth` — hanya kelebihannya, jadi
 * teks yang muat tidak bergulir sama sekali.
 *
 * Marquee dimatikan saat `prefers-reduced-motion`; teks jatuh ke elipsis dan
 * isi lengkapnya tetap terbaca pembaca layar karena ini teks asli, bukan
 * `aria-label` di SVG.
 */
function Lcd({
  status,
  judul,
  artis,
  lirikAktif,
  adaLirik,
  kurangiGerak,
  terlihat,
}: {
  status: PlayerState["status"];
  judul: string;
  artis: string;
  lirikAktif?: string | null;
  adaLirik?: boolean;
  kurangiGerak: boolean;
  terlihat: boolean;
}) {
  const kotakRef = useRef<HTMLDivElement | null>(null);
  const teksRef = useRef<HTMLSpanElement | null>(null);
  const [jarak, setJarak] = useState(0);
  const [perluGulir, setPerluGulir] = useState(false);

  // Teks utama LCD: jika ada baris lirik aktif, tampilkan liriknya (§5 I1).
  // Jika belum ada/tidak ada lirik, jatuh kembali ke judul lagu.
  const teksTampil = lirikAktif ? lirikAktif : judul;

  const ukur = useCallback(() => {
    const kotak = kotakRef.current;
    const teks = teksRef.current;
    if (!kotak || !teks) return;
    // scrollWidth = lebar teks utuh, clientWidth = jendela LCD.
    const lebih = teks.scrollWidth - kotak.clientWidth;
    setPerluGulir(lebih > 4);
    setJarak(lebih > 4 ? -lebih : 0);
  }, []);

  useEffect(() => {
    ukur();
    // Ukuran berubah saat jendela di-resize atau font selesai dimuat.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ukur) : null;
    if (ro && kotakRef.current) ro.observe(kotakRef.current);
    window.addEventListener("resize", ukur);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", ukur);
    };
  }, [ukur, teksTampil]);

  const gulir = perluGulir && !kurangiGerak && terlihat;

  return (
    <div
      className="kaset-lcd"
      style={{
        padding: "var(--s-2) var(--s-3)",
        display: "grid",
        gap: 2,
        minHeight: 58,
        alignContent: "center",
      }}
    >
      <div ref={kotakRef} style={{ overflow: "hidden", minWidth: 0 }}>
        <span
          ref={teksRef}
          className={gulir ? "kaset-marquee" : "kaset-marquee-diam"}
          style={gulir ? ({ "--marquee-jarak": `${jarak}px` } as React.CSSProperties) : undefined}
        >
          {lirikAktif ? (
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>
              {lirikAktif}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{judul}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {" \u00b7 "}
                {artis}
              </span>
            </>
          )}
        </span>
      </div>

      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          letterSpacing: "0.12em",
          color: "var(--ink-muted)",
        }}
      >
        <span>{lirikAktif ? T.lirik : T.kasetLcd}</span>
        <span>
          {status === "playing"
            ? adaLirik
              ? T.lirikTersinkron
              : T.memutar
            : status === "loading"
              ? T.memuat
              : status === "error"
                ? T.gagal
                : T.dijeda}
        </span>
      </div>
    </div>
  );
}

/**
 * LED status.
 *
 * Tiga keadaan dibedakan oleh RITME animasi, bukan hanya warna — supaya pengguna
 * dengan buta warna tetap bisa membedakannya:
 *  - memutar: kuning penuh, denyut halus 1,6 detik
 *  - memuat:  kuning, denyut cepat 0,9 detik
 *  - jeda:    redup, tanpa animasi
 */
function LedStatus({ status, terlihat }: { status: PlayerState["status"]; terlihat: boolean }) {
  const memutar = status === "playing" && terlihat;
  const memuat = status === "loading" && terlihat;

  const kelas = memutar ? " kaset-led-aktif" : memuat ? " kaset-led-muat" : "";
  const warna =
    status === "error" ? "var(--danger)" : status === "idle" ? "var(--line)" : "var(--accent)";

  return (
    <span
      aria-hidden="true"
      className={`kaset-led${kelas}`}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        background: warna,
        border: "1px solid var(--line-strong)",
        opacity: memutar || memuat ? 1 : 0.35,
      }}
    />
  );
}
