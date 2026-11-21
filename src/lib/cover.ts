/**
 * Cover art: satu tempat untuk lookup cache, unduh background, dan konversi
 * path lokal jadi URL yang bisa dibaca webview.
 *
 * Kenapa tidak langsung `src={path}`? Path dari Rust berbentuk `C:\...` dan
 * webview menolaknya. `convertFileSrc` mengubahnya jadi URL protokol asset
 * (`http://asset.localhost/...`) yang diizinkan scope di tauri.conf.json.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

import { listen, runningInTauri } from "./tauri";

type CoverLookup = { key: string; path: string | null; status: string };
type CoverDownload = { key: string; path: string | null; status: string };

/** Hasil sinkron dari cache: null kalau belum ada. */
async function invokeCoverGet(key: string): Promise<CoverLookup | null> {
  const { invoke } = await import("./tauri");
  try {
    return await invoke<CoverLookup>("cover_get", { key });
  } catch {
    return null;
  }
}

async function invokeCoverDownload(key: string): Promise<CoverDownload | null> {
  const { invoke } = await import("./tauri");
  try {
    return await invoke<CoverDownload>("cover_download", { key });
  } catch {
    return null;
  }
}

/** Ubah path file lokal jadi URL yang bisa dipakai <img>. */
export function coverUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!runningInTauri) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

/** Antrean unduh seri — THUMBNAILS.md §5 melarang paralel supaya tidak kena
 *  rate-limit YouTube. Satu unduhan jalan pada satu waktu. */
const antrean: string[] = [];
const sedangDiunduh = new Set<string>();
const sudahDicoba = new Set<string>();
let sedangJalan = false;

async function prosesAntrean(): Promise<void> {
  if (sedangJalan) return;
  sedangJalan = true;
  try {
    while (antrean.length > 0) {
      const key = antrean.shift();
      if (!key) continue;
      try {
        await invokeCoverDownload(key);
      } catch {
        // Cover bukan hal krusial (THUMBNAILS.md §6): jangan lempar ke UI.
      }
    }
  } finally {
    sedangJalan = false;
  }
}

/**
 * Minta cover untuk satu lagu. Mengembalikan path lokal kalau sudah ada di
 * cache; kalau belum, mendaftarkan unduhan background dan mengembalikan null
 * (UI langsung render placeholder, tanpa menunggu jaringan).
 */
export async function mintaCover(key: string): Promise<string | null> {
  const ada = await invokeCoverGet(key);
  if (ada?.path) return ada.path;

  // Jangan ulang video yang sudah pernah gagal — status 'error' berarti semua
  // tangga kualitas sudah dicoba.
  if (ada?.status === "error") return null;

  if (!sedangDiunduh.has(key) && !sudahDicoba.has(key)) {
    sudahDicoba.add(key);
    antrean.push(key);
    void prosesAntrean();
  }
  return null;
}

/** Dengarkan cover yang baru selesai diunduh supaya UI bisa menukar placeholder
 *  tanpa reload. Mengembalikan fungsi unlisten. */
export async function onCoverReady(
  handler: (key: string, url: string) => void,
): Promise<() => void> {
  return listen("cover://ready", (payload) => {
    const url = coverUrl(payload.path);
    if (url) handler(payload.key, url);
  });
}
