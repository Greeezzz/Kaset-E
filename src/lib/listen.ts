import { invoke } from "./tauri";

/**
 * Pencatat waktu mendengar (Fase 4a).
 *
 * Aturan yang sama dengan `Akumulator` di Rust (`src-tauri/src/db/listen.rs`):
 * hanya perubahan posisi yang wajar yang dihitung, seek dan pause tidak.
 * Logikanya diduplikasi di sini — bukan karena malas memakai Rust — tapi
 * karena perhitungan delta harus terjadi pada event `timeupdate` (4×/detik),
 * dan menyeberangi IPC 4×/detik untuk sekadar menghitung selisih adalah
 * pemborosan. Yang menyeberang hanya potongan 5 detik sekali.
 *
 * Android nanti memakai versi Rust-nya, jadi kedua implementasi harus tetap
 * sepakat. Ambang di bawah ini adalah kontrak bersama.
 */

/** Geseran di atas ini dianggap seek, bukan pemutaran. */
const AMBANG_SEEK_MS = 2_000;
/** Potongan disimpan tiap 5 detik terkumpul. */
const MIN_SIMPAN_MS = 5_000;

interface Potongan {
  videoId: string;
  deltaMs: number;
  startedAt: number;
}

class PencatatMendengar {
  private videoId: string | null = null;
  private posisiTerakhir: number | null = null;
  private mulai = 0;
  private terkumpul = 0;
  /** Antrean tulis: menjamin urutan dan mencegah kebanjiran IPC. */
  private antrean: Potongan[] = [];
  private menulis = false;

  /** Ganti lagu: sisa potongan lagu lama dikirim dulu, jangan hilang. */
  gantiLagu(videoId: string) {
    this.kuras();
    if (this.videoId !== videoId) {
      this.videoId = videoId;
      this.posisiTerakhir = null;
      this.mulai = Date.now();
      this.terkumpul = 0;
    }
  }

  /**
   * Catat posisi dari elemen audio. Dipanggil pada setiap `timeupdate`.
   *
   * `Date.now()` dipakai sebagai `startedAt` — waktu potongan itu dimulai.
   */
  catat(posisiMs: number) {
    if (!this.videoId) return;

    const sebelum = this.posisiTerakhir;
    this.posisiTerakhir = posisiMs;

    if (sebelum === null) return;

    const delta = posisiMs - sebelum;
    // Mundur (replay) atau loncat jauh (seek) bukan waktu mendengar.
    if (delta <= 0 || delta > AMBANG_SEEK_MS) {
      this.kuras();
      this.mulai = Date.now();
      return;
    }

    this.terkumpul += delta;
    if (this.terkumpul >= MIN_SIMPAN_MS) this.kuras();
  }

  /** Buang lagu aktif (mis. antrean dikosongkan). */
  reset() {
    this.kuras();
    this.videoId = null;
    this.posisiTerakhir = null;
    this.terkumpul = 0;
  }

  /** Kirim potongan yang terkumpul ke Rust. */
  private kuras() {
    if (!this.videoId || this.terkumpul <= 0) {
      this.terkumpul = 0;
      return;
    }
    this.antrean.push({
      videoId: this.videoId,
      deltaMs: this.terkumpul,
      startedAt: this.mulai,
    });
    this.terkumpul = 0;
    this.mulai = Date.now();
    void this.tulis();
  }

  /**
   * Tulis antrean satu per satu.
   *
   * Serial, bukan `Promise.all`: SQLite menulis lebih baik berurutan, dan
   * kegagalan satu potongan tidak boleh membuat potongan lain menumpuk di
   * memori. Kegagalan diabaikan — statistik bukan fitur yang boleh
   * mengganggu pemutaran.
   */
  private async tulis() {
    if (this.menulis) return;
    this.menulis = true;
    try {
      while (this.antrean.length > 0) {
        const p = this.antrean.shift()!;
        try {
          await invoke("listen_record", {
            videoId: p.videoId,
            deltaMs: p.deltaMs,
            startedAt: p.startedAt,
          });
        } catch (e) {
          console.info(`[listen] gagal mencatat ${p.videoId}: ${String(e)}`);
        }
      }
    } finally {
      this.menulis = false;
    }
  }
}

export const pencatatMendengar = new PencatatMendengar();

/** Ringkasan statistik dari Rust (dipakai layar Stats di Fase 4b). */
export interface RingkasanMendengar {
  totalMs: number;
  jumlahLaguUnik: number;
  jumlahPutar: number;
}

export function ambilRingkasan(): Promise<RingkasanMendengar> {
  return invoke<RingkasanMendengar>("listen_summary");
}

export function hapusStatistik(): Promise<number> {
  return invoke<number>("listen_clear");
}
