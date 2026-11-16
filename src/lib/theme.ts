/**
 * Tema terang/gelap (DESIGN-ENDFIELD §2).
 *
 * Kontrak: atribut `data-theme` di <html> menentukan token mana yang aktif
 * (lihat styles/tokens.css). Nilai yang sah: "light" | "dark".
 *
 * Default: "light" ("Terminal Kertas") sesuai dokumen desain. Kalau pengguna
 * belum pernah memilih, kita ikut preferensi sistem supaya tidak mengejutkan.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "kaset.theme";

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark";
}

/** Pilihan yang disimpan pengguna, atau null kalau belum pernah memilih. */
export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    // localStorage bisa dilarang; jangan sampai aplikasi gagal karena ini.
    return null;
  }
}

/** Preferensi sistem, dengan fallback ke default dokumen. */
export function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

/** Pasang tema ke <html>. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Simpan pilihan pengguna lalu terapkan. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Gagal menyimpan bukan alasan untuk menolak menerapkan tema.
  }
  applyTheme(theme);
}

/** Dipanggil sekali saat start: pasang tema tanpa menulis apa pun. */
export function applyStoredTheme(): void {
  applyTheme(currentTheme());
}
