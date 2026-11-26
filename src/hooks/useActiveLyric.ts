import { useEffect, useRef, useState } from "react";
import type { LyricsResponse } from "../types";
import { audioEngine } from "../lib/audio";
import { invoke } from "../lib/tauri";

/**
 * Hook hemat daya untuk mengambil lirik lagu dan mendeteksi baris lirik aktif saat memutar.
 *
 * Sesuai prinsip §4 & §5 I1:
 * - Mengambil lirik dari DB via `lyrics_get`.
 * - `requestAnimationFrame` hanya berjalan saat `isPlaying === true` dan window terlihat.
 * - Membaca posisi via `audioEngine.positionMs()`.
 * - State hanya di-update saat baris aktif benar-benar berubah (mencegah re-render yang tidak perlu).
 */
export function useActiveLyric(videoId: string | undefined, isPlaying: boolean) {
  const [lyricsData, setLyricsData] = useState<LyricsResponse | null>(null);
  const [activeLineText, setActiveLineText] = useState<string | null>(null);

  const lyricsRef = useRef(lyricsData);
  lyricsRef.current = lyricsData;

  const lastActiveTextRef = useRef<string | null>(null);

  // Ambil data lirik saat videoId berubah
  useEffect(() => {
    if (!videoId) {
      setLyricsData(null);
      setActiveLineText(null);
      lastActiveTextRef.current = null;
      return;
    }

    let cancelled = false;
    void invoke<LyricsResponse | null>("lyrics_get", { videoId })
      .then((res) => {
        if (!cancelled) {
          setLyricsData(res);
          setActiveLineText(null);
          lastActiveTextRef.current = null;
        }
      })
      .catch((e) => {
        console.warn("Gagal membaca lirik untuk LCD kaset:", e);
      });

    return () => {
      cancelled = true;
    };
  }, [videoId]);

  // Pantau baris aktif saat memutar
  useEffect(() => {
    if (!isPlaying || !lyricsData?.parsed.is_synced || lyricsData.parsed.lines.length === 0) {
      if (!isPlaying && lyricsData?.parsed.is_synced) {
        // Saat dijeda, tetap pertahankan baris aktif terakhir
        return;
      }
      return;
    }

    let rafId: number;

    const tick = () => {
      if (document.hidden) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const current = lyricsRef.current;
      if (!current || !current.parsed.is_synced) return;

      const lines = current.parsed.lines;
      const currentPos = audioEngine.positionMs();
      const effectivePos = currentPos + current.parsed.file_offset_ms + current.offset_ms;

      // Binary search baris aktif terakhir O(log n)
      let low = 0;
      let high = lines.length - 1;
      let targetIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lines[mid].time_ms <= effectivePos) {
          targetIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      const nextText = targetIdx >= 0 ? lines[targetIdx].text : null;
      if (nextText !== lastActiveTextRef.current) {
        lastActiveTextRef.current = nextText;
        setActiveLineText(nextText);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, lyricsData]);

  return {
    lyricsData,
    activeLineText,
    hasSyncedLyrics: Boolean(lyricsData?.parsed.is_synced && lyricsData.parsed.lines.length > 0),
  };
}
