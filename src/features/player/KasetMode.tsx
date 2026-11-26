import { useEffect, useState } from "react";

import type { PlayerState } from "../../types";
import { T } from "../../lib/strings";
import { invoke, runningInTauri } from "../../lib/tauri";
import { useAnimasiKaset } from "../../hooks/useAnimasiKaset";
import { KasetSvg, KasetSvgBercover } from "./KasetSvg";

/**
 * Mode Kaset — K3 `FEATURES-V3.md`.
 *
 * K1: kerangka mode. K2: gambar kaset + label generatif.
 * K3: animasi reel, gulungan pita mengikuti progres, LED status.
 * K4 akan menambah dek penuh (LCD, tombol chamfer).
 *
 * Opsi `kaset.label`:
 *  - `generatif` (default): label dari hash `video_id`, tanpa aset eksternal.
 *  - `cover`: cover lagu mini ditempel di jendela reel, tetap lewat Rust
 *    (`useCover`), bukan `<img src=ytimg>`.
 */
type JenisLabel = "generatif" | "cover";

const KUNCI_LABEL = "kaset.label";

export function KasetMode({ state }: { state: PlayerState }) {
  const [jenisLabel, setJenisLabel] = useState<JenisLabel>("generatif");

  // Berputar hanya saat lagu BENAR-BENAR berbunyi dan jendela terlihat.
  // `loading` sengaja tidak memutar: reel yang berputar saat buffer terasa
  // seperti aplikasi yang bohong.
  const { berputar, kurangiGerak, terlihat } = useAnimasiKaset(state.status === "playing");

  const progres =
    state.durationMs > 0 ? Math.min(1, Math.max(0, state.positionMs / state.durationMs)) : 0;

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

  function ubahLabel(baru: JenisLabel) {
    setJenisLabel(baru);
    if (!runningInTauri) return;
    void invoke("setting_set", { key: KUNCI_LABEL, value: baru }).catch(() => {});
  }

  return (
    <div
      style={{
        display: "grid",
        gap: "var(--s-3)",
        justifyItems: "center",
        padding: "var(--s-4)",
        border: "1px solid var(--line)",
        background: "var(--panel)",
      }}
    >
      <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
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

      {/* Baris status: LED + label mono. LED membawa informasi nyata (memutar /
          jeda / memuat), jadi selalu didampingi teks — jangan hanya warna. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <LedStatus status={state.status} terlihat={terlihat} />
        <span className="mono muted" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
          {state.status === "playing"
            ? T.memutar
            : state.status === "loading"
              ? T.memuat
              : state.status === "error"
                ? T.gagal
                : T.dijeda}
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
                minHeight: 28,
                padding: "0 8px",
                fontSize: 9,
                letterSpacing: "0.08em",
                border: aktif ? "1px solid var(--accent)" : "1px solid var(--line)",
                background: aktif ? "var(--accent)" : "transparent",
                color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
                fontWeight: aktif ? 600 : 400,
              }}
            >
              {j === "generatif" ? T.kasetLabelGeneratif : T.kasetLabelCover}
            </button>
          );
        })}
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
