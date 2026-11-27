/**
 * Satu-satunya pintu antara React dan Rust.
 *
 * Aturan (AGENTS.md): semua invoke/listen lewat file ini supaya bertipe dan
 * mudah di-mock. Fase 0 belum punya backend nyata, jadi `invoke`/`listen`
 * mendeteksi ketiadaan Tauri dan jatuh ke mock in-memory yang bisa juga
 * disuruh gagal — prasyarat untuk menguji backoff/circuit breaker di Fase 1.
 */
import type {
  LrclibCandidate,
  LrclibMetadata,
  LyricsResponse,
  PlayerState,
  QueueItem,
  SearchResults,
  Track,
} from "../types";

type UnlistenFn = () => void;

type EventMap = {
  "player://state": PlayerState;
  "player://position": { positionMs: number; durationMs: number };
  "player://track-changed": Track;
  "player://error": { message: string; videoId?: string };
  "queue://changed": QueueItem[];
  "cover://ready": { key: string; path: string };
  "tray://toggle-play": null;
  "tray://next": null;
  "tray://previous": null;
  "oauth://token": string;
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

/** Antrean tiruan untuk mode browser (tanpa Rust). Perilakunya sengaja
 *  mengikuti command Rust supaya UI bisa dikerjakan tanpa kompilasi. */
const mockLib = {
  favorites: [] as Track[],
  history: [] as Track[],
  playlists: [] as {
    id: number;
    name: string;
    trackCount: number;
    createdAt: number;
    updatedAt: number;
    coverKeys: string[];
    description: string | null;
    coverMode: "auto" | "custom" | "generative";
    coverPath: string | null;
  }[],
  items: new Map<number, Track[]>(),
  listenTotalMs: 0,
  listenVids: [] as string[],
  seq: 0,
  lyrics: new Map<string, LyricsResponse>(),
};

/** Pengaturan tiruan untuk mode browser. */
const mockSettings = new Map<string, string>();

/** Riwayat pencarian tiruan untuk mode browser. */
const mockSearchHistory: { query: string; hits: number; lastUsedAt: number }[] = [];

const mockQueue = {
  items: [] as QueueItem[],
  cursor: 0,
  shuffle: false,
  shufflePintar: false,
  repeat: "off" as "off" | "one" | "all",
  view() {
    return {
      items: this.items.map((it, i) => ({ ...it, position: i })),
      cursor: this.cursor,
      shuffle: this.shuffle,
      shufflePintar: this.shufflePintar,
      repeat: this.repeat,
      current: this.items[this.cursor]?.track ?? null,
    };
  },
};

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
    case "tracks_count":
      return 0 as T;
    case "resolver_preparing":
      return false as T;
    case "resolver_status":
      // Di browser tidak ada yt-dlp; pemutaran nyata memang tidak tersedia.
      return false as T;
    case "list_favorites":
      return mockLib.favorites as T;
    case "is_favorite":
      return mockLib.favorites.some((f) => f.videoId === args?.videoId) as T;
    case "toggle_favorite": {
      const t = args?.track as Track;
      const i = mockLib.favorites.findIndex((f) => f.videoId === t.videoId);
      if (i >= 0) mockLib.favorites.splice(i, 1);
      else mockLib.favorites.unshift(t);
      return (i < 0) as T;
    }
    case "record_play": {
      const t = args?.track as Track;
      mockLib.history = [t, ...mockLib.history.filter((h) => h.videoId !== t.videoId)];
      return undefined as T;
    }
    case "listen_record": {
      // Mock mencatat total saja — cukup untuk menguji UI di browser tanpa Rust.
      const d = Number(args?.deltaMs ?? 0);
      if (d > 0) mockLib.listenTotalMs += d;
      return undefined as T;
    }
    case "listen_summary":
      return {
        totalMs: mockLib.listenTotalMs,
        jumlahLaguUnik: new Set(mockLib.listenVids).size,
        jumlahPutar: mockLib.listenVids.length,
      } as T;
    case "listen_clear":
      mockLib.listenTotalMs = 0;
      mockLib.listenVids = [];
      return 0 as T;
    case "list_history":
      return mockLib.history.slice(0, Number(args?.limit ?? 100)) as T;
    case "clear_history":
      mockLib.history = [];
      return 0 as T;
    case "history_count":
      return mockLib.history.length as T;
    case "list_playlists":
      return mockLib.playlists as T;
    case "create_playlist": {
      const p = {
        id: ++mockLib.seq,
        name: String(args?.name),
        trackCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        coverKeys: [] as string[],
        description: null as string | null,
        coverMode: "auto" as const,
        coverPath: null as string | null,
      };
      mockLib.playlists.unshift(p);
      mockLib.items.set(p.id, []);
      return p as T;
    }
    case "import_tautan": {
      // Mock tidak bisa memanggil yt-dlp; cukup buat playlist kosong dengan
      // nama dari tautan supaya alur dialog bisa dicoba di browser.
      const p = {
        id: ++mockLib.seq,
        name: "Playlist dari tautan",
        trackCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        coverKeys: [] as string[],
        description: null as string | null,
        coverMode: "auto" as const,
        coverPath: null as string | null,
      };
      mockLib.playlists.unshift(p);
      mockLib.items.set(p.id, []);
      return {
        playlistId: p.id,
        judul: p.name,
        ditambahkan: 0,
        dobel: 0,
        dilewati: 0,
      } as T;
    }
    case "rename_playlist": {
      const p = mockLib.playlists.find((x) => x.id === Number(args?.id));
      if (p) {
        p.name = String(args?.name);
        p.updatedAt = Date.now();
      }
      return p as T;
    }
    case "playlist_update_details": {
      const p = mockLib.playlists.find((x) => x.id === Number(args?.id));
      if (p) {
        if (args?.name !== undefined) p.name = String(args.name);
        if (args?.description !== undefined)
          p.description = args.description === null ? null : String(args.description);
        if (args?.coverMode !== undefined) p.coverMode = args.coverMode as typeof p.coverMode;
        p.updatedAt = Date.now();
      }
      return p as T;
    }
    case "playlist_cover_set": {
      // Mock tidak memproses gambar: cukup tandai mode custom supaya UI bisa
      // diuji alurnya di browser tanpa Rust.
      const p = mockLib.playlists.find((x) => x.id === Number(args?.id));
      if (p) {
        p.coverMode = "custom";
        p.coverPath = `mock-${p.id}.jpg`;
        p.updatedAt = Date.now();
      }
      return p as T;
    }
    case "playlist_cover_clear": {
      const p = mockLib.playlists.find((x) => x.id === Number(args?.id));
      if (p) {
        p.coverMode = "auto";
        p.coverPath = null;
        p.updatedAt = Date.now();
      }
      return p as T;
    }
    case "playlist_cover_path": {
      const p = mockLib.playlists.find((x) => x.id === Number(args?.id));
      return (p?.coverPath ?? null) as T;
    }
    case "delete_playlist": {
      const id = Number(args?.id);
      mockLib.playlists = mockLib.playlists.filter((x) => x.id !== id);
      mockLib.items.delete(id);
      return undefined as T;
    }
    case "playlist_tracks":
      return (mockLib.items.get(Number(args?.id)) ?? []) as T;
    case "add_to_playlist": {
      const id = Number(args?.id);
      const t = args?.track as Track;
      const list = mockLib.items.get(id) ?? [];
      if (!list.some((x) => x.videoId === t.videoId)) list.push(t);
      mockLib.items.set(id, list);
      const p = mockLib.playlists.find((x) => x.id === id);
      if (p) {
        p.trackCount = list.length;
        p.coverKeys = list.slice(0, 4).map((x) => x.coverKey);
      }
      return undefined as T;
    }
    case "remove_from_playlist": {
      const id = Number(args?.id);
      const list = (mockLib.items.get(id) ?? []).filter((x) => x.videoId !== args?.videoId);
      mockLib.items.set(id, list);
      const p = mockLib.playlists.find((x) => x.id === id);
      if (p) {
        p.trackCount = list.length;
        p.coverKeys = list.slice(0, 4).map((x) => x.coverKey);
      }
      return true as T;
    }
    case "play_playlist": {
      const id = Number(args?.id);
      mockQueue.items = (mockLib.items.get(id) ?? []).map((t, i) => ({
        position: i,
        track: t,
        originalOrder: i,
        // Isi playlist bukan prioritas: boleh diacak.
        prioritas: false,
        prioritasUrut: 0,
        sudahDiputar: false,
      }));
      mockQueue.cursor = 0;
      return mockQueue.view() as T;
    }
    case "listen_stats":
      return {
        totalMs: 0,
        totalPutaran: 0,
        totalLaguUnik: 0,
        totalArtisUnik: 0,
        streakHari: 0,
        laguTeratas: [],
        artisTeratas: [],
        perJam: Array.from({ length: 24 }, (_, jam) => ({ jam, totalMs: 0 })),
        perHari: [],
      } as T;
    case "set_shuffle_pintar":
      mockQueue.shufflePintar = Boolean(args?.enabled);
      return mockQueue.view() as T;
    case "queue_get":
      return mockQueue.view() as T;
    case "queue_add": {
      const t = args?.track as Track;
      mockQueue.items.push({
        position: mockQueue.items.length,
        track: t,
        originalOrder: mockQueue.items.length,
        prioritas: true,
        prioritasUrut: mockQueue.items.length,
        sudahDiputar: false,
      });
      return mockQueue.view() as T;
    }
    case "queue_play_now": {
      // Sama seperti Rust: tambah, lalu pindahkan cursor ke lagu itu.
      const t = args?.track as Track;
      mockQueue.items.push({
        position: mockQueue.items.length,
        track: t,
        originalOrder: mockQueue.items.length,
        prioritas: true,
        prioritasUrut: mockQueue.items.length,
        sudahDiputar: false,
      });
      mockQueue.cursor = mockQueue.items.length - 1;
      return mockQueue.view() as T;
    }
    case "queue_play_next": {
      const t = args?.track as Track;
      mockQueue.items.splice(mockQueue.cursor + 1, 0, {
        position: 0,
        track: t,
        originalOrder: mockQueue.items.length,
        prioritas: true,
        prioritasUrut: mockQueue.items.length,
        sudahDiputar: false,
      });
      return mockQueue.view() as T;
    }
    case "queue_remove":
      mockQueue.items.splice(Number(args?.position), 1);
      mockQueue.cursor = Math.min(mockQueue.cursor, Math.max(0, mockQueue.items.length - 1));
      return mockQueue.view() as T;
    case "queue_move": {
      const from = Number(args?.from);
      const to = Number(args?.to);
      const [moved] = mockQueue.items.splice(from, 1);
      if (moved) mockQueue.items.splice(to, 0, moved);
      return mockQueue.view() as T;
    }
    case "queue_clear":
      mockQueue.items = [];
      mockQueue.cursor = 0;
      return mockQueue.view() as T;
    case "queue_replace": {
      const tracks = (args?.tracks as Track[] | undefined) ?? [];
      const startIndex = Number(args?.startIndex ?? 0);
      mockQueue.items = tracks.map((t, i) => ({
        position: i,
        track: t,
        originalOrder: i,
        // Isi playlist bukan prioritas: boleh diacak.
        prioritas: false,
        prioritasUrut: 0,
        sudahDiputar: false,
      }));
      mockQueue.cursor =
        tracks.length === 0 ? 0 : Math.min(Math.max(0, startIndex), tracks.length - 1);
      return mockQueue.view() as T;
    }
    case "queue_jump":
      mockQueue.cursor = Number(args?.position);
      return mockQueue.view() as T;
    case "set_shuffle":
      mockQueue.shuffle = Boolean(args?.enabled);
      return mockQueue.view() as T;
    case "set_repeat":
      mockQueue.repeat = args?.mode as "off" | "one" | "all";
      return mockQueue.view() as T;
    case "queue_next":
      if (mockQueue.cursor + 1 >= mockQueue.items.length) {
        if (mockQueue.repeat === "all") mockQueue.cursor = 0;
        else return null as T;
      } else {
        mockQueue.cursor += 1;
      }
      return mockQueue.view() as T;
    case "queue_previous":
      if (mockQueue.items.length === 0) return null as T;
      mockQueue.cursor = Math.max(0, mockQueue.cursor - 1);
      return mockQueue.view() as T;
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
    case "cover_download":
      return { key: String(args?.key ?? ""), path: null, status: "missing" } as T;
    case "search_history_list":
      return [...mockSearchHistory]
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, Number(args?.limit ?? 10))
        .map((h) => ({ query: h.query, hits: h.hits, lastUsedAt: h.lastUsedAt })) as T;
    case "search_history_remove": {
      const i = mockSearchHistory.findIndex((h) => h.query === String(args?.query));
      if (i >= 0) mockSearchHistory.splice(i, 1);
      return (i >= 0) as T;
    }
    case "search_history_clear": {
      const n = mockSearchHistory.length;
      mockSearchHistory.length = 0;
      return n as T;
    }
    case "setting_get":
      return (mockSettings.get(String(args?.key)) ?? null) as T;
    case "setting_set":
      mockSettings.set(String(args?.key), String(args?.value));
      return undefined as T;
    case "export_library": {
      const backup = {
        version: 1,
        exportedAt: Date.now(),
        favorites: mockLib.favorites,
        playlists: mockLib.playlists.map((p) => ({
          name: p.name,
          description: p.description,
          tracks: mockLib.items.get(p.id) ?? [],
        })),
      };
      return JSON.stringify(backup, null, 2) as T;
    }
    case "import_library": {
      const raw = String(args?.json ?? "");
      const parsed = JSON.parse(raw) as {
        version?: number;
        favorites?: Track[];
        playlists?: { name: string; description?: string | null; tracks?: Track[] }[];
      };
      if (parsed.version !== 1) throw new Error("versi cadangan tidak didukung");
      let favoritesAdded = 0;
      let playlistsCreated = 0;
      let tracksAdded = 0;
      for (const f of parsed.favorites ?? []) {
        if (!mockLib.favorites.some((x) => x.videoId === f.videoId)) {
          mockLib.favorites.push(f);
          favoritesAdded++;
        }
      }
      for (const ep of parsed.playlists ?? []) {
        const name = ep.name?.trim();
        if (!name) continue;
        let pl = mockLib.playlists.find((p) => p.name === name);
        if (!pl) {
          pl = {
            id: ++mockLib.seq,
            name,
            trackCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            coverKeys: [],
            description: ep.description ?? null,
            coverMode: "auto",
            coverPath: null,
          };
          mockLib.playlists.unshift(pl);
          mockLib.items.set(pl.id, []);
          playlistsCreated++;
        }
        const list = mockLib.items.get(pl.id) ?? [];
        for (const t of ep.tracks ?? []) {
          if (!list.some((x) => x.videoId === t.videoId)) {
            list.push(t);
            tracksAdded++;
          }
        }
        mockLib.items.set(pl.id, list);
        pl.trackCount = list.length;
        pl.coverKeys = list.slice(0, 4).map((x) => x.coverKey);
      }
      return { favoritesAdded, playlistsCreated, tracksAdded } as T;
    }
    case "lyrics_get": {
      const vid = args?.videoId as string;
      const found = mockLib.lyrics.get(vid);
      return (found ?? null) as T;
    }
    case "lyrics_set_from_text": {
      const vid = args?.videoId as string;
      const text = args?.text as string;
      const offsetMs = (args?.offsetMs as number) ?? 0;
      const res: LyricsResponse = {
        video_id: vid,
        lrc: text,
        sumber: (args?.sumber as string) ?? "impor",
        offset_ms: offsetMs,
        diambil_pada: Date.now(),
        parsed: {
          is_synced: false,
          file_offset_ms: 0,
          lines: text
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .map((t) => ({ time_ms: 0, text: t.trim() })),
        },
      };
      mockLib.lyrics.set(vid, res);
      return res as T;
    }
    case "lyrics_set_offset": {
      const vid = args?.videoId as string;
      const offsetMs = (args?.offsetMs as number) ?? 0;
      const found = mockLib.lyrics.get(vid);
      if (found) {
        found.offset_ms = offsetMs;
        return true as T;
      }
      return false as T;
    }
    case "lyrics_delete": {
      const vid = args?.videoId as string;
      return mockLib.lyrics.delete(vid) as T;
    }
    case "lyrics_import_file": {
      const vid = args?.videoId as string;
      const res: LyricsResponse = {
        video_id: vid,
        lrc: "[00:01.00]Lirik contoh dari berkas impor\n[00:04.00]Baris kedua",
        sumber: "impor",
        offset_ms: 0,
        diambil_pada: Date.now(),
        parsed: {
          is_synced: true,
          file_offset_ms: 0,
          lines: [
            { time_ms: 1000, text: "Lirik contoh dari berkas impor" },
            { time_ms: 4000, text: "Baris kedua" },
          ],
        },
      };
      mockLib.lyrics.set(vid, res);
      return res as T;
    }
    case "lyrics_metadata_lirik": {
      const title = (args?.title as string) ?? "";
      const artist = (args?.artist as string) ?? "";
      const res: LrclibMetadata = {
        judul_bersih: title.replace(/\s*[([【〔][^\])】〕]*[)\]】〕]/g, "").trim(),
        artis_bersih: artist,
        parsed_artist: null,
        parsed_title: null,
        judul_saja: title.trim(),
      };
      return res as T;
    }
    case "lyrics_search_lrclib": {
      const query = (args?.query as string) ?? "";
      const res: LrclibCandidate[] = [
        {
          id: 1,
          track_name: query || "Contoh Lagu",
          artist_name: "Contoh Artis",
          album_name: null,
          duration: 214,
          instrumental: false,
          synced: true,
          lrc: "[00:01.00]Lirik contoh dari pencarian manual\n[00:05.00]Baris kedua",
        },
        {
          id: 2,
          track_name: query || "Contoh Lagu",
          artist_name: "Artis Lain",
          album_name: null,
          duration: 240,
          instrumental: false,
          synced: false,
          lrc: "Lirik polos tanpa timestamp",
        },
      ];
      return res as T;
    }
    case "lyrics_fetch_lrclib": {
      const vid = args?.videoId as string;
      const title = args?.title as string;
      const res: LyricsResponse = {
        video_id: vid,
        lrc: `[00:01.00]${title} - Lirik otomatis dari LRCLIB\n[00:05.00]Baris kedua otomatis`,
        sumber: "lrclib",
        offset_ms: 0,
        diambil_pada: Date.now(),
        parsed: {
          is_synced: true,
          file_offset_ms: 0,
          lines: [
            { time_ms: 1000, text: `${title} - Lirik otomatis dari LRCLIB` },
            { time_ms: 5000, text: "Baris kedua otomatis" },
          ],
        },
      };
      mockLib.lyrics.set(vid, res);
      return res as T;
    }
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
