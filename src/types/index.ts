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
  /** Lagu yang pengguna tambahkan sendiri — selalu diputar sebelum lagu acak. */
  prioritas: boolean;
  /** Urutan penambahan antar lagu prioritas. */
  prioritasUrut: number;
  /**
   * Cursor sudah melewati lagu ini. Disimpan di database supaya lagu prioritas
   * yang sudah diputar tidak muncul lagi sebagai "berikutnya" setelah aplikasi
   * dibuka ulang. UI tidak perlu membacanya: panel Antrean hanya menampilkan
   * `position > cursor`.
   */
  sudahDiputar: boolean;
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

export interface LyricLine {
  time_ms: number;
  text: string;
  romanized?: string | null;
}

export interface ParsedLyrics {
  is_synced: boolean;
  file_offset_ms: number;
  lines: LyricLine[];
}

export interface LyricsResponse {
  video_id: string;
  lrc: string;
  sumber: "impor" | "lrclib" | string;
  offset_ms: number;
  diambil_pada: number;
  parsed: ParsedLyrics;
}
