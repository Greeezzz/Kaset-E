import { useEffect, useRef, useState } from "react";

/**
 * Progres lagu untuk gulungan pita, di-throttle ke ~1 detik.
 *
 * Kenapa tidak memakai `positionMs` langsung: player store memperbarui posisi
 * jauh lebih sering daripada 1 detik (tiap kali `timeupdate`/rAF). Kalau radius
 * pita dihitung dari nilai itu, SVG dirender ulang puluhan kali per detik hanya
 * untuk mengubah dua angka `r` — dan React harus merekonsiliasi seluruh pohon
 * kaset tiap kali. Itu persis yang dilarang §K3: "perbarui sekitar tiap 1 detik,
 * bukan tiap frame".
 *
 * Perubahan radius 1 kali per detik juga secara visual sudah cukup halus: dalam
 * satu detik radius hanya bergeser 15/180 ≈ 0,08 px pada lagu 3 menit, jadi
 * interpolasi tidak terlihat kurang.
 *
 * JEBAKAN yang terbukti di aplikasi nyata: menaruh `positionMs` di daftar
 * dependensi efek interval membuat interval di-reset setiap kali posisi berubah
 * (~4x/detik). Interval 1000 ms tidak pernah sempat menyala, jadi radius BEKU
 * walau lagu berjalan. Karena itu posisi disimpan di ref: interval tidak pernah
 * di-reset, nilainya dibaca segar saat menyala.
 */
export function useProgresKaset(
  positionMs: number,
  durationMs: number,
  videoId: string | undefined,
  jedaMs = 1000,
) {
  const posisiRef = useRef(positionMs);
  const durasiRef = useRef(durationMs);
  posisiRef.current = positionMs;
  durasiRef.current = durationMs;

  const hitung = () =>
    durasiRef.current > 0 ? Math.min(1, Math.max(0, posisiRef.current / durasiRef.current)) : 0;

  const [progres, setProgres] = useState(hitung);

  // Segarkan segera saat lagu berganti atau durasi baru diketahui.
  useEffect(() => {
    // `hitung` sengaja tidak masuk daftar dependensi: ia fungsi baru tiap
    // render dan akan membuat efek ini jalan terus. Posisi/durasi dibaca dari
    // ref, jadi nilai yang dipakai selalu yang terbaru.
    setProgres(hitung());
  }, [videoId, durationMs]);

  // Satu interval untuk seluruh umur komponen; hanya `jedaMs` yang mengubahnya.
  // `positionMs` TIDAK boleh jadi dependensi di sini — lihat catatan di atas.
  useEffect(() => {
    const t = window.setInterval(() => setProgres(hitung()), jedaMs);
    return () => window.clearInterval(t);
  }, [jedaMs]);

  return progres;
}
