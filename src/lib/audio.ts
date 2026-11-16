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
  onError: (message: string) => void;
  onPlaying: () => void;
  onPaused: () => void;
}

export class AudioEngine {
  private el: HTMLAudioElement;
  private events: Partial<AudioEngineEvents> = {};

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
      this.events.onTime?.(Math.round(el.currentTime * 1000), this.durationMs());
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
      this.events.onError?.(detail);
    });
  }

  setEvents(events: Partial<AudioEngineEvents>) {
    this.events = events;
  }

  private durationMs(): number {
    const d = this.el.duration;
    return Number.isFinite(d) ? Math.round(d * 1000) : 0;
  }

  /** Muat URL stream lalu putar. URL berasal dari Rust (sudah divalidasi umurnya). */
  async load(url: string): Promise<void> {
    this.el.src = url;
    this.el.load();
    await this.play();
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch (e) {
      // Autoplay policy / sumber belum siap. Bukan error fatal.
      this.events.onError?.(e instanceof Error ? e.message : "tidak bisa memutar");
    }
  }

  pause() {
    this.el.pause();
  }

  seek(positionMs: number) {
    const secs = positionMs / 1000;
    if (Number.isFinite(secs) && secs >= 0) this.el.currentTime = secs;
  }

  setVolume(volume: number) {
    this.el.volume = Math.min(1, Math.max(0, volume));
  }

  positionMs(): number {
    return Math.round(this.el.currentTime * 1000);
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
