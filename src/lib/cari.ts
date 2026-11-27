/**
 * Pencarian teks untuk daftar lagu (judul, artis, album).
 *
 * Dikerjakan di klien, bukan di SQLite: data playlist sudah ada di memori
 * sebagai `Track[]`, dan menambah query per ketikan berarti perjalanan
 * IPC + query database untuk setiap huruf. Untuk beberapa ribu lagu,
 * memfilter array di memori jauh lebih murah.
 *
 * Aturan pencocokan (disepakati di tugas "cari dalam playlist"):
 * - Tidak peka huruf besar/kecil dan tidak peka diakritik ("bjork" menemukan
 *   "Björk", "cafe" menemukan "Café").
 * - Setiap kata harus cocok (AND), boleh di kolom berbeda: "radio ok" cocok
 *   untuk artis "Radiohead" di album "OK Computer".
 * - Dicocokkan sebagai substring, bukan awalan, supaya "head" tetap menemukan
 *   "Radiohead".
 */

/**
 * Huruf yang tidak terurai menjadi huruf dasar + tanda diakritik oleh NFD,
 * jadi harus dipetakan manual. Daftar pendek dan sengaja: ini huruf yang
 * sering muncul di nama artis/album, bukan tabel transliterasi lengkap.
 */
const PETA_KHUSUS: Record<string, string> = {
  ø: "o",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ı: "i",
  ħ: "h",
  ŋ: "ng",
};

const KHUSUS = /[øłđðþßæœıħŋ]/g;

/** Buang diakritik dan lipat huruf besar/kecil. */
export function normalisasi(teks: string): string {
  return (
    teks
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      // NFD juga mengurai suku kata Hangul menjadi Jamo; NFC menyatukannya lagi
      // supaya teks Korea (dan Latin tanpa diakritik) kembali seperti aslinya.
      .normalize("NFC")
      .replace(KHUSUS, (c) => PETA_KHUSUS[c] ?? c)
  );
}

/**
 * Satu baris indeks: data asli + kunci yang sudah dinormalisasi.
 *
 * Kunci dibangun sekali saat daftar berubah, bukan setiap ketikan, supaya
 * mengetik di playlist 3.000 lagu tidak menormalisasi 9.000 string per huruf.
 */
export interface ItemCari<T> {
  data: T;
  kunci: string;
}

/**
 * Bangun indeks pencarian dari daftar apa pun.
 *
 * `ambil` mengembalikan kolom-kolom yang ikut dicari. Kolom digabung dengan
 * NUL, bukan spasi, supaya kata tidak bisa cocok melintasi dua kolom
 * (mis. judul berakhir "ra" dan album mulai "dio" tidak membentuk "radio").
 */
export function buatIndeks<T>(
  daftar: readonly T[],
  ambil: (item: T) => Array<string | null | undefined>,
): Array<ItemCari<T>> {
  return daftar.map((data) => ({
    data,
    kunci: normalisasi(
      ambil(data)
        .filter((v): v is string => Boolean(v))
        .join("\u0000"),
    ),
  }));
}

/** Pecah kueri menjadi kata-kata yang sudah dinormalisasi. */
export function pecahKueri(kueri: string): string[] {
  return normalisasi(kueri).split(/\s+/).filter(Boolean);
}

/**
 * Saring indeks. Semua kata harus muncul (AND). Kueri kosong mengembalikan
 * seluruh data dalam urutan aslinya.
 */
export function saring<T>(indeks: readonly ItemCari<T>[], kata: readonly string[]): T[] {
  if (kata.length === 0) return indeks.map((item) => item.data);
  const hasil: T[] = [];
  for (const item of indeks) {
    if (kata.every((k) => item.kunci.includes(k))) hasil.push(item.data);
  }
  return hasil;
}
