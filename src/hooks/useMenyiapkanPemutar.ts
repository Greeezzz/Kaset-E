import { useEffect, useState } from "react";
import { invoke, runningInTauri } from "../lib/tauri";

/**
 * Apakah pemutar sedang disiapkan untuk pertama kali.
 *
 * Pemasangan yt-dlp onedir butuh unduhan 22,8 MB + ekstraksi ±3,5 detik. Itu
 * terjadi sekali seumur instalasi, tapi selama berlangsung tombol play tidak
 * melakukan apa pun — tanpa status yang terlihat, pengguna akan mengira
 * aplikasinya rusak.
 *
 * Polling berhenti sendiri setelah resolver hidup, jadi tidak ada beban
 * jaringan/CPU berkelanjutan. Batas 90 detik mencegah polling abadi kalau
 * unduhan macet; setelah itu UI kembali normal dan error muncul di Pengaturan.
 */
export function useMenyiapkanPemutar(): boolean {
  const [menyiapkan, setMenyiapkan] = useState(false);

  useEffect(() => {
    if (!runningInTauri) return;
    let batal = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cek = async () => {
      try {
        const [sibuk, hidup] = await Promise.all([
          invoke<boolean>("resolver_preparing"),
          invoke<boolean>("resolver_status"),
        ]);
        if (batal) return;
        setMenyiapkan(sibuk);
        // Selesai kalau resolver sudah hidup dan tidak ada penyiapan berjalan.
        if (hidup && !sibuk && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        // Gagal membaca status bukan alasan menampilkan banner selamanya.
        if (!batal) setMenyiapkan(false);
      }
    };

    void cek();
    timer = setInterval(() => void cek(), 1000);
    const berhenti = setTimeout(() => {
      if (timer) clearInterval(timer);
      timer = null;
    }, 90_000);

    return () => {
      batal = true;
      if (timer) clearInterval(timer);
      clearTimeout(berhenti);
    };
  }, []);

  return menyiapkan;
}
