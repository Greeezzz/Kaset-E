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

export function App() {
  const [route, setRoute] = useState<Route>("search");
  const [queueOpen, setQueueOpen] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [query, setQuery] = useState("");
  const [libTab, setLibTab] = useState<"Playlist" | "Favorit" | "History">("Playlist");

  const { state, setTrack, setPlaying } = usePlayerStore();
  const isWide = useMediaQuery("(min-width: 900px)");

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
      await invoke("play_track", { videoId: t.videoId });
    } catch (err) {
      console.error("play_track gagal:", err);
      setPlaying(false);
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
        <PlayerBar state={state} />
      ) : (
        <MiniPlayer
          track={state.track}
          playing={state.status === "playing"}
          onToggle={() => setPlaying(state.status !== "playing")}
          onOpen={() => setRoute("queue")}
        />
      )}
      {!isWide && <BottomNav route={route} onNavigate={setRoute} />}
    </div>
  );
}
