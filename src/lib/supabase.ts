import { createClient } from "@supabase/supabase-js";
import { invoke } from "./tauri";
import type { Track } from "../types";

export const SUPABASE_URL = "https://itqcjpunnnqsnudgbpli.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWNqcHVubm5xc251ZGdicGxpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3OTA1ODYsImV4cCI6MjExMTM2NjU4Nn0.eMipMryNEhrBZP8XD0b3WXXPKrjxjqbGMhy3istV2Ow";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/**
 * Memulai login dengan Google OAuth.
 * Di desktop Tauri, membuka URL autentikasi Supabase di browser default.
 */
export async function signInWithGoogleOAuth(): Promise<{ url?: string; error?: string }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "http://localhost:3000",
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error: error.message };
  return { url: data.url };
}

/**
 * Login / Daftar tanpa kata sandi via Email OTP / Magic Link.
 */
export async function signInWithOtp(email: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
  });
  if (error) return { error: error.message };
  return {};
}

/**
 * Verifikasi kode OTP 6 digit dari email.
 */
export async function verifyOtpCode(email: string, token: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) return { error: error.message };
  return {};
}

export interface SyncStatus {
  isLoggedIn: boolean;
  userEmail: string | null;
  lastSyncAt: number | null;
  isSyncing: boolean;
  error: string | null;
}

interface LocalPlaylist {
  id: number;
  uuid?: string;
  name: string;
  description?: string;
  coverMode: string;
}

/**
 * Sinkronisasi dua arah (Two-way Sync) BATCH antara SQLite lokal dan Cloud Supabase.
 * Menggunakan batch upsert (1 query untuk ratusan lagu) agar proses selesai dalam < 1 detik.
 */
export async function performFullSync(): Promise<{
  playlistsSynced: number;
  favoritesSynced: number;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) {
    throw new Error("Pengguna belum masuk");
  }

  const userId = session.user.id;
  const nowIso = new Date().toISOString();
  let playlistsSynced = 0;
  let favoritesSynced = 0;

  // 1. Sinkronisasi PLAYLISTS & TRACKS (Batch)
  const localPlaylists = await invoke<LocalPlaylist[]>("list_playlists");

  if (localPlaylists.length > 0) {
    const validPlaylists = localPlaylists.filter((p) => !!p.uuid);
    if (validPlaylists.length > 0) {
      // 1a. Batch upsert playlists
      const playlistPayloads = validPlaylists.map((pl) => ({
        user_id: userId,
        client_uuid: pl.uuid!,
        name: pl.name,
        description: pl.description || null,
        cover_mode: pl.coverMode,
        updated_at: nowIso,
      }));

      const { error: plBatchErr } = await supabase
        .from("cloud_playlists")
        .upsert(playlistPayloads, { onConflict: "user_id,client_uuid" });

      if (!plBatchErr) {
        playlistsSynced += validPlaylists.length;
      }

      // 1b. Kumpulkan seluruh track dari semua playlist lalu batch upsert sekaligus
      const allTrackPayloads = [];
      for (const pl of validPlaylists) {
        const localTracks = await invoke<Track[]>("playlist_tracks", { id: pl.id });
        for (let i = 0; i < localTracks.length; i++) {
          const t = localTracks[i];
          allTrackPayloads.push({
            user_id: userId,
            playlist_client_uuid: pl.uuid!,
            video_id: t.videoId,
            title: t.title,
            artist: t.artist,
            album: t.album || null,
            duration_ms: t.durationMs || 0,
            position: i,
            updated_at: nowIso,
          });
        }
      }

      // Kirim dalam chunk 200 items per request agar aman & super cepat
      for (let i = 0; i < allTrackPayloads.length; i += 200) {
        const chunk = allTrackPayloads.slice(i, i + 200);
        await supabase
          .from("cloud_playlist_tracks")
          .upsert(chunk, { onConflict: "user_id,playlist_client_uuid,video_id" });
      }
    }
  }

  // 1c. Pull cloud playlists yang belum ada di lokal
  const { data: cloudPlaylists } = await supabase
    .from("cloud_playlists")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (cloudPlaylists && cloudPlaylists.length > 0) {
    for (const cp of cloudPlaylists) {
      const matchLocal = localPlaylists.find((p) => p.uuid === cp.client_uuid);
      if (!matchLocal) {
        // Buat playlist lokal baru
        const created = await invoke<LocalPlaylist>("create_playlist", { name: cp.name });
        const { data: cloudTracks } = await supabase
          .from("cloud_playlist_tracks")
          .select("*")
          .eq("user_id", userId)
          .eq("playlist_client_uuid", cp.client_uuid)
          .is("deleted_at", null)
          .order("position", { ascending: true });

        if (cloudTracks && created?.id) {
          for (const ct of cloudTracks) {
            await invoke("add_to_playlist", {
              id: created.id,
              track: {
                videoId: ct.video_id,
                title: ct.title,
                artist: ct.artist,
                album: ct.album || undefined,
                durationMs: ct.duration_ms || 0,
              },
            });
          }
        }
        playlistsSynced++;
      }
    }
  }

  // 2. Sinkronisasi FAVORIT (Batch)
  const localFavorites = await invoke<Track[]>("list_favorites");

  if (localFavorites.length > 0) {
    const favPayloads = localFavorites.map((fav) => ({
      user_id: userId,
      video_id: fav.videoId,
      title: fav.title,
      artist: fav.artist,
      album: fav.album || null,
      duration_ms: fav.durationMs || 0,
      updated_at: nowIso,
    }));

    for (let i = 0; i < favPayloads.length; i += 200) {
      const chunk = favPayloads.slice(i, i + 200);
      const { error: fErr } = await supabase
        .from("cloud_favorites")
        .upsert(chunk, { onConflict: "user_id,video_id" });
      if (!fErr) {
        favoritesSynced += chunk.length;
      }
    }
  }

  // Pull cloud favorites yang belum ada di lokal
  const { data: cloudFavorites } = await supabase
    .from("cloud_favorites")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (cloudFavorites && cloudFavorites.length > 0) {
    for (const cf of cloudFavorites) {
      const ada = localFavorites.some((f) => f.videoId === cf.video_id);
      if (!ada) {
        await invoke("toggle_favorite", {
          track: {
            videoId: cf.video_id,
            title: cf.title,
            artist: cf.artist,
            album: cf.album || undefined,
            durationMs: cf.duration_ms || 0,
          },
        });
        favoritesSynced++;
      }
    }
  }

  // Simpan timestamp sync terakhir ke SQLite settings
  const now = Date.now();
  await invoke("setting_set", { key: "last_sync_at", value: String(now) }).catch(() => {});

  return { playlistsSynced, favoritesSynced };
}
