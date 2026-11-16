/**
 * Tipe yang mirror struct Rust di src-tauri/src/models.
 * Fase 0: ditulis manual. Kalau jumlahnya membengkak, pertimbangkan ts-rs/specta
 * supaya tidak pernah lagi ada drift manual (lihat ARCHITECTURE.md bagian 8).
 */

export type RepeatMode = "off" | "one" | "all";

export type Quality = "high" | "medium" | "low";

export interface Track {
  videoId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  /** Kunci cover lokal, bukan URL jaringan. */
  coverKey: string;
}

export interface QueueItem {
  /** Posisi di queue yang sedang tampil (setelah shuffle). */
  position: number;
  track: Track;
  /** Posisi asli sebelum shuffle; dipakai untuk membatalkan shuffle. */
  originalOrder: number;
}

export interface PlayerState {
  track: Track | null;
  status: "idle" | "loading" | "playing" | "paused" | "error";
  positionMs: number;
  durationMs: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface SearchResults {
  tracks: Track[];
  albums: { id: string; title: string; artist: string; coverKey: string }[];
  artists: { id: string; name: string; coverKey: string }[];
  playlists: { id: string; title: string; coverKey: string }[];
}
