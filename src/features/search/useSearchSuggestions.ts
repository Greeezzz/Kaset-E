import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "../../lib/tauri";

export interface ItemSaran {
  /** Teks yang akan dipakai sebagai kata kunci. */
  query: string;
  /** "riwayat" = pernah dicari; "saran" = dari YouTube Music. */
  jenis: "riwayat" | "saran";
  /** Berapa kali pernah dicari (khusus riwayat). */
  hits?: number;
}

/**
 * Saran pencarian: gabungan riwayat lokal + saran katalog.
 *
 * Aturan yang penting di sini:
 * - Riwayat lokal SELALU tampil lebih dulu dan tidak menunggu jaringan.
 * - Saran katalog memakai debounce 250 ms; tanpa itu setiap huruf memicu satu
 *   permintaan ke YouTube dan kita akan kena rate-limit dalam hitungan detik.
 * - Hasil yang sudah basi dibuang: user bisa mengetik lebih cepat daripada
 *   jawaban server, dan saran untuk "rad" tidak boleh menimpa saran "radiohead".
 * - Gagal jaringan bukan error yang ditampilkan — riwayat tetap berguna.
 */
export function useSearchSuggestions(query: string, aktif: boolean) {
  const [riwayat, setRiwayat] = useState<ItemSaran[]>([]);
  const [saran, setSaran] = useState<string[]>([]);
  const [memuat, setMemuat] = useState(false);

  // Nomor urut permintaan: hanya jawaban terbaru yang boleh mengubah state.
  const urutRef = useRef(0);

  const muatRiwayat = useCallback(async (limit = 6) => {
    try {
      const rows = await invoke<{ query: string; hits: number }[]>("search_history_list", {
        limit,
      });
      setRiwayat(rows.map((r) => ({ query: r.query, jenis: "riwayat" as const, hits: r.hits })));
    } catch {
      // Riwayat hanya pelengkap; gagal baca tidak perlu mengganggu UI.
      setRiwayat([]);
    }
  }, []);

  // Muat riwayat saat panel dibuka.
  useEffect(() => {
    if (aktif) void muatRiwayat();
  }, [aktif, muatRiwayat]);

  // Saran katalog, dengan debounce.
  useEffect(() => {
    const q = query.trim();

    if (!aktif || q.length < 2) {
      setSaran([]);
      setMemuat(false);
      return;
    }

    const urut = ++urutRef.current;
    setMemuat(true);

    const timer = window.setTimeout(() => {
      void invoke<string[]>("search_suggestions", { query: q })
        .then((hasil) => {
          // Buang jawaban yang sudah tidak relevan.
          if (urut !== urutRef.current) return;
          setSaran(Array.isArray(hasil) ? hasil.slice(0, 8) : []);
        })
        .catch(() => {
          if (urut === urutRef.current) setSaran([]);
        })
        .finally(() => {
          if (urut === urutRef.current) setMemuat(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, aktif]);

  /** Gabungkan: riwayat dulu, lalu saran yang belum ada di riwayat. */
  const items: ItemSaran[] = (() => {
    const q = query.trim().toLowerCase();
    const riwayatCocok = riwayat.filter((r) => (q ? r.query.toLowerCase().includes(q) : true));

    // Saran katalog bisa mengulang isi riwayat (mis. "daft punk" ada di
    // keduanya), dan itu harus dibuang: baris kembar di daftar terlihat
    // seperti bug. Dedupe juga menjaga kalau katalog mengirim entri kembar.
    const sudahAda = new Set(riwayatCocok.map((r) => r.query.toLowerCase()));
    const saranBaru: ItemSaran[] = [];
    for (const mentah of saran) {
      const bersih = mentah.trim();
      const kunci = bersih.toLowerCase();
      if (!kunci || sudahAda.has(kunci)) continue;
      sudahAda.add(kunci);
      saranBaru.push({ query: bersih, jenis: "saran" });
    }

    return [...riwayatCocok, ...saranBaru].slice(0, 10);
  })();

  const hapusRiwayat = useCallback(
    async (q: string) => {
      setRiwayat((r) => r.filter((x) => x.query !== q));
      try {
        await invoke("search_history_remove", { query: q });
      } catch {
        // Kalau gagal, muat ulang supaya UI tidak berbohong.
        void muatRiwayat();
      }
    },
    [muatRiwayat],
  );

  const kosongkanRiwayat = useCallback(async () => {
    setRiwayat([]);
    try {
      await invoke("search_history_clear");
    } catch {
      void muatRiwayat();
    }
  }, [muatRiwayat]);

  return { items, memuat, riwayat, hapusRiwayat, kosongkanRiwayat, muatRiwayat };
}
