/**
 * Engine audio desktop memakai elemen <audio> di webview.
 *
 * Kenapa webview, bukan rodio di Rust? ARCHITECTURE.md §10 membiarkan ini
 * terbuka dan menyuruh mulai dari yang paling cepat jadi. Memakai <audio>
 * berarti: tidak perlu decode/streaming manual di Rust, seek & volume gratis,
 * dan format webm/opus yang dikembalikan yt-dlp langsung didukung Chromium.
 * Kalau nanti ada masalah (gapless, crossfade, background di Android), tinggal
 * ganti implementasi di balik antarmuka yang sama.
 *
 * Prinsip dari AGENTS.md tetap dipegang: Rust adalah sumber kebenaran untuk
 * queue/posisi. File ini hanya aktuator — ia memutar apa yang diperintahkan
 * dan melaporkan apa yang terjadi.
 */

export interface AudioEngineEvents {
  onTime: (positionMs: number, durationMs: number) => void;
  onEnded: () => void;
  onError: (message: string, mediaErrorCode: number | null) => void;
  onPlaying: () => void;
  onPaused: () => void;
}

export class AudioEngine {
  private el: HTMLAudioElement;
  private events: Partial<AudioEngineEvents> = {};
  /**
   * Posisi terakhir yang benar-benar diputar dengan data yang sehat.
   *
   * Kenapa harus di sini, bukan di UI: ketika sumber gagal, elemen tetap
   * memicu `timeupdate` dengan posisi 0 sambil `paused` masih false sesaat.
   * Angka itu akan menimpa posisi sebenarnya dan membuat pemulihan kembali ke
   * detik nol. Engine tahu pasti kapan audionya sehat (`readyState` cukup dan
   * tidak sedang error), jadi di sinilah penjagaannya bisa dipercaya.
   */
  private lastGoodMs = 0;

  constructor() {
    const el = new Audio();
    el.preload = "auto";
    // JANGAN set crossOrigin di sini. Server googlevideo tidak mengirim header
    // CORS, jadi `crossOrigin="anonymous"` membuat Chromium menolak audionya
    // (ERR_FAILED). Tanpa atribut ini elemen audio memutar seperti biasa.
    // Konsekuensinya: WebAudio/analyser tidak bisa membaca sampel cross-origin —
    // itu tidak kita butuhkan.
    this.el = el;

    el.addEventListener("timeupdate", () => {
      const ms = Math.round(el.currentTime * 1000);
      // `readyState >= 2` = HAVE_CURRENT_DATA: ada frame data untuk posisi ini.
      // Tanpa syarat ini, posisi 0 dari sumber yang gagal ikut tercatat.
      if (el.readyState >= 2 && !el.error && !el.paused && ms > this.lastGoodMs) {
        this.lastGoodMs = ms;
      }
      this.events.onTime?.(ms, this.durationMs());
    });
    el.addEventListener("ended", () => this.events.onEnded?.());
    el.addEventListener("playing", () => this.events.onPlaying?.());
    el.addEventListener("pause", () => this.events.onPaused?.());
    el.addEventListener("error", () => {
      // Kode MediaError: 1=aborted, 2=network, 3=decode, 4=src tidak didukung.
      const code = el.error?.code;
      const detail =
        code === 3
          ? "format audio tidak didukung"
          : code === 2
            ? "jaringan gagal saat memuat audio"
            : code === 4
              ? "URL audio tidak bisa diputar (mungkin kedaluwarsa)"
              : "gagal memutar audio";
      // Kode ikut dikirim karena hanya 2 (jaringan) dan 4 (sumber tidak bisa
      // dipakai) yang bisa sembuh dengan URL baru. Tanpa kode, pemanggil harus
      // menebak dari teks — dan teks itu bisa berubah kapan saja.
      this.events.onError?.(detail, code ?? null);
    });
  }

  setEvents(events: Partial<AudioEngineEvents>) {
    this.events = events;
  }

  private durationMs(): number {
    const d = this.el.duration;
    return Number.isFinite(d) ? Math.round(d * 1000) : 0;
  }

  /** Muat URL stream lalu putar. URL berasal dari Rust (sudah divalidasi umurnya).
   *
   *  `startAtMs` dipakai saat memulihkan URL yang ditolak: user tidak boleh
   *  dikembalikan ke detik 0 hanya karena URL-nya diganti. */
  async load(url: string, startAtMs = 0): Promise<void> {
    this.el.src = url;
    this.el.load();
    // Posisi awal yang diminta dianggap titik sehat — kalau tidak, seek ke
    // 120 detik akan tercatat sebagai 0 dan pemulihan berikutnya salah.
    this.lastGoodMs = startAtMs;
    if (startAtMs > 0) {
      // Metadata belum tentu siap; `loadedmetadata` adalah titik paling awal
      // di mana `currentTime` bisa di-set tanpa diabaikan browser.
      await new Promise<void>((resolve) => {
        const onReady = () => {
          this.el.removeEventListener("loadedmetadata", onReady);
          resolve();
        };
        this.el.addEventListener("loadedmetadata", onReady);
        // Kalau metadata sudah ada (dari cache), jangan menunggu selamanya.
        if (this.el.readyState >= 1) onReady();
        window.setTimeout(onReady, 3000);
      });
      this.seek(startAtMs);
    }
    await this.play();
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch (e) {
      // `play()` menolak untuk dua sebab yang sangat berbeda:
      //
      // 1. Autoplay policy — bukan masalah sumber, jangan pulihkan URL.
      // 2. Sumber gagal dimuat — elemen sudah menyimpan kode MediaError, dan
      //    itulah yang harus diteruskan. Tanpa membaca `el.error` di sini,
      //    kegagalan sumber akan terlihat seperti kegagalan autoplay (kode
      //    null) dan pemulihan URL tidak akan pernah terjadi.
      const code = this.el.error?.code ?? null;
      this.events.onError?.(e instanceof Error ? e.message : "tidak bisa memutar", code);
    }
  }

  pause() {
    this.el.pause();
  }

  seek(positionMs: number) {
    const secs = positionMs / 1000;
    if (!Number.isFinite(secs) || secs < 0) return;
    this.el.currentTime = secs;
    // Seek yang berhasil adalah posisi sehat baru. Tanpa ini, melompat ke
    // menit 3 lalu kena kegagalan sumber akan memulihkan ke menit 0 — user
    // dikembalikan ke tempat yang sudah ia tinggalkan.
    this.lastGoodMs = Math.round(secs * 1000);
  }

  setVolume(volume: number) {
    this.el.volume = Math.min(1, Math.max(0, volume));
  }

  positionMs(): number {
    return Math.round(this.el.currentTime * 1000);
  }

  /**
   * Posisi terakhir yang terbukti diputar. Dipakai saat memulihkan sumber yang
   * ditolak: `positionMs()` sudah tidak bisa dipercaya pada titik itu.
   */
  lastGoodPositionMs(): number {
    return this.lastGoodMs;
  }

  durationMsPublic(): number {
    return this.durationMs();
  }

  isPlaying(): boolean {
    return !this.el.paused && !this.el.ended;
  }

  /** Akses read-only untuk pengujian/debug. */
  debugState() {
    return {
      src: this.el.currentSrc || this.el.src,
      paused: this.el.paused,
      currentTime: this.el.currentTime,
      duration: this.el.duration,
      readyState: this.el.readyState,
      networkState: this.el.networkState,
      volume: this.el.volume,
    };
  }

  stop() {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
}

/** Satu instance untuk seluruh aplikasi — audio tidak boleh dobel. */
export const audioEngine = new AudioEngine();

// Hook debug: elemen <audio> dibuat lewat `new Audio()` dan tidak di-append ke
// DOM, jadi tanpa ini tidak ada cara memeriksa state audio dari DevTools/CDP
// saat menguji. Tidak dipakai kode produksi.
if (typeof window !== "undefined") {
  (window as unknown as { __kasetAudio?: AudioEngine }).__kasetAudio = audioEngine;
}
