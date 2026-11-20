/**
 * Cache URL stream + pemulihan otomatis saat URL ditolak server.
 *
 * Masalahnya: URL googlevideo berumur sekitar 6 jam, tapi bisa ditolak jauh
 * lebih awal (IP berubah, server menolak, kebijakan berubah). Kalau tidak
 * ditangani, lagu mati di tengah dengan pesan error — dan user harus mengklik
 * ulang sendiri.
 *
 * Tiga lapis, dari yang paling murah:
 *
 * 1. Cache di memori. Lagu yang sama tidak perlu di-resolve ulang setiap kali
 *    diputar — resolve memanggil yt-dlp dan memakan beberapa detik.
 * 2. Cek umur sebelum dipakai. Kalau sudah lewat `expiresAtMs`, resolve dulu.
 * 3. Pulihkan saat ditolak. Kalau audio gagal dengan error jaringan/sumber,
 *    resolve ulang sekali dan lanjut dari posisi terakhir.
 *
 * Yang SENGAJA tidak dilakukan: mencocokkan teks pesan error untuk menebak
 * "403". Kode `MediaError` sudah cukup jujur (2 = jaringan, 4 = sumber tidak
 * bisa dipakai), dan menebak dari string akan pecah begitu Chromium mengubah
 * kata-katanya.
 */

import { invoke } from "./tauri";

export interface ResolvedStream {
  url: string;
  mime: string;
  bitrateKbps: number | null;
  expiresAtMs: number;
}

/** Margin sebelum kedaluwarsa. Resolve memakan beberapa detik; kalau dipakai
 *  tepat di batas, URL bisa mati sebelum audionya selesai dimuat. */
const EXPIRY_MARGIN_MS = 60_000;

/** Batas umur entri cache walau belum kedaluwarsa — jangan menahan URL terlalu
 *  lama di memori hanya karena server memberi umur panjang. */
const MAX_CACHE_AGE_MS = 30 * 60_000;

interface Entry {
  stream: ResolvedStream;
  fetchedAt: number;
}

export class StreamCache {
  private entries = new Map<string, Entry>();
  /** Resolve yang sedang berjalan per videoId. Tanpa ini, dua klik cepat pada
   *  lagu yang sama akan menjalankan yt-dlp dua kali. */
  private inflight = new Map<string, Promise<ResolvedStream>>();

  /** Ambil URL yang masih layak dipakai, atau resolve baru. */
  async get(videoId: string, force = false): Promise<ResolvedStream> {
    if (!force) {
      const cached = this.entries.get(videoId);
      if (cached && this.masihLayak(cached)) return cached.stream;
      // Buang entri yang sudah tidak layak supaya tidak menumpuk.
      if (cached) this.entries.delete(videoId);
    }

    const running = this.inflight.get(videoId);
    if (running) return running;

    const p = this.resolve(videoId);
    this.inflight.set(videoId, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(videoId);
    }
  }

  /** Buang cache lagu ini. Dipanggil saat audionya ditolak server: URL yang
   *  gagal tidak boleh dipakai lagi walau umurnya masih panjang. */
  invalidate(videoId: string) {
    this.entries.delete(videoId);
  }

  clear() {
    this.entries.clear();
  }

  /** Untuk pengujian: berapa entri yang tersimpan. */
  size(): number {
    return this.entries.size;
  }

  /** Untuk pengujian: apakah lagu ini ada di cache. */
  has(videoId: string): boolean {
    return this.entries.has(videoId);
  }

  private masihLayak(e: Entry, now = Date.now()): boolean {
    if (now - e.fetchedAt > MAX_CACHE_AGE_MS) return false;
    return now + EXPIRY_MARGIN_MS < e.stream.expiresAtMs;
  }

  private async resolve(videoId: string): Promise<ResolvedStream> {
    const stream = await invoke<ResolvedStream>("resolve_stream", { videoId });
    // Jangan menyimpan URL yang sudah kedaluwarsa sejak lahir — itu akan
    // membuat setiap pemutaran berikutnya gagal juga.
    if (this.masihLayak({ stream, fetchedAt: Date.now() })) {
      this.entries.set(videoId, { stream, fetchedAt: Date.now() });
    }
    return stream;
  }
}

/** Satu instance untuk seluruh aplikasi. */
export const streamCache = new StreamCache();

// Hook debug, sama seperti pada audio engine: cache hidup di modul dan tidak
// terlihat dari DevTools, jadi tanpa ini perilakunya tidak bisa diperiksa saat
// menguji pemulihan stream. Tidak dipakai kode produksi.
if (typeof window !== "undefined") {
  (window as unknown as { __kasetStreams?: StreamCache }).__kasetStreams = streamCache;
}

/**
 * Apakah kegagalan audio ini layak dicoba dengan URL baru?
 *
 * Kode MediaError: 1 = aborted (user pindah lagu — bukan kegagalan),
 * 2 = network, 3 = decode, 4 = sumber tidak didukung.
 *
 * Hanya 2 dan 4 yang bisa sembuh dari resolve ulang. Decode (3) berarti datanya
 * rusak, dan URL baru akan memberi data yang sama.
 */
export function bisaDipulihkan(mediaErrorCode: number | null | undefined): boolean {
  return mediaErrorCode === 2 || mediaErrorCode === 4;
}
