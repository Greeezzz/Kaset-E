import { useRef } from "react";
import { T } from "../../lib/strings";
import { IkonVolume } from "../../components/icons";

interface Props {
  volume: number;
  onChange: (volume: number) => void;
}

/**
 * Kontrol volume: tombol bisu tanpa latar + slider (DESIGN-LAYOUT bagian 6).
 *
 * Mute menyimpan volume sebelumnya di ref supaya "buka bisu" mengembalikan
 * angka yang user pilih, bukan default 80%. Volume 0 dari slider juga
 * dianggap bisu, jadi ikonnya konsisten.
 */
export function VolumeControl({ volume, onChange }: Props) {
  const sebelumBisu = useRef(volume > 0 ? volume : 0.8);
  const bisu = volume <= 0;

  if (volume > 0) sebelumBisu.current = volume;

  const ubah = (v: number) => onChange(Math.min(1, Math.max(0, v)));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-1)" }}>
      <button
        type="button"
        onClick={() => ubah(bisu ? sebelumBisu.current : 0)}
        aria-label={bisu ? T.bunyikan : T.bisukan}
        aria-pressed={bisu}
        title={bisu ? T.bunyikan : T.bisukan}
        style={{
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center",
          background: "transparent",
          color: bisu ? "var(--ink-muted)" : "var(--ink)",
          cursor: "pointer",
        }}
      >
        {/* Tiga tingkat: bisu (silang), rendah, tinggi. Bentuknya sama supaya
            tombol tidak terasa melompat saat volumenya digeser. */}
        <IkonVolume size={18} level={bisu ? 0 : volume < 0.5 ? 1 : 2} />
      </button>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        onChange={(e) => ubah(Number(e.target.value) / 100)}
        aria-label={T.volume}
        aria-valuetext={`${Math.round(volume * 100)} persen`}
        style={{
          width: 84,
          accentColor: "var(--accent)",
          cursor: "pointer",
        }}
      />

      <span
        className="mono muted"
        style={{ fontSize: 11, minWidth: 28, textAlign: "right" }}
        aria-hidden="true"
      >
        {Math.round(volume * 100)}
      </span>
    </div>
  );
}
