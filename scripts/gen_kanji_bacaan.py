"""Generator tabel bacaan kanji untuk Kaset.

Sumber data: Unihan (Unicode Character Database), field `kJapanese` yang berisi
bacaan on (katakana) dan kun (hiragana) untuk tiap ideograf. Lisensi Unihan:
Unicode License v3 (permissive, kompatibel MIT) - lihat
https://www.unicode.org/license.txt

Yang dihasilkan: `src-tauri/src/lyrics/kanji_bacaan.rs`, berisi tabel
(kanji, on'yomi, kun'yomi) yang sudah diurutkan untuk binary search.

Pemakaian (sekali saja, hasilnya di-commit):

    python scripts/gen_kanji_bacaan.py \
        --unihan Unihan_Readings.txt --lain Unihan_OtherMappings.txt

Kenapa tidak sekalian semua kanji di Unihan? Karena 13.395 karakter membuat
berkas ini ~190 KB dengan ribuan karakter yang tidak pernah muncul di lirik.
Filter JIS X 0208 (6.356 karakter) mencakup jÅyÅ + jinmeiyÅ + nama umum, dan
kanji di luar itu jatuh ke fallback `None` yang sudah didokumentasikan.
"""

import argparse
import io


def baca_kolom(path, field):
    hasil = {}
    with io.open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or "\t" not in line:
                continue
            bagian = line.rstrip("\n").split("\t")
            if len(bagian) != 3 or bagian[1] != field:
                continue
            hasil[chr(int(bagian[0][2:], 16))] = bagian[2]
    return hasil


def pisah_bacaan(nilai):
    """Pisahkan bacaan kana menjadi on (katakana) dan kun (hiragana)."""
    on, kun = [], []
    for kata in nilai.split():
        if not kata:
            continue
        # Katakana U+30A1..U+30FA, hiragana U+3041..U+3096.
        if all("\u30a1" <= c <= "\u30fa" or c == "\u30fc" for c in kata):
            on.append(kata)
        elif all("\u3041" <= c <= "\u3096" for c in kata):
            kun.append(kata)
    return " ".join(on), " ".join(kun)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--unihan", required=True, help="Unihan_Readings.txt")
    ap.add_argument("--lain", required=True, help="Unihan_OtherMappings.txt (untuk kJis0)")
    ap.add_argument("--keluaran", default="src-tauri/src/lyrics/kanji_bacaan.rs")
    args = ap.parse_args()

    jepang = baca_kolom(args.unihan, "kJapanese")
    jis0 = set(baca_kolom(args.lain, "kJis0").keys())

    baris = []
    for kanji, nilai in jepang.items():
        if kanji not in jis0:
            continue
        on, kun = pisah_bacaan(nilai)
        if not on and not kun:
            continue
        baris.append((kanji, on, kun))
    baris.sort(key=lambda b: b[0])

    def esc(s):
        return s.replace("\\", "\\\\").replace('"', '\\"')

    with io.open(args.keluaran, "w", encoding="utf-8", newline="\n") as f:
        f.write("//! Tabel bacaan kanji (on'yomi / kun'yomi) - DIHASILKAN, jangan disunting manual.\n")
        f.write("//!\n")
        f.write("//! Sumber: Unihan (Unicode Character Database) field `kJapanese`, difilter ke\n")
        f.write("//! kanji yang punya pemetaan JIS X 0208 (kJis0). Lisensi data: Unicode License\n")
        f.write("//! v3 (https://www.unicode.org/license.txt), kompatibel dengan lisensi MIT proyek.\n")
        f.write("//!\n")
        f.write("//! Regenerasi: `python scripts/gen_kanji_bacaan.py --unihan Unihan_Readings.txt\n")
        f.write("//! --lain Unihan_OtherMappings.txt`.\n")
        f.write("//!\n")
        f.write("//! Kenapa tabel sendiri: kamus `ib-romaji` mengurutkan bacaan secara alfabet,\n")
        f.write("//! bukan frekuensi, jadi å¤¢ terbaca \"bou\" dan å› terbaca \"gimi\". Di sini on dan\n")
        f.write("//! kun dipisah supaya pemilihan bacaan bisa memakai konteks (kanji majemuk ->\n")
        f.write("//! on'yomi, kanji tunggal + okurigana -> kun'yomi).\n")
        f.write("\n")
        f.write("/// (kanji, on'yomi katakana, kun'yomi hiragana), diurutkan menaik.\n")
        # Satu entri per baris supaya diff-nya terbaca; rustfmt akan memecah
        # baris panjang kalau tidak dilewati.
        f.write("#[rustfmt::skip]\n")
        f.write("pub(crate) static BACAAN_JEPANG: &[(char, &str, &str)] = &[\n")
        for kanji, on, kun in baris:
            f.write(f'    (\'{kanji}\', "{esc(on)}", "{esc(kun)}"),\n')
        f.write("];\n")

    print(f"{len(baris)} kanji ditulis ke {args.keluaran}")


if __name__ == "__main__":
    main()

