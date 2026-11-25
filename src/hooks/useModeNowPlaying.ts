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

  /**
   * Baca ulang dari `settings`.
   *
   * Dipanggil saat mount DAN setiap kali layar Now Playing dibuka. Tanpa
   * pembacaan ulang, perubahan yang dilakukan di layar Pengaturan tidak
   * terlihat sampai aplikasi dijalankan ulang: hook ini tinggal di `App` yang
   * tidak pernah unmount, sementara `Settings` menulis langsung ke DB.
   * Itu benar-benar terjadi saat diuji — DB berisi "kaset" tapi UI menampilkan
   * STANDAR aktif.
   */
  const muatUlang = useCallback(() => {
    if (!runningInTauri) return;
    void invoke<string | null>("setting_get", { key: KUNCI })
      .then((v) => {
        if (v === "kaset" || v === "standar") setModeState(v);
      })
      .catch(() => {
        // Gagal baca bukan masalah: biarkan nilai yang ada.
      });
  }, []);

  useEffect(() => {
    muatUlang();
  }, [muatUlang]);

  const setMode = useCallback((baru: ModeNowPlaying) => {
    // UI diperbarui lebih dulu supaya tombol terasa langsung; penyimpanan
    // menyusul dan kegagalannya tidak mengembalikan pilihan pengguna di layar.
    setModeState(baru);
    if (!runningInTauri) return;
    void invoke("setting_set", { key: KUNCI, value: baru }).catch(() => {
      // Diam: preferensi tampilan yang gagal tersimpan tidak perlu toast.
    });
  }, []);

  return { mode, setMode, muatUlang };
}
