import { useCallback, useEffect, useState } from "react";
import { invoke, listen } from "../lib/tauri";
import type { QueueItem, RepeatMode, Track } from "../types";

/** Bentuk data dari command antrean di Rust. */
export interface QueueView {
  items: QueueItem[];
  cursor: number;
  shuffle: boolean;
  /** Jenis shuffle: `true` = pintar (berbobot dari riwayat), `false` = rata. */
  shufflePintar: boolean;
  repeat: RepeatMode;
  current: Track | null;
}

const EMPTY: QueueView = {
  items: [],
  cursor: 0,
  shuffle: false,
  shufflePintar: false,
  repeat: "off",
  current: null,
};

/**
 * Antrean pemutaran. Rust adalah sumber kebenaran: setiap command mengembalikan
 * keadaan terbaru, dan hook ini hanya menyimpannya untuk dirender.
 *
 * Setiap mutasi juga disimpan ke SQLite di sisi Rust (lewat `with_queue`), jadi
 * antrean pulih sendiri saat aplikasi dibuka lagi — UI tidak perlu tahu.
 */
export function useQueue() {
  const [view, setView] = useState<QueueView>(EMPTY);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setView(await invoke<QueueView>("queue_get"));
    } catch (err) {
      console.error("queue_get gagal:", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Event dari Rust (kalau nanti ada perubahan dari sisi backend).
    const un = listen("queue://changed", (items: QueueItem[]) => setView((v) => ({ ...v, items })));
    return () => {
      void un.then((f) => f());
    };
  }, [refresh]);

  /** Bungkus mutasi: set hasil, dan jangan biarkan klik ganda menumpuk. */
  const run = useCallback(async (cmd: string, args?: Record<string, unknown>) => {
    setBusy(true);
    try {
      const next = await invoke<QueueView>(cmd, args);
      setView(next);
      return next;
    } catch (err) {
      console.error(`${cmd} gagal:`, err);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    view,
    busy,
    refresh,
    add: (track: Track) => run("queue_add", { track }),
    /** Tambah lagu dan langsung jadikan aktif (cursor pindah ke lagu itu). */
    playNow: (track: Track) => run("queue_play_now", { track }),
    remove: (position: number) => run("queue_remove", { position }),
    move: (from: number, to: number) => run("queue_move", { from, to }),
    clear: () => run("queue_clear"),
    replace: (tracks: Track[], startIndex = 0) => run("queue_replace", { tracks, startIndex }),
    jump: (position: number) => run("queue_jump", { position }),
    setShuffle: (enabled: boolean) => run("set_shuffle", { enabled }),
    /**
     * Pilih jenis shuffle. Backend membaca ulang riwayat mendengar dari
     * database saat dipanggil, jadi tidak perlu mengirim statistik dari sini.
     */
    setShufflePintar: (enabled: boolean) => run("set_shuffle_pintar", { enabled }),
    setRepeat: (mode: RepeatMode) => run("set_repeat", { mode }),
    /** Maju ke lagu berikutnya. `null` = antrean habis. */
    next: async () => {
      const r = await invoke<QueueView | null>("queue_next");
      if (r) setView(r);
      return r;
    },
    previous: async () => {
      const r = await invoke<QueueView | null>("queue_previous");
      if (r) setView(r);
      return r;
    },
  };
}
