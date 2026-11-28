import { useState } from "react";
import { T } from "../lib/strings";
import { bukaKasetLyric } from "../lib/tauri";

/**
 * Tombol menuju KasetLyric — situs terpisah yang mengubah lirik .lrc Jepang
 * menjadi romaji di browser. Kaset hanya membuka tautannya; tidak ada judul,
 * artis, atau isi lirik yang dikirim.
 *
 * Tinggi mengikuti `.k-btn` (min 44×44) sesuai DESIGN.md §7, bukan 32 px seperti
 * tombol lirik lain, supaya area sentuh di Android tetap memenuhi dokumen.
 */
export function TombolKasetLyric({
  onGagal,
  variant = "quiet",
}: {
  onGagal?: (pesan: string) => void;
  /** `quiet` untuk baris alat, `utama` untuk keadaan kosong. */
  variant?: "quiet" | "utama";
}) {
  const [membuka, setMembuka] = useState(false);

  async function klik() {
    if (membuka) return;
    setMembuka(true);
    try {
      await bukaKasetLyric();
    } catch (err) {
      // Detail teknis ke konsol, pengguna hanya melihat satu kalimat.
      console.warn("Gagal membuka KasetLyric:", err);
      onGagal?.(T.kasetlyricGagal);
    } finally {
      setMembuka(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void klik()}
      disabled={membuka}
      className={variant === "utama" ? "k-btn k-btn-accent" : "k-btn k-btn-quiet"}
      title={T.kasetlyricTip}
      aria-label={T.kasetlyricTip}
    >
      {T.kasetlyricTombol}
    </button>
  );
}
