import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { CoverArt } from "./CoverArt";
import { PlaylistCover } from "./PlaylistCover";
import { invoke } from "../lib/tauri";

interface Props {
  playlist: {
    id: number;
    name: string;
    coverKeys: string[];
    coverMode: "auto" | "custom" | "generative";
    coverPath: string | null;
  };
  size?: number;
}

/**
 * Cover playlist yang menghormati tiga mode (DESIGN-LAYOUT §5):
 *
 * - `custom`     — gambar hasil upload, sudah di-crop Rust jadi 512×512 JPEG.
 * - `generative` — placeholder deterministik dari judul (CoverArt FNV-1a).
 * - `auto`       — mosaik 4 cover lagu pertama (PlaylistCover).
 *
 * Kenapa komponen terpisah dari `PlaylistCover`: mosaik dan cover kustom punya
 * sumber data berbeda (kunci lagu vs berkas di disk), dan mencampurnya dalam
 * satu komponen membuat keduanya lebih sulit dibaca.
 *
 * Path kustom di-cache di tingkat modul. Tanpa itu, sidebar berisi 30 playlist
 * memanggil command 30 kali setiap render ulang.
 */
const cachePath = new Map<number, string | null>();

export function PlaylistArt({ playlist, size = 44 }: Props) {
  const modeKustom = playlist.coverMode === "custom";
  const [url, setUrl] = useState<string | null>(() =>
    modeKustom ? (cachePath.get(playlist.id) ?? null) : null,
  );

  useEffect(() => {
    if (!modeKustom) {
      setUrl(null);
      return;
    }
    // Kalau cover diganti, `coverPath` berubah (nama file berisi UUID), jadi
    // cache harus dibuang supaya gambar baru yang tampil.
    if (cachePath.has(playlist.id)) {
      setUrl(cachePath.get(playlist.id) ?? null);
      return;
    }
    let batal = false;
    void (async () => {
      try {
        const p = await invoke<string | null>("playlist_cover_path", { id: playlist.id });
        const u = p ? convertFileSrc(p) : null;
        cachePath.set(playlist.id, u);
        if (!batal) setUrl(u);
      } catch {
        if (!batal) setUrl(null);
      }
    })();
    return () => {
      batal = true;
    };
  }, [playlist.id, modeKustom, playlist.coverPath]);

  if (modeKustom && url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, flex: `0 0 ${size}px`, objectFit: "cover" }}
      />
    );
  }

  if (playlist.coverMode === "generative") {
    return <CoverArt coverKey={null} title={playlist.name} size={size} radius={0} />;
  }

  return <PlaylistCover coverKeys={playlist.coverKeys} title={playlist.name} size={size} />;
}
