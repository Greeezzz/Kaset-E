import { describe, expect, it } from "vitest";

import { JUMLAH_POLA, labelKaset, pangkas, polaStrip } from "./kasetLabel";

describe("labelKaset", () => {
  it("deterministik: kunci sama selalu menghasilkan label sama", () => {
    const a = labelKaset("dQw4w9WgXcQ");
    const b = labelKaset("dQw4w9WgXcQ");
    expect(a).toEqual(b);
  });

  it("kunci berbeda menghasilkan label berbeda", () => {
    const a = labelKaset("dQw4w9WgXcQ");
    const b = labelKaset("9RfVp-GhKfs");
    // Tidak mungkin semua field kebetulan sama; minimal salah satu beda.
    expect(a).not.toEqual(b);
  });

  it("semua field berada di rentang yang sah", () => {
    // Uji banyak kunci supaya sebaran benar-benar terperiksa, bukan satu sampel.
    for (let i = 0; i < 500; i++) {
      const l = labelKaset(`vid-${i}`);
      expect(l.pola).toBeGreaterThanOrEqual(0);
      expect(l.pola).toBeLessThan(JUMLAH_POLA);
      expect(["A", "B"]).toContain(l.sisi);
      expect(l.kemiringan).toBeGreaterThanOrEqual(-2);
      expect(l.kemiringan).toBeLessThanOrEqual(2);
      expect(l.seri).toMatch(/^K-[0-9A-F]{4}$/);
      expect(typeof l.stripDiAtas).toBe("boolean");
    }
  });

  it("kunci kosong tidak menghasilkan NaN", () => {
    const l = labelKaset("");
    expect(Number.isNaN(l.pola)).toBe(false);
    expect(l.seri).toMatch(/^K-[0-9A-F]{4}$/);
  });

  it("field tidak bergerak serempak", () => {
    // Kalau semua field memakai hash % n yang sama, pola dan sisi akan selalu
    // berkorelasi. Uji: minimal ada dua kombinasi (pola, sisi) berbeda.
    const kombinasi = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const l = labelKaset(`x${i}`);
      kombinasi.add(`${l.pola}-${l.sisi}`);
    }
    expect(kombinasi.size).toBeGreaterThan(JUMLAH_POLA);
  });
});

describe("polaStrip", () => {
  it("setiap pola berjumlah 1", () => {
    for (let i = 0; i < JUMLAH_POLA; i++) {
      const total = polaStrip(i).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });

  it("indeks di luar rentang tidak error", () => {
    expect(polaStrip(99).length).toBeGreaterThan(0);
  });
});

describe("pangkas", () => {
  it("teks pendek tidak diubah", () => {
    expect(pangkas("Creep", 26)).toBe("Creep");
  });

  it("teks panjang dipotong dengan elipsis dan tidak melebihi batas", () => {
    const hasil = pangkas("a".repeat(40), 10);
    expect([...hasil].length).toBe(10);
    expect(hasil.endsWith("…")).toBe(true);
  });

  it("tidak membelah karakter non-ASCII", () => {
    // Dipotong per karakter, bukan per byte: kanji utuh, bukan sampah.
    const hasil = pangkas("メリッサの歌です", 5);
    expect([...hasil].length).toBe(5);
    expect(hasil).toBe("メリッサ…");
  });

  it("spasi di ujung dibuang lebih dulu", () => {
    expect(pangkas("  Creep  ", 26)).toBe("Creep");
  });
});
