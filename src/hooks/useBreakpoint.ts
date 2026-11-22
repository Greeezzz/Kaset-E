import { useMediaQuery } from "./useMediaQuery";

/**
 * Empat tingkat lebar layar (DESIGN-LAYOUT §8).
 *
 * Kenapa bukan sekadar boolean "wide": tiap tingkat butuh perlakuan berbeda,
 * dan menggabungkannya jadi satu boolean memaksa komponen menebak-nebak lebar
 * lewat `window.innerWidth` sendiri — sumber kebenaran kedua yang bisa
 * berbeda dari yang dipakai CSS.
 *
 *  - `lebar`   (≥1200) tiga kolom penuh; panel kanan menyempitkan tengah.
 *  - `sedang`  (900–1199) panel kanan menimpa (overlay), tengah tidak menyusut.
 *  - `rel`     (600–899) sidebar jadi rel ikon sempit; panel tetap overlay.
 *  - `sempit`  (<600) sidebar hilang → BottomNav; panel jadi bottom sheet.
 *
 * `useMediaQuery` dipakai berlapis (bukan satu query raksasa) supaya tiap
 * kondisi terbaca sendiri dan tidak ada urutan operator yang mudah salah.
 */
export type Breakpoint = "lebar" | "sedang" | "rel" | "sempit";

export function useBreakpoint(): Breakpoint {
  // Query dievaluasi dari yang paling lebar; yang pertama cocok menang.
  const lebar = useMediaQuery("(min-width: 1200px)");
  const sedang = useMediaQuery("(min-width: 900px)");
  const rel = useMediaQuery("(min-width: 600px)");

  if (lebar) return "lebar";
  if (sedang) return "sedang";
  if (rel) return "rel";
  return "sempit";
}

/** Sidebar tampil sebagai kolom penuh (bukan rel ikon). */
export function sidebarPenuh(bp: Breakpoint): boolean {
  return bp === "lebar";
}

/** Sidebar tampil sama sekali (penuh atau rel). */
export function adaSidebar(bp: Breakpoint): boolean {
  return bp === "lebar" || bp === "sedang" || bp === "rel";
}

/**
 * Panel kanan menimpa area tengah, bukan menyempitkannya.
 *
 * Di layar <1200px, menyempitkan kolom tengah membuat daftar lagu terlalu
 * sempit untuk dibaca — lebih baik panel menutupi sementara.
 */
export function panelOverlay(bp: Breakpoint): boolean {
  return bp !== "lebar";
}

/** Panel kanan tampil sebagai bottom sheet, bukan panel samping. */
export function panelSheet(bp: Breakpoint): boolean {
  return bp === "sempit";
}

/** Player bar kontrol penuh; di bawahnya pakai MiniPlayer. */
export function adaPlayerBar(bp: Breakpoint): boolean {
  return bp !== "sempit";
}
