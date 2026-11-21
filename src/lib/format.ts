/** Format durasi ms → "m:ss" atau "h:mm:ss". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Format total durasi daftar lagu → "1 JAM 38 MENIT" / "42 MENIT". */
export function formatTotalDuration(tracks: readonly { durationMs: number | null }[]): string {
  let totalMs = 0;
  for (const t of tracks) {
    if (t.durationMs != null && Number.isFinite(t.durationMs) && t.durationMs > 0) {
      totalMs += t.durationMs;
    }
  }
  if (totalMs <= 0) return "";
  const totalMenit = Math.floor(totalMs / 60_000);
  if (totalMenit < 1) return "< 1 MENIT";
  const jam = Math.floor(totalMenit / 60);
  const menit = totalMenit % 60;
  if (jam > 0) {
    return menit > 0 ? `${jam} JAM ${menit} MENIT` : `${jam} JAM`;
  }
  return `${menit} MENIT`;
}

/** Inisial untuk placeholder cover: maksimal 2 karakter, dari judul. */
export function initials(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "♪";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Hash FNV-1a 32-bit. Dipakai supaya placeholder cover deterministik per lagu. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
