import { useEffect, useState } from "react";

/**
 * Status animasi kaset: sedang putar atau tidak, dan apakah halaman terlihat.
 *
 * Kenapa hook terpisah, bukan dibaca langsung di komponen:
 *
 * 1. **Animasi harus benar-benar berhenti** saat lagu dijeda ATAU saat jendela
 *    disembunyikan/diterminalkan. CSS `animation-play-state: paused` saja tidak
 *    cukup untuk kasus kedua — browser tetap menghitung frame di beberapa
 *    situasi (mis. jendela tertutup jendela lain di Windows). Dengan mematikan
 *    animasi lewat kelas, tidak ada kerja render sama sekali.
 *
 * 2. **`prefers-reduced-motion` dibaca sekali**, bukan tiap render, dan
 *    perubahan preferensi sistem ikut diikuti (pengguna bisa mengubahnya saat
 *    aplikasi berjalan).
 */
export function useAnimasiKaset(aktif: boolean) {
  const [terlihat, setTerlihat] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );
  const [kurangiGerak, setKurangiGerak] = useState(false);

  useEffect(() => {
    const onVis = () => setTerlihat(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setKurangiGerak(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setKurangiGerak(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return {
    /** Putaran reel: hanya saat lagu benar-benar berbunyi dan terlihat. */
    berputar: aktif && terlihat && !kurangiGerak,
    /** Perubahan radius pita tetap jalan walau gerak dikurangi (itu informasi). */
    tampilkanProgres: aktif && terlihat,
    kurangiGerak,
    terlihat,
  };
}
