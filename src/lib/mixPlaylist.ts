import type { Track } from "../types";

export type MixMode = "interleaved" | "shuffle" | "sequential";

/**
 * Mencampur daftar lagu dari beberapa playlist menjadi satu antrean.
 * Menghilangkan lagu duplikat berdasarkan `videoId`.
 */
export function mixPlaylists(playlistTrackLists: Track[][], mode: MixMode = "interleaved"): Track[] {
  if (playlistTrackLists.length === 0) return [];
  if (playlistTrackLists.length === 1) return [...playlistTrackLists[0]];

  const seen = new Set<string>();
  const result: Track[] = [];

  const addTrack = (t: Track) => {
    if (!t.videoId || seen.has(t.videoId)) return;
    seen.add(t.videoId);
    result.push(t);
  };

  if (mode === "sequential") {
    for (const list of playlistTrackLists) {
      for (const track of list) {
        addTrack(track);
      }
    }
    return result;
  }

  if (mode === "interleaved") {
    // Ambil lagu secara bergantian dari masing-masing playlist:
    // P1[0], P2[0], P3[0], P1[1], P2[1], P3[1], ...
    const maxLen = Math.max(...playlistTrackLists.map((l) => l.length));
    for (let i = 0; i < maxLen; i++) {
      for (const list of playlistTrackLists) {
        if (i < list.length) {
          addTrack(list[i]);
        }
      }
    }
    return result;
  }

  if (mode === "shuffle") {
    // Gabung semua lagu unik terlebih dahulu
    const pool: Track[] = [];
    for (const list of playlistTrackLists) {
      for (const track of list) {
        if (track.videoId && !seen.has(track.videoId)) {
          seen.add(track.videoId);
          pool.push(track);
        }
      }
    }
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }

  return result;
}
