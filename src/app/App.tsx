import { useEffect, useState } from "react";
import type { Route } from "./routes";
import { invoke, listen } from "../lib/tauri";
import type { PlayerState, QueueItem, Track } from "../types";
import { Sidebar } from "./layout/Sidebar";
import { BottomNav } from "./layout/BottomNav";
import { MiniPlayer } from "./layout/MiniPlayer";
import { PlayerBar } from "../features/player/PlayerBar";
import { FullPlayer } from "../features/player/FullPlayer";
import { QueuePanel } from "../features/queue/QueuePanel";
import { Search } from "../features/search/Search";
import { Library } from "../features/library/Library";
import { Settings } from "../features/settings/Settings";
import { usePlayerStore } from "../stores/playerStore";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { audioEngine } from "../lib/audio";

/** Ambil pesan ramah dari error Tauri (yang datang sebagai objek {message, permanent}). */
function errMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m.replace(/^stream:\s*/, "");
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function App() {
  const [route, setRoute] = useState<Route>("search");
  const [queueOpen, setQueueOpen] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [query, setQuery] = useState("");
  const [libTab, setLibTab] = useState<"Playlist" | "Favorit" | "History">("Playlist");
  const [toast, setToast] = useState<string | null>(null);

  const { state, setTrack, setPlaying } = usePlayerStore();
  const isWide = useMediaQuery("(min-width: 900px)");

  function notifyError(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  // Sambungkan engine audio ke store. Engine hanya aktuator; UI tetap cerminan
  // dari apa yang benar-benar terjadi pada audio.
  useEffect(() => {
    audioEngine.setEvents({
      onTime: (positionMs, durationMs) =>
        usePlayerStore.setState((s) => ({
          state: { ...s.state, positionMs, durationMs: durationMs || s.state.durationMs },
        })),
      onPlaying: () => setPlaying(true),
      onPaused: () => setPlaying(false),
      onEnded: () => setPlaying(false),
      onError: (msg) => {
        setPlaying(false);
        notifyError(msg);
      },
    });
    audioEngine.setVolume(usePlayerStore.getState().state.volume);
  }, [setPlaying]);

  // Sinkronkan state pemutar dari Rust. Rust yang memegang kebenaran, UI cerminan.
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    let disposed = false;

    (async () => {
      const offState = await listen("player://state", (s: PlayerState) => {
        usePlayerStore.setState({ state: s });
      });
      const offQueue = await listen("queue://changed", (q: QueueItem[]) => setQueue(q));
      if (disposed) {
        offState();
        offQueue();
      } else {
        unsubs.push(offState, offQueue);
      }
    })();

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, []);

  // Shortcut desktop (DESIGN.md). Ctrl+K fokus pencarian, Ctrl+Q toggle queue.
  useEffect(() => {
    if (!isWide) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        setQueueOpen((v) => !v);
      }
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setRoute("search");
        document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isWide]);

  async function handlePlay(t: Track) {
    setTrack(t);
    setPlaying(true);
    try {
      // Alur nyata (ARCHITECTURE.md §6): Rust me-resolve URL, webview memutar.
      const stream = await invoke<{ url: string; expiresAtMs: number }>("resolve_stream", {
        videoId: t.videoId,
      });
      await audioEngine.load(stream.url);
    } catch (err) {
      // Pesan ke user singkat; detail teknis ke konsol.
      console.error("putar gagal:", err);
      setPlaying(false);
      notifyError(errMessage(err, "Gagal memutar lagu"));
    }
  }

  function togglePlay() {
    if (state.status === "playing") {
      audioEngine.pause();
      setPlaying(false);
    } else if (state.track) {
      void audioEngine.play();
      setPlaying(true);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {isWide && <Sidebar route={route} onNavigate={setRoute} />}

        <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
          {route === "search" && <Search onPlay={handlePlay} query={query} setQuery={setQuery} />}
          {route === "library" && <Library tab={libTab} setTab={setLibTab} />}
          {route === "settings" && <Settings />}
          {/* Mobile: tap mini player membuka layar penuh (DESIGN.md §3).
              Tanpa cabang ini, route 'queue' akan merender layar kosong. */}
          {route === "queue" && (
            <FullPlayer state={state} queue={queue} onClose={() => setRoute("search")} />
          )}
        </main>

        {isWide && queueOpen && <QueuePanel items={queue} onClose={() => setQueueOpen(false)} />}
      </div>

      {isWide ? (
        <PlayerBar state={state} onToggle={togglePlay} />
      ) : (
        <MiniPlayer
          track={state.track}
          playing={state.status === "playing"}
          onToggle={togglePlay}
          onOpen={() => setRoute("queue")}
        />
      )}
      {!isWide && <BottomNav route={route} onNavigate={setRoute} />}

      {/* Toast untuk error ringan (DESIGN.md §5): tidak memblokir UI. */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--surface-2)",
            border: "1px solid var(--danger)",
            color: "var(--text)",
            padding: "var(--s-2) var(--s-4)",
            borderRadius: "var(--r-sm)",
            fontSize: 13,
            maxWidth: "min(520px, 90vw)",
            zIndex: 50,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
