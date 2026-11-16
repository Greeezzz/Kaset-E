/**
 * Satu-satunya pintu antara React dan Rust.
 *
 * Aturan (AGENTS.md): semua invoke/listen lewat file ini supaya bertipe dan
 * mudah di-mock. Fase 0 belum punya backend nyata, jadi `invoke`/`listen`
 * mendeteksi ketiadaan Tauri dan jatuh ke mock in-memory yang bisa juga
 * disuruh gagal — prasyarat untuk menguji backoff/circuit breaker di Fase 1.
 */
import type { PlayerState, QueueItem, SearchResults, Track } from "../types";

type UnlistenFn = () => void;

type EventMap = {
  "player://state": PlayerState;
  "player://position": { positionMs: number; durationMs: number };
  "player://track-changed": Track;
  "player://error": { message: string; videoId?: string };
  "queue://changed": QueueItem[];
  "cover://ready": { key: string; path: string };
};

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let invokeImpl: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;

if (hasTauri) {
  // import dinamis supaya dev murni browser tetap bisa jalan (vite dev tanpa tauri)
  invokeImpl = (await import("@tauri-apps/api/core")).invoke;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (invokeImpl) return invokeImpl<T>(cmd, args);
  return mockInvoke<T>(cmd, args);
}

export async function listen<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  if (hasTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<EventMap[K]>(event, (e) => handler(e.payload));
  }
  return mockListen(event, handler);
}

/** True saat berjalan di dalam Tauri. UI bisa memakai ini untuk menyembunyikan
 *  kontrol yang tidak masuk akal di preview browser. */
export const runningInTauri = hasTauri;

// ---------------------------------------------------------------------------
// Mock layer (Fase 0)
// ---------------------------------------------------------------------------

const MOCK_TRACKS: Track[] = [
  {
    videoId: "dQw4w9WgXcQ",
    title: "Contoh Lagu Satu",
    artist: "Artis Contoh",
    album: "Album Contoh",
    durationMs: 213_000,
    coverKey: "v:dQw4w9WgXcQ",
  },
  {
    videoId: "mock0000002",
    title: "Contoh Lagu Dua Dengan Judul Yang Sengaja Panjang Sekali",
    artist: "Artis Lain",
    album: null,
    durationMs: 187_000,
    coverKey: "v:mock0000002",
  },
  {
    videoId: "mock0000003",
    title: "Contoh Lagu Tiga",
    artist: "Artis Contoh",
    album: "Album Contoh",
    durationMs: 251_000,
    coverKey: "v:mock0000003",
  },
];

const listeners = new Map<string, Set<(payload: unknown) => void>>();

function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Mock sengaja bisa disuruh gagal, supaya UI state error benar-benar teruji. */
export const mockControl = {
  failNext: false,
  setFailNext(v: boolean) {
    this.failNext = v;
  },
};

async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  await sleep(120);
  if (mockControl.failNext) {
    mockControl.failNext = false;
    throw new Error("mock: resolver gagal (disengaja)");
  }

  switch (cmd) {
    case "catalog_status":
      return false as T;
    case "resolve_stream": {
      // Mock tidak memutar audio nyata, tapi harus mengembalikan bentuk data
      // yang sama supaya jalur UI benar-benar teruji tanpa Rust.
      const track = MOCK_TRACKS.find((t) => t.videoId === args?.videoId) ?? MOCK_TRACKS[0];
      return {
        url: "",
        mime: "audio/webm",
        bitrateKbps: 128,
        expiresAtMs: Date.now() + 3_600_000,
        title: track.title,
      } as T;
    }
    case "search": {
      const results: SearchResults = {
        tracks: MOCK_TRACKS,
        albums: [],
        artists: [],
        playlists: [],
      };
      return results as T;
    }
    case "play_track": {
      const track = MOCK_TRACKS.find((t) => t.videoId === args?.videoId) ?? MOCK_TRACKS[0];
      // Mock meniru alur nyata: mulai loading, nanti track-changed + state.
      emit("player://state", {
        track,
        status: "playing",
        positionMs: 0,
        durationMs: track.durationMs ?? 0,
        volume: 0.8,
        shuffle: false,
        repeat: "off",
      });
      emit("player://track-changed", track);
      return { ok: true } as T;
    }
    case "cover_get":
      return { key: String(args?.key ?? ""), path: null } as T;
    default:
      return null as T;
  }
}

function mockListen<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): UnlistenFn {
  const set = listeners.get(event) ?? new Set();
  set.add(handler as (p: unknown) => void);
  listeners.set(event, set);
  return () => set.delete(handler as (p: unknown) => void);
}
