import { useRef } from "react";

interface Props {
  volume: number;
  onChange: (volume: number) => void;
}

/**
 * Kontrol volume: tombol bisu + slider.
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
    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
      <button
        type="button"
        onClick={() => ubah(bisu ? sebelumBisu.current : 0)}
        aria-label={bisu ? "Bunyikan" : "Bisukan"}
        title={bisu ? "Bunyikan" : "Bisukan"}
        style={{
          minWidth: 32,
          minHeight: 32,
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--line)",
          background: "transparent",
          color: "var(--ink)",
          cursor: "pointer",
        }}
      >
        {/* Glyph teks: konsisten dengan ikon lain yang belum diganti set garis. */}
        <span aria-hidden="true" style={{ fontSize: 13 }}>
          {bisu ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
        </span>
      </button>

      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(volume * 100)}
        onChange={(e) => ubah(Number(e.target.value) / 100)}
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)} persen`}
        style={{
          width: 84,
          // Slider bawaan browser diwarnai lewat accent-color; tidak perlu
          // restyle thumb manual dan tetap menghormati tema.
          accentColor: "var(--accent)",
          cursor: "pointer",
        }}
      />

      <span
        className="mono muted"
        style={{ fontSize: 12, minWidth: 30, textAlign: "right" }}
        aria-hidden="true"
      >
        {Math.round(volume * 100)}
      </span>
    </div>
  );
}
