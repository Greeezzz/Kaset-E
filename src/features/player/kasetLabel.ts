/**
 * Label kaset generatif — deterministik dari `video_id`.
 *
 * Tujuan: tiap lagu punya "kaset" sendiri tanpa satu pun aset eksternal.
 * Karena inputnya `video_id`, lagu yang sama SELALU mendapat label yang sama,
 * di sesi mana pun dan setelah restart. Itu yang membuatnya terasa seperti
 * benda fisik, bukan hiasan acak.
 *
 * Semua keputusan di sini murni fungsi dari angka hash — tidak ada
 * `Math.random`, tidak ada waktu, tidak ada state. Itu juga yang membuatnya
 * bisa diuji.
 *
 * Batasan dari `FEATURES-V3.md` §1: hanya prinsip umum anatomi kaset yang
 * diambil (cangkang, sekrup, panel label, SIDE A/B, kode pita). Tidak ada
 * tiruan desain produk atau karya pihak lain.
 */
import { fnv1a } from "../../lib/format";

/** Rentang nada yang dipakai label. Indeks ke `POLA_STRIP`. */
export const JUMLAH_POLA = 6;

/** Kode pita yang lazim di kaset; murni dekoratif. */
const KODE_PITA = ["C-60", "C-74", "C-90", "C-46", "C-100"];

/** Sisi kaset. Ditentukan dari bit hash, bukan urutan antrean. */
const SISI = ["A", "B"] as const;

export interface LabelKaset {
  /** 0..JUMLAH_POLA-1: pola strip yang dipakai. */
  pola: number;
  /** Kode pita dekoratif, mis. "C-90". */
  kode: string;
  /** "A" atau "B". */
  sisi: "A" | "B";
  /** Nomor seri pendek ala stiker arsip, mis. "K-4F2A". */
  seri: string;
  /** Rotasi kecil (-2..2 derajat) supaya label tidak terlihat terlalu rapi. */
  kemiringan: number;
  /** Apakah strip kuning ditaruh di atas (true) atau di bawah judul. */
  stripDiAtas: boolean;
}

/**
 * Hitung label untuk satu kunci (biasanya `video_id`).
 *
 * Setiap field mengambil bit/byte berbeda dari satu hash, jadi tidak ada dua
 * field yang selalu bergerak bersamaan — kalau semua field memakai `hash % n`,
 * pola dan kode akan selalu berkorelasi dan labelnya terlihat berulang.
 */
export function labelKaset(kunci: string): LabelKaset {
  const h = fnv1a(kunci || "kaset");
  // Hash kedua dengan seed berbeda, untuk field yang perlu sebaran lain.
  const h2 = fnv1a(`kaset:${kunci}`);

  return {
    pola: h % JUMLAH_POLA,
    kode: KODE_PITA[(h >>> 3) % KODE_PITA.length],
    sisi: SISI[(h >>> 7) % 2],
    // Empat digit hex dari bagian atas hash: cukup pendek untuk label,
    // cukup unik untuk terlihat seperti nomor seri sungguhan.
    seri: `K-${((h2 >>> 8) & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`,
    kemiringan: ((h >>> 11) % 5) - 2,
    stripDiAtas: ((h >>> 15) & 1) === 1,
  };
}

/**
 * Pola strip: daftar lebar relatif (0..1) untuk segmen mendatar.
 *
 * Dikembalikan sebagai angka, bukan JSX, supaya bisa diuji tanpa DOM dan
 * dipakai ulang oleh K3/K4 (mis. sebagai dasar animasi pita).
 */
export function polaStrip(pola: number): number[] {
  const pola_pola: number[][] = [
    [1],
    [0.62, 0.38],
    [0.3, 0.7],
    [0.45, 0.2, 0.35],
    [0.2, 0.2, 0.2, 0.4],
    [0.75, 0.25],
  ];
  return pola_pola[pola % pola_pola.length];
}

/**
 * Pangkas teks supaya muat di label tanpa meluap.
 *
 * Kaset punya lebar tetap, dan judul lagu bisa sangat panjang (termasuk
 * gabungan kanji + romaji). Dipotong di batas karakter, bukan byte, supaya
 * karakter non-ASCII tidak terbelah jadi sampah.
 */
export function pangkas(teks: string, maks: number): string {
  const t = teks.trim();
  const karakter = [...t];
  if (karakter.length <= maks) return t;
  // Sisakan satu karakter untuk elipsis supaya totalnya tetap <= maks.
  return `${karakter.slice(0, Math.max(0, maks - 1)).join("")}…`;
}
