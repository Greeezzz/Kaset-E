import { useCallback, useEffect, useState } from "react";
import { invoke } from "../lib/tauri";
import type { Track } from "../types";

/** Playlist dari Rust. `trackCount` dihitung di server, bukan dihitung ulang
 *  di UI — supaya angka tetap benar walau daftar lagunya belum dimuat. */
export interface Playlist {
  id: number;
  name: string;
  trackCount: number;
  createdAt: number;
  updatedAt: number;
  /** Kunci cover 4 lagu pertama, untuk mosaik di sidebar. */
  coverKeys: string[];
  /** Deskripsi bebas, maks 200 karakter. */
  description: string | null;
  /** `auto` (mosaik) | `custom` (upload) | `generative` (placeholder). */
  coverMode: "auto" | "custom" | "generative";
  /** Nama file relatif di folder playlist_covers, bukan path absolut. */
  coverPath: string | null;
}

/**
 * Favorit, riwayat, dan playlist.
 *
 * Ketiganya satu hook karena saling terkait: memutar lagu menulis riwayat,
 * menambah ke playlist butuh metadata lagu yang sama, dan Library menampilkan
 * semuanya dalam satu layar. Memisah jadi tiga hook berarti tiga sumber
 * kebenaran untuk satu layar.
 */
export function useLibrary() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [history, setHistory] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshPlaylists = useCallback(async () => {
    try {
      setPlaylists(await invoke<Playlist[]>("list_playlists"));
    } catch (e) {
      console.error("list_playlists gagal:", e);
    }
  }, []);

  const refreshFavorites = useCallback(async () => {
    try {
      setFavorites(await invoke<Track[]>("list_favorites"));
    } catch (e) {
      console.error("list_favorites gagal:", e);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await invoke<Track[]>("list_history", { limit: 200 }));
    } catch (e) {
      console.error("list_history gagal:", e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([refreshPlaylists(), refreshFavorites(), refreshHistory()]);
    setLoading(false);
  }, [refreshPlaylists, refreshFavorites, refreshHistory]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  /** Toggle favorit. Mengembalikan keadaan akhir dari Rust, bukan tebakan. */
  const toggleFavorite = useCallback(
    async (track: Track) => {
      const now = await invoke<boolean>("toggle_favorite", { track });
      await refreshFavorites();
      return now;
    },
    [refreshFavorites],
  );

  const isFavorite = useCallback(async (videoId: string) => {
    try {
      return await invoke<boolean>("is_favorite", { videoId });
    } catch {
      return false;
    }
  }, []);

  const recordPlay = useCallback(async (track: Track) => {
    try {
      await invoke("record_play", { track });
      // Riwayat tidak di-refresh di sini: menulis riwayat terjadi setiap lagu
      // mulai, dan memuat ulang seluruh daftar setiap kali akan membuat
      // pemutaran terasa berat. Tab riwayat memuat saat dibuka.
    } catch (e) {
      console.error("record_play gagal:", e);
    }
  }, []);

  const createPlaylist = useCallback(
    async (name: string) => {
      const p = await invoke<Playlist>("create_playlist", { name });
      await refreshPlaylists();
      return p;
    },
    [refreshPlaylists],
  );

  const renamePlaylist = useCallback(
    async (id: number, name: string) => {
      await invoke("rename_playlist", { id, name });
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const deletePlaylist = useCallback(
    async (id: number) => {
      await invoke("delete_playlist", { id });
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const addToPlaylist = useCallback(
    async (id: number, track: Track) => {
      await invoke("add_to_playlist", { id, track });
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const removeFromPlaylist = useCallback(
    async (id: number, videoId: string) => {
      await invoke("remove_from_playlist", { id, videoId });
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const playlistTracks = useCallback(async (id: number) => {
    return invoke<Track[]>("playlist_tracks", { id });
  }, []);

  const clearHistory = useCallback(async () => {
    await invoke("clear_history");
    await refreshHistory();
  }, [refreshHistory]);

  return {
    playlists,
    favorites,
    history,
    loading,
    refreshAll,
    refreshPlaylists,
    refreshFavorites,
    refreshHistory,
    toggleFavorite,
    isFavorite,
    recordPlay,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    playlistTracks,
    clearHistory,
  };
}
