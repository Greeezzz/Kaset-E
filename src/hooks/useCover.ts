/**
 * Hook cover art. Satu cache di level modul supaya 50 baris daftar lagu tidak
 * memanggil Rust 50 kali untuk cover yang sama.
 */
import { useEffect, useState } from "react";

import { coverUrl, mintaCover, onCoverReady } from "../lib/cover";

/** key -> URL siap pakai, atau null kalau memang tidak ada. */
const cache = new Map<string, string | null>();
const menunggu = new Set<() => void>();

let langgananTerpasang = false;

async function pasangLangganan() {
  if (langgananTerpasang) return;
  langgananTerpasang = true;
  await onCoverReady((key, url) => {
    cache.set(key, url);
    menunggu.forEach((cb) => cb());
  });
}

/**
 * Minta URL cover untuk satu kunci. Mengembalikan null selama belum tersedia —
 * pemanggil harus menampilkan placeholder, bukan kotak kosong.
 */
export function useCover(key: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (key ? (cache.get(key) ?? null) : null));

  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }

    const sudah = cache.get(key);
    if (sudah !== undefined) {
      setUrl(sudah);
      return;
    }

    let hidup = true;
    void pasangLangganan();

    void mintaCover(key).then((path) => {
      const u = coverUrl(path);
      cache.set(key, u);
      if (hidup) setUrl(u);
    });

    // Cover bisa selesai diunduh belakangan; hook ini ikut menukar placeholder.
    const cb = () => {
      const u = cache.get(key) ?? null;
      if (hidup) setUrl(u);
    };
    menunggu.add(cb);

    return () => {
      hidup = false;
      menunggu.delete(cb);
    };
  }, [key]);

  return url;
}
