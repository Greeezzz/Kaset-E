/**
 * KasetLyric — situs terpisah yang mengubah lirik .lrc Jepang menjadi romaji
 * sepenuhnya di browser. Kaset hanya membuka tautannya; tidak ada data lagu
 * yang dikirim ke sana.
 *
 * URL hidup di satu tempat ini. Kalau alamatnya pindah, cukup ubah satu baris
 * di sini — tidak ada salinan lain di komponen.
 */
export const URL_KASETLYRIC = "https://arimakaori.github.io/kasetlyric/";

/** Host dan jalur yang boleh dibuka. Penjaga, bukan sumber tautan. */
const HOST_DIIZINKAN = "arimakaori.github.io";
const JALUR_DIIZINKAN = "/kasetlyric/";

/** `noopener,noreferrer`: tab baru tidak boleh menyentuh `window.opener`. */
export const FITUR_JENDELA_BARU = "noopener,noreferrer";

/**
 * Memastikan tautan tetap ke KasetLyric sebelum dibuka. Konstanta di atas
 * seharusnya selalu lolos; fungsi ini menjaga kalau suatu saat nilainya salah
 * ketik atau diganti ke host lain tanpa sengaja.
 */
export function urlKasetLyricValid(url: string = URL_KASETLYRIC): boolean {
  try {
    const u = new URL(url);
    const jalur = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return u.protocol === "https:" && u.hostname === HOST_DIIZINKAN && jalur === JALUR_DIIZINKAN;
  } catch {
    return false;
  }
}

/**
 * Dependensi pembuka disuntikkan supaya logika ini bisa diuji tanpa DOM dan
 * tanpa Tauri. Implementasi nyatanya ada di `src/lib/tauri.ts`.
 */
export interface PembukaTautan {
  diTauri: boolean;
  bukaDiTauri: (url: string) => Promise<void>;
  bukaDiBrowser: (url: string, target: string, fitur: string) => void;
}

/** Membuka KasetLyric di browser sistem, atau melempar error yang bisa ditampilkan UI. */
export async function bukaTautanKasetLyric(pembuka: PembukaTautan): Promise<void> {
  if (!urlKasetLyricValid()) {
    throw new Error("URL KasetLyric tidak valid.");
  }

  if (pembuka.diTauri) {
    await pembuka.bukaDiTauri(URL_KASETLYRIC);
    return;
  }

  // Nilai balik window.open sengaja tidak diperiksa: dengan `noopener` browser
  // mengembalikan null meski tabnya benar-benar terbuka. Yang bisa dipercaya
  // hanya lemparan error (mis. popup diblokir total).
  pembuka.bukaDiBrowser(URL_KASETLYRIC, "_blank", FITUR_JENDELA_BARU);
}
