import { describe, expect, it } from "vitest";

/**
 * Logika radius gulungan pita di `KasetSvg`.
 *
 * Angka ini sengaja dites sebagai fungsi murni: kalau radius bisa keluar dari
 * jendela reel, kaset akan terlihat rusak di progres 0% atau 100% — dan itu
 * jenis bug yang tidak ketahuan sampai ada orang menonton lagu sampai habis.
 */
function radius(progres: number) {
  const p = Math.min(1, Math.max(0, progres));
  return { kiri: 22 - 15 * p, kanan: 7 + 15 * p };
}

describe("radius gulungan pita", () => {
  it("progres 0: kiri penuh, kanan kosong", () => {
    expect(radius(0)).toEqual({ kiri: 22, kanan: 7 });
  });

  it("progres 1: kiri kosong, kanan penuh", () => {
    expect(radius(1)).toEqual({ kiri: 7, kanan: 22 });
  });

  it("di tengah: kedua gulungan sama besar", () => {
    const r = radius(0.5);
    expect(r.kiri).toBeCloseTo(14.5);
    expect(r.kanan).toBeCloseTo(14.5);
  });

  it("tidak pernah keluar batas walau progres di luar 0..1", () => {
    for (const p of [-5, -0.1, 1.1, 99, Number.NaN]) {
      const r = radius(Number.isNaN(p) ? 0 : p);
      expect(r.kiri).toBeGreaterThanOrEqual(7);
      expect(r.kiri).toBeLessThanOrEqual(22);
      expect(r.kanan).toBeGreaterThanOrEqual(7);
      expect(r.kanan).toBeLessThanOrEqual(22);
    }
  });

  it("total kain pita tetap: kiri + kanan konstan 29", () => {
    // Kalau jumlahnya tidak konstan, pita terlihat "bertambah" padahal lagu
    // hanya berjalan — kesalahan yang mudah terjadi saat menulis rumus.
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const r = radius(p);
      expect(r.kiri + r.kanan).toBeCloseTo(29);
    }
  });

  it("monoton: kiri mengecil, kanan membesar", () => {
    let sebelum = radius(0);
    for (const p of [0.2, 0.4, 0.6, 0.8, 1]) {
      const kini = radius(p);
      expect(kini.kiri).toBeLessThan(sebelum.kiri);
      expect(kini.kanan).toBeGreaterThan(sebelum.kanan);
      sebelum = kini;
    }
  });
});
