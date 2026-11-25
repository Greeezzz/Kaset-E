import { useCallback, useEffect, useState } from "react";
import { invoke, runningInTauri } from "../lib/tauri";

/**
 * Mode tampilan Now Playing: `standar` atau `kaset`.
 *
 * Disimpan di tabel `settings` (kunci `nowplaying.mode`), bukan localStorage,
 * karena ini preferensi aplikasi yang ikut berjalan di Android nanti — di sana
 * tidak ada localStorage per jendela seperti di webview desktop.
 *
 * Default `standar`. Kalau pembacaan gagal (DB rusak, browser tanpa Tauri),
 * mode tetap `standar` — fitur ini tidak boleh menjadi alasan aplikasi gagal
 * menampilkan apa pun.
 */
export type ModeNowPlaying = "standar" | "kaset";

const KUNCI = "nowplaying.mode";

export function useModeNowPlaying() {
  const [mode, setModeState] = useState<ModeNowPlaying>("standar");

  useEffect(() => {
    if (!runningInTauri) return;
    let batal = false;
    void invoke<string | null>("setting_get", { key: KUNCI })
      .then((v) => {
        if (batal) return;
        if (v === "kaset" || v === "standar") setModeState(v);
      })
      .catch(() => {
        // Gagal baca bukan masalah: tetap standar.
      });
    return () => {
      batal = true;
    };
  }, []);

  const setMode = useCallback((baru: ModeNowPlaying) => {
    // UI diperbarui lebih dulu supaya tombol terasa langsung; penyimpanan
    // menyusul dan kegagalannya tidak mengembalikan pilihan pengguna di layar.
    setModeState(baru);
    if (!runningInTauri) return;
    void invoke("setting_set", { key: KUNCI, value: baru }).catch(() => {
      // Diam: preferensi tampilan yang gagal tersimpan tidak perlu toast.
    });
  }, []);

  return { mode, setMode };
}
