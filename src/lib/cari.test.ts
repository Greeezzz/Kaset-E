import { describe, expect, it } from "vitest";
import { buatIndeks, normalisasi, pecahKueri, saring } from "./cari";

interface Lagu {
  judul: string;
  artis: string;
  album?: string;
}

const daftar: Lagu[] = [
  { judul: "Björk — Jóga", artis: "Björk", album: "Homogenic" },
  { judul: "Café da Manhã", artis: "Los Hermanos", album: "Ventura" },
  { judul: "Paranoid Android", artis: "Radiohead", album: "OK Computer" },
  { judul: "Street Spirit", artis: "Radiohead", album: "The Bends" },
  { judul: "Øya Natt", artis: "Susanne Sundfør", album: "Ten Love Songs" },
];

const indeks = buatIndeks(daftar, (l) => [l.judul, l.artis, l.album]);

function cari(kueri: string): string[] {
  return saring(indeks, pecahKueri(kueri)).map((l) => l.judul);
}

describe("normalisasi", () => {
  it("membuang diakritik latin", () => {
    expect(normalisasi("Café")).toBe("cafe");
    expect(normalisasi("Jóga")).toBe("joga");
    expect(normalisasi("Sundfør")).toBe("sundfor");
  });

  it("memetakan huruf yang tidak terurai oleh NFD", () => {
    expect(normalisasi("Øya")).toBe("oya");
    expect(normalisasi("Straße")).toBe("strasse");
    expect(normalisasi("Łódź")).toBe("lodz");
  });

  it("tidak mengubah aksara non-latin", () => {
    expect(normalisasi("君の名前")).toBe("君の名前");
    expect(normalisasi("사랑해")).toBe("사랑해");
  });
});

describe("pecahKueri", () => {
  it("memecah per spasi dan membuang yang kosong", () => {
    expect(pecahKueri("  Radio   Head ")).toEqual(["radio", "head"]);
    expect(pecahKueri("   ")).toEqual([]);
  });
});

describe("saring", () => {
  it("mengembalikan semua lagu saat kueri kosong", () => {
    expect(cari("")).toHaveLength(daftar.length);
    expect(cari("   ")).toHaveLength(daftar.length);
  });

  it("tidak peka huruf besar/kecil dan diakritik", () => {
    expect(cari("BJORK")).toEqual(["Björk — Jóga"]);
    expect(cari("joga")).toEqual(["Björk — Jóga"]);
    expect(cari("cafe")).toEqual(["Café da Manhã"]);
    expect(cari("oya")).toEqual(["Øya Natt"]);
  });

  it("mencocokkan artis dan album, bukan hanya judul", () => {
    expect(cari("radiohead")).toHaveLength(2);
    expect(cari("ok computer")).toEqual(["Paranoid Android"]);
  });

  it("semua kata harus cocok, boleh lintas kolom", () => {
    // "radio" di artis, "bends" di album.
    expect(cari("radio bends")).toEqual(["Street Spirit"]);
    expect(cari("radio tidakada")).toEqual([]);
  });

  it("mencocokkan substring di tengah kata", () => {
    expect(cari("head")).toHaveLength(2);
    expect(cari("android")).toEqual(["Paranoid Android"]);
  });

  it("tidak menggabungkan akhir satu kolom dengan awal kolom lain", () => {
    // Judul berakhir "Android", artis mulai "Radiohead"; "androidradio"
    // tidak boleh cocok karena kolom dipisah NUL.
    expect(cari("androidradio")).toEqual([]);
  });

  it("mempertahankan urutan asli", () => {
    expect(cari("radiohead")).toEqual(["Paranoid Android", "Street Spirit"]);
  });
});
