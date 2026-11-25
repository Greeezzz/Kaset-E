import { useEffect, useState } from "react";

import type { PlayerState } from "../../types";
import { T } from "../../lib/strings";
import { invoke, runningInTauri } from "../../lib/tauri";
import { KasetSvg, KasetSvgBercover } from "./KasetSvg";

/**
 * Mode Kaset — K2 `FEATURES-V3.md`.
 *
 * K1: kerangka mode. K2: gambar kaset (SVG) + label generatif.
 * K3 akan menambahkan animasi reel; K4 dek penuh (LCD/LED/tombol).
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
      {jenisLabel === "cover" ? (
        <KasetSvgBercover track={state.track} />
      ) : (
        <KasetSvg track={state.track} />
      )}

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
