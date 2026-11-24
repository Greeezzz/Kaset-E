import { useCallback, useEffect, useRef } from "react";
import { streamCache } from "../lib/streamCache";

/**
 * Prefetch saat pengguna menunjuk (hover) satu baris lagu.
 *
 * Kenapa hover, bukan semua hasil pencarian: prefetch setiap hasil akan
 * mengirim 20+ resolve untuk lagu yang belum tentu dipilih. Selain boros, itu
 * membanjiri throttle resolver (1,5 detik antar resolve, `RESILIENCE.md` §5)
 * sehingga lagu yang BENAR-BENAR diklik justru menunggu di belakang resolve
 * yang sia-sia.
 *
 * Aturan yang dipegang:
 *
 * - **Debounce 400 ms.** Kursor yang melintasi daftar tidak memicu resolve.
 * - **Maksimal satu prefetch berjalan.** Kalau pengguna memindah kursor ke lagu
 *   lain, lagu sebelumnya dibatalkan (debounce-nya di-reset) dan hanya lagu
 *   terakhir yang benar-benar di-resolve.
 * - **Tidak pernah mencuri slot lagu aktif.** `streamCache` sudah men-dedupe
 *   per `video_id`, jadi hover pada lagu yang sedang diputar tidak melakukan
 *   apa pun.
 */
const JEDA_HOVER_MS = 400;

export function usePrefetchHover() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terakhir = useRef<string | null>(null);

  const batal = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => batal, [batal]);

  /** Panggil saat kursor masuk ke satu baris. */
  const onHover = useCallback(
    (videoId: string | null | undefined) => {
      if (!videoId) return;
      // Hover ulang pada lagu yang sama tidak menjadwalkan apa pun.
      if (terakhir.current === videoId) return;
      terakhir.current = videoId;
      batal();
      timer.current = setTimeout(() => {
        timer.current = null;
        streamCache.prefetch(videoId);
      }, JEDA_HOVER_MS);
    },
    [batal],
  );

  /** Panggil saat kursor keluar: batalkan yang belum sempat jalan. */
  const onKeluar = useCallback(() => {
    batal();
    terakhir.current = null;
  }, [batal]);

  return { onHover, onKeluar };
}
