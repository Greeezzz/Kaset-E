import { useEffect, useRef, useState } from "react";
import type { Route } from "./routes";
import { invoke, listen } from "../lib/tauri";
import type { PlayerState, Track } from "../types";
import { Sidebar } from "./layout/Sidebar";
import { BottomNav } from "./layout/BottomNav";
import { MiniPlayer } from "./layout/MiniPlayer";
import { PlayerBar } from "../features/player/PlayerBar";
import { FullPlayer } from "../features/player/FullPlayer";
import { RightPanel, type RightPanelTab } from "../features/queue/RightPanel";
import { Search } from "../features/search/Search";
import { Library } from "../features/library/Library";
import { Settings } from "../features/settings/Settings";
import { usePlayerStore } from "../stores/playerStore";
import {
  useBreakpoint,
  adaSidebar,
  panelOverlay,
  panelSheet,
  adaPlayerBar,
} from "../hooks/useBreakpoint";
import { audioEngine } from "../lib/audio";
import { useQueue, type QueueView } from "../hooks/useQueue";
import { streamCache, bisaDipulihkan } from "../lib/streamCache";
import { useLibrary } from "../hooks/useLibrary";
import { PlaylistPicker } from "../features/library/PlaylistPicker";
import { PlaylistDetailDialog } from "../features/library/PlaylistDetailDialog";

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
  // Panel kanan: default TERTUTUP (DESIGN-LAYOUT bagian 1). Pilihan terakhir
  // diingat supaya user yang selalu membukanya tidak perlu membuka tiap start.
  const [queueOpen, setQueueOpen] = useState(false);
  const [rightTab, setRightTab] = useState<RightPanelTab>("queue");
  const [query, setQuery] = useState("");
  const [libTab, setLibTab] = useState<"Playlist" | "Favorit" | "History">("Playlist");
  // Playlist yang sedang dipilih di sidebar (null = Lagu Disukai).
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  // Sumber pemutaran aktif: ID playlist atau "favorites" (untuk tombol play/pause & equalizer).
  const [playingSourceId, setPlayingSourceId] = useState<number | "favorites" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  const { state, setTrack, setPlaying, setStatus } = usePlayerStore();
  const queue = useQueue();
  const refreshQueue = queue.refresh;
  const lib = useLibrary();
  // Lagu yang sedang dipilih untuk dimasukkan ke playlist (null = dialog tutup).
  const [pickTarget, setPickTarget] = useState<Track | null>(null);
  // Dialog Nama & Detail: null = tertutup, angka = playlist yang diedit.
  // `true` di state kedua menandai playlist baru (judul dialog berbeda).
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailBaru, setDetailBaru] = useState(false);
  // Handler "lagu habis" disimpan di ref supaya effect audio tidak perlu
  // dipasang ulang setiap render (dan tidak menangkap state basi).
  const onEndedRef = useRef<() => void>(() => {});
  // Lagu yang sedang dipulihkan, supaya tidak ada dua resolve bersamaan untuk
  // lagu yang sama. Null = tidak sedang memulihkan.
  const recoveringRef = useRef<string | null>(null);
  // videoId yang benar-benar sudah dimuat ke elemen <audio>. Membedakan lagu
  // hasil pemulihan saat start (belum di-resolve) dari lagu yang sedang dijeda.
  const loadedVideoIdRef = useRef<string | null>(null);
  // Stempel waktu klik putar → event "playing" (MVP.md Fase 1.5: ukur delay).
  const playStartAtRef = useRef<{ videoId: string; at: number } | null>(null);
  // videoId yang sudah di-prefetch untuk lagu ini. Reset setiap lagu berganti,
  // supaya satu lagu hanya memicu satu prefetch (bukan tiap timeupdate).
  const prefetchRef = useRef<string | null>(null);
  // Salinan antrean terbaru untuk handler audio. Handler dipasang sekali
  // (dependency `setPlaying`), jadi membaca `queue.view` langsung dari closure
  // akan selalu mendapat nilai saat effect pertama jalan — cursor basi.
  const queueViewRef = useRef(queue.view);
  // Timer penyimpanan volume (debounce 500 ms).
  const simpanVolumeRef = useRef<number | null>(null);

  // Handler pemulihan, sama seperti onEnded: disimpan di ref supaya effect
  // audio tidak dipasang ulang setiap render.
  const onAudioErrorRef = useRef<(msg: string, code: number | null) => void>(() => {});
  // Handler kontrol dari tray / media key disimpan di ref agar listener Tauri
  // tidak dipasang ulang tiap render.
  const mediaControlsRef = useRef({
    toggle: () => {},
    next: () => {},
    previous: () => {},
  });
  // Empat tingkat lebar (DESIGN-LAYOUT §8). `isWide` dipertahankan sebagai
  // turunan supaya kode lama yang memakainya tidak perlu diubah semua — tapi
  // keputusan baru harus membaca `bp`.
  const bp = useBreakpoint();
  const isWide = adaSidebar(bp);
  const sidebarRel = bp === "rel";
  const overlayPanel = panelOverlay(bp);
  const sheetPanel = panelSheet(bp);

  function notifyError(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  // Sambungkan engine audio ke store. Engine hanya aktuator; UI tetap cerminan
  // dari apa yang benar-benar terjadi pada audio.
  useEffect(() => {
    audioEngine.setEvents({
      onTime: (positionMs, durationMs) => {
        usePlayerStore.setState((s) => ({
          state: { ...s.state, positionMs, durationMs: durationMs || s.state.durationMs },
        }));

        // Prefetch lagu berikutnya saat lagu ini tinggal ~15 detik
        // (MVP.md Fase 1.5). Resolve memakan 1-4 detik; tanpa ini ada jeda
        // hening di antara dua lagu. Ambang 15 detik cukup lebar untuk
        // resolve lambat, tapi tidak terlalu awal untuk lagu pendek.
        const sisa = durationMs - positionMs;
        if (durationMs > 0 && sisa > 0 && sisa < 15_000 && !prefetchRef.current) {
          const { items, cursor } = queueViewRef.current;
          const berikut = items[cursor + 1];
          if (berikut?.track.videoId) {
            prefetchRef.current = berikut.track.videoId;
            streamCache.prefetch(berikut.track.videoId);
          }
        }
      },
      onPlaying: () => {
        if (playStartAtRef.current) {
          const { videoId, at } = playStartAtRef.current;
          playStartAtRef.current = null;
          console.info(
            `[perf] klik->playing videoId=${videoId} ms=${Math.round(performance.now() - at)}`,
          );
        }
        setPlaying(true);
      },
      onPaused: () => setPlaying(false),
      onEnded: () => {
        // Lagu selesai: lanjut otomatis ke antrean berikutnya. Kalau antrean
        // habis (repeat off), pemutaran berhenti — bukan error.
        onEndedRef.current();
      },
      onError: (msg, code) => {
        onAudioErrorRef.current(msg, code);
      },
    });
    audioEngine.setVolume(usePlayerStore.getState().state.volume);
  }, [setPlaying]);

  // Jaga ref antrean tetap segar untuk handler audio di atas.
  queueViewRef.current = queue.view;

  // Pulihkan preferensi panel kanan.
  useEffect(() => {
    let hidup = true;
    void invoke<string | null>("setting_get", { key: "queue_open" })
      .then((v) => {
        if (hidup && v === "1") setQueueOpen(true);
      })
      .catch(() => {});
    return () => {
      hidup = false;
    };
  }, []);

  /** Buka tab tertentu di panel kanan; kalau tab itu sudah terbuka, tutup. */
  function toggleRightTab(tab: RightPanelTab) {
    if (queueOpen && rightTab === tab) {
      setQueueOpen(false);
      void invoke("setting_set", { key: "queue_open", value: "0" }).catch(() => {});
      return;
    }
    setRightTab(tab);
    setQueueOpen(true);
    void invoke("setting_set", { key: "queue_open", value: "1" }).catch(() => {});
  }

  function closeRightPanel() {
    setQueueOpen(false);
    void invoke("setting_set", { key: "queue_open", value: "0" }).catch(() => {});
  }

  // Sinkronisasi awal: kalau antrean dipulihkan dari SQLite saat start,
  // tampilkan lagu aktif di PlayerBar (status paused) supaya PlayerBar
  // dan panel kanan selalu membaca kebenaran yang sama (DESIGN-LAYOUT §6).
  const queueCurrent = queue.view.current;
  useEffect(() => {
    if (!state.track && queueCurrent) {
      setTrack(queueCurrent);
    }
  }, [state.track, queueCurrent, setTrack]);

  // Pulihkan volume terakhir. Gagal baca bukan masalah: pakai default 0.8.
  useEffect(() => {
    let hidup = true;
    void invoke<string | null>("setting_get", { key: "volume" })
      .then((v) => {
        if (!hidup || v === null || v === undefined) return;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1) return;
        audioEngine.setVolume(n);
        usePlayerStore.getState().setVolume(n);
      })
      .catch(() => {});
    return () => {
      hidup = false;
    };
  }, []);

  // Sinkronkan state pemutar dari Rust. Rust yang memegang kebenaran, UI cerminan.
  useEffect(() => {
    const unsubs: (() => void)[] = [];
    let disposed = false;

    (async () => {
      const offState = await listen("player://state", (s: PlayerState) => {
        usePlayerStore.setState({ state: s });
      });
      const offQueue = await listen("queue://changed", () => {
        // Antrean dikelola hook useQueue lewat command; event ini hanya
        // memberi tahu bahwa ada perubahan dari sisi Rust. `refresh` stabil
        // (useCallback), jadi aman dipakai di dalam effect.
        void refreshQueue();
      });
      const offTrayToggle = await listen("tray://toggle-play", () =>
        mediaControlsRef.current.toggle(),
      );
      const offTrayNext = await listen("tray://next", () => mediaControlsRef.current.next());
      const offTrayPrev = await listen("tray://previous", () =>
        mediaControlsRef.current.previous(),
      );
      if (disposed) {
        offState();
        offQueue();
        offTrayToggle();
        offTrayNext();
        offTrayPrev();
      } else {
        unsubs.push(offState, offQueue, offTrayToggle, offTrayNext, offTrayPrev);
      }
    })();

    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
    };
  }, [refreshQueue]);

  // Shortcut desktop (DESIGN.md). Ctrl+K fokus pencarian, Ctrl+Q toggle queue.
  useEffect(() => {
    if (!isWide) return;
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        setRightTab("queue");
        setQueueOpen((buka) => {
          const baru = !buka;
          void invoke("setting_set", { key: "queue_open", value: baru ? "1" : "0" }).catch(
            () => {},
          );
          return baru;
        });
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

  /** Putar lagu. Kalau belum ada di antrean, masukkan dulu supaya
   *  next/prev punya konteks — inilah yang membuat "putar dari pencarian"
   *  terasa seperti player sungguhan, bukan satu lagu lepas. */
  /** Jalankan audio untuk satu lagu. Tidak menyentuh antrean sama sekali. */
  async function startAudio(t: Track) {
    playStartAtRef.current = { videoId: t.videoId, at: performance.now() };
    // Lagu berganti: prefetch berikutnya boleh dijadwalkan lagi.
    prefetchRef.current = null;
    setTrack(t);
    setStatus("loading");
    // Riwayat dicatat di sini karena inilah titik lagu benar-benar diminta
    // diputar — bukan saat diklik dan resolve-nya gagal.
    void lib.recordPlay(t);
    try {
      // URL diambil dari cache kalau masih layak. Resolve memanggil yt-dlp dan
      // memakan beberapa detik — memutarnya ulang untuk lagu yang sama persis
      // adalah pemborosan yang terasa oleh user.
      const stream = await streamCache.get(t.videoId);
      await audioEngine.load(stream.url);
      loadedVideoIdRef.current = t.videoId;
    } catch (err) {
      console.error("putar gagal:", err);
      loadedVideoIdRef.current = null;
      setStatus("error");
      notifyError(errMessage(err, "Gagal memutar lagu"));
    }
  }

  /** Pulihkan satu lagu dengan URL baru, lanjut dari posisi terakhir.
   *
   *  Dipanggil hanya saat audio gagal dengan kode yang bisa disembuhkan
   *  (jaringan / sumber ditolak). Sengaja tidak rekursif: satu kali percobaan
   *  per lagu, supaya URL yang terus ditolak tidak menjadi loop resolve tanpa
   *  akhir yang menghabiskan kuota dan mengunci circuit breaker. */
  async function recoverStream(t: Track, resumeAtMs: number) {
    if (recoveringRef.current === t.videoId) return;
    recoveringRef.current = t.videoId;
    setStatus("loading");
    try {
      streamCache.invalidate(t.videoId);
      const stream = await streamCache.get(t.videoId, true);
      await audioEngine.load(stream.url, resumeAtMs);
      loadedVideoIdRef.current = t.videoId;
      setPlaying(true);
    } catch (err) {
      // Percobaan kedua juga gagal: berhenti dengan jujur, jangan berpura-pura.
      console.error("pemulihan stream gagal:", err);
      loadedVideoIdRef.current = null;
      setStatus("error");
      notifyError(errMessage(err, "Stream tidak bisa dipulihkan"));
    } finally {
      recoveringRef.current = null;
    }
  }

  /** Putar lagu yang diklik user. Kalau belum ada di antrean, masukkan dulu
   *  supaya next/prev punya konteks — inilah yang membuat "putar dari
   *  pencarian" terasa seperti player sungguhan, bukan satu lagu lepas. */
  async function handlePlay(t: Track) {
    // Cari posisi di antrean berdasarkan indeks, bukan judul: lagu yang sama
    // boleh muncul dua kali, dan `findIndex` akan selalu menemukan yang
    // pertama — itu membuat cursor melompat ke lagu yang salah.
    const existing = queue.view.items.findIndex(
      (i, pos) => i.track.videoId === t.videoId && pos > queue.view.cursor,
    );
    const fallback = queue.view.items.findIndex((i) => i.track.videoId === t.videoId);
    const pos = existing >= 0 ? existing : fallback;

    if (pos >= 0) {
      if (pos !== queue.view.cursor) await queue.jump(pos);
    } else {
      // Lagu belum ada di antrean: tambahkan SEKALIGUS jadikan aktif.
      // `queue.add` saja tidak memindahkan cursor, jadi panel antrean akan
      // tetap menampilkan lagu lama sebagai "sedang diputar" sementara audio
      // sudah memutar lagu baru.
      await queue.playNow(t);
    }
    setPlayingSourceId(null);
    await startAudio(t);
  }

  /** Putar lagu pada posisi tertentu di antrean, lalu sinkronkan player. */
  async function playQueueIndex(position: number) {
    const v = await queue.jump(position);
    if (v?.current) {
      await startAudio(v.current);
    }
  }

  /** Kembali ke lagu sebelumnya di antrean. */
  async function playPreviousInQueue() {
    const v = await queue.previous();
    if (!v?.current) return;
    await startAudio(v.current);
  }

  /** Lanjut ke lagu berikutnya di antrean. `null` = antrean habis. */
  async function playNextInQueue() {
    const v = await queue.next();
    if (!v?.current) {
      setPlaying(false);
      return;
    }
    await startAudio(v.current);
  }

  /** Dipanggil saat audio benar-benar habis. */
  async function handleEnded() {
    // Repeat one: ulang lagu yang sama tanpa menyentuh antrean.
    if (queue.view.repeat === "one" && queue.view.current) {
      // Ulang lagu yang sama: cursor tidak berubah, audio dimuat ulang.
      await startAudio(queue.view.current);
      return;
    }
    const v = await queue.next();
    if (!v?.current) {
      // Antrean habis dan repeat bukan "all": berhenti dengan hormat.
      setPlaying(false);
      return;
    }
    await startAudio(v.current);
  }

  // Selalu menunjuk versi terbaru handleEnded, tanpa memasang ulang effect.
  onEndedRef.current = () => void handleEnded();

  /** Audio gagal diputar. Kalau penyebabnya bisa disembuhkan, coba sekali
   *  dengan URL baru dan lanjut dari posisi terakhir. */
  onAudioErrorRef.current = (msg, code) => {
    const track = usePlayerStore.getState().state.track;
    // Posisi dari engine, yang hanya mencatat posisi saat audionya benar-benar
    // sehat. `positionMs()` pada titik ini sudah kembali 0.
    const posisi = audioEngine.lastGoodPositionMs();
    if (track && bisaDipulihkan(code)) {
      void recoverStream(track, posisi);
      return;
    }
    loadedVideoIdRef.current = null;
    setStatus("error");
    notifyError(msg);
  };

  /** Ganti antrean dengan isi playlist / koleksi lalu putar mulai dari `startIndex`. */
  async function playTrackList(
    tracks: Track[],
    startIndex: number,
    sourceId: number | "favorites" | null,
  ) {
    if (tracks.length === 0) return;
    try {
      const v = await queue.replace(tracks, startIndex);
      setPlayingSourceId(sourceId);
      if (v?.current) await startAudio(v.current);
    } catch (err) {
      notifyError(errMessage(err, "Gagal memutar daftar lagu"));
    }
  }

  function handleSelectFavorites() {
    setSelectedPlaylistId(null);
    setLibTab("Favorit");
    setRoute("library");
  }

  function handleSelectPlaylist(id: number) {
    setSelectedPlaylistId(id);
    setLibTab("Playlist");
    setRoute("library");
  }

  /**
   * Buat playlist lalu langsung buka dialog detailnya.
   *
   * Playlist baru dibuat dengan nama sementara karena dialog bisa dibatalkan —
   * kalau batal dan playlist dibuang, pengguna tidak melihat playlist kosong
   * bernama "Playlist baru" menumpuk di sidebar.
   */
  async function handleCreatePlaylist() {
    try {
      const p = await lib.createPlaylist("Playlist baru");
      setSelectedPlaylistId(p.id);
      setLibTab("Playlist");
      setRoute("library");
      setDetailBaru(true);
      setDetailId(p.id);
    } catch (err) {
      notifyError(errMessage(err, "Gagal membuat playlist"));
    }
  }

  async function handleRenamePlaylist(id: number, name: string) {
    try {
      await lib.renamePlaylist(id, name);
    } catch (err) {
      notifyError(errMessage(err, "Gagal mengganti nama playlist"));
    }
  }

  async function handleDeletePlaylist(id: number) {
    try {
      await lib.deletePlaylist(id);
      if (selectedPlaylistId === id) {
        setSelectedPlaylistId(null);
        setLibTab("Favorit");
      }
      if (playingSourceId === id) setPlayingSourceId(null);
    } catch (err) {
      notifyError(errMessage(err, "Gagal menghapus playlist"));
    }
  }

  function cycleRepeat() {
    const order: QueueView["repeat"][] = ["off", "all", "one"];
    const next = order[(order.indexOf(queue.view.repeat) + 1) % order.length];
    void queue.setRepeat(next);
  }

  function togglePlay() {
    if (state.status === "playing") {
      audioEngine.pause();
      setPlaying(false);
    } else if (state.track) {
      // Lagu hasil pemulihan saat start belum dimuat ke <audio>; resolve dulu.
      if (loadedVideoIdRef.current !== state.track.videoId) {
        void startAudio(state.track);
        return;
      }
      void audioEngine.play();
      setPlaying(true);
    }
  }

  mediaControlsRef.current = {
    toggle: togglePlay,
    next: () => void playNextInQueue(),
    previous: () => void playPreviousInQueue(),
  };

  /**
   * Lompat ke posisi tertentu.
   *
   * UI diperbarui segera supaya bar tidak melompat balik sambil menunggu
   * `timeupdate` berikutnya (yang datang hanya ~4×/detik). Posisi "sehat"
   * di engine ikut diset — kalau tidak, seek ke depan lalu terjadi kegagalan
   * sumber akan memulihkan ke posisi lama, bukan ke tempat user melompat.
   */
  function handleSeek(positionMs: number) {
    const durasi = usePlayerStore.getState().state.durationMs;
    audioEngine.seek(positionMs);
    usePlayerStore.getState().setPosition(positionMs, durasi);
  }

  /** Ubah volume; engine langsung menuruti, store jadi cermin untuk UI.
   *
   *  Penyimpanan ditunda 500 ms: menggeser slider menghasilkan puluhan
   *  perubahan, dan menulis SQLite puluhan kali hanya membebani disk tanpa
   *  manfaat — yang perlu bertahan cuma nilai akhirnya. */
  function handleVolume(volume: number) {
    audioEngine.setVolume(volume);
    usePlayerStore.getState().setVolume(volume);

    if (simpanVolumeRef.current) window.clearTimeout(simpanVolumeRef.current);
    simpanVolumeRef.current = window.setTimeout(() => {
      void invoke("setting_set", { key: "volume", value: String(volume) }).catch(() => {
        // Volume bukan hal krusial: gagal simpan tidak boleh mengganggu.
      });
    }, 500);
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
      {/* Tiga area scroll independen: sidebar, tengah, panel kanan. Halaman
          secara keseluruhan TIDAK scroll — kalau iya, player bar ikut tergeser
          dan sidebar kehilangan posisinya (DESIGN-LAYOUT bagian 1). */}
      <div
        style={{
          display: "grid",
          // Panel kanan hanya jadi KOLOM di layar ≥1200px. Di bawah itu ia
          // menimpa (overlay) — menyempitkan tengahnya membuat daftar lagu
          // terlalu sempit untuk dibaca (DESIGN-LAYOUT §8).
          gridTemplateColumns: !isWide
            ? "minmax(0, 1fr)"
            : `var(${sidebarRel ? "--sidebar-rel-w" : "--sidebar-w"}) minmax(0, 1fr)${
                queueOpen && !overlayPanel ? " var(--queue-w)" : ""
              }`,
          position: overlayPanel ? "relative" : undefined,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {isWide && (
          <Sidebar
            rel={sidebarRel}
            route={route}
            onNavigate={setRoute}
            playlists={lib.playlists}
            favorites={lib.favorites}
            selectedPlaylistId={selectedPlaylistId}
            playingPlaylistId={
              state.status === "playing" && typeof playingSourceId === "number"
                ? playingSourceId
                : null
            }
            onSelectPlaylist={handleSelectPlaylist}
            onSelectFavorites={handleSelectFavorites}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onEditPlaylist={(id) => {
              setDetailBaru(false);
              setDetailId(id);
            }}
            onDeletePlaylist={handleDeletePlaylist}
          />
        )}

        {/* minWidth 0 wajib: tanpa itu kolom tengah menolak menyusut dan
            memaksa scroll horizontal saat panel kanan dibuka. */}
        <main ref={mainRef} style={{ minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
          {route === "search" && (
            <Search
              onPlay={handlePlay}
              onQueue={(t) => void queue.add(t)}
              onFavorite={(t) => void lib.toggleFavorite(t)}
              favoriteIds={new Set(lib.favorites.map((f) => f.videoId))}
              onAddToPlaylist={(t) => setPickTarget(t)}
              activeVideoId={state.track?.videoId ?? null}
              query={query}
              setQuery={setQuery}
            />
          )}
          {route === "library" && (
            <Library
              tab={libTab}
              setTab={setLibTab}
              lib={lib}
              isWide={isWide}
              scrollContainerRef={mainRef}
              selectedPlaylistId={selectedPlaylistId}
              onSelectPlaylist={setSelectedPlaylistId}
              activeVideoId={state.track?.videoId ?? null}
              isPlaying={state.status === "playing"}
              playingSourceId={playingSourceId}
              shuffle={queue.view.shuffle}
              onToggleShuffle={() => void queue.setShuffle(!queue.view.shuffle)}
              onTogglePlay={togglePlay}
              onPlayTracks={(tracks, startIdx, srcId) =>
                void playTrackList(tracks, startIdx, srcId)
              }
              onQueue={(t) => void queue.add(t)}
              onPickPlaylist={(t) => setPickTarget(t)}
              onRenamePlaylist={handleRenamePlaylist}
              onDeletePlaylist={handleDeletePlaylist}
              onGoSearch={() => setRoute("search")}
            />
          )}
          {route === "settings" && <Settings onLibraryChanged={() => void lib.refreshAll()} />}
          {/* Mobile: tap mini player membuka layar penuh (DESIGN.md §3).
              Tanpa cabang ini, route 'queue' akan merender layar kosong. */}
          {route === "queue" && (
            <FullPlayer state={state} queue={queue.view.items} onClose={() => setRoute("search")} />
          )}
        </main>

        {queueOpen && (isWide || sheetPanel) && (
          <>
            {/* Bottom sheet (<600px): latar gelap menutup panel saat diketuk. */}
            {sheetPanel && (
              <div
                onClick={closeRightPanel}
                aria-hidden="true"
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  zIndex: 44,
                }}
              />
            )}
            {/* Panel kanan: kolom grid di ≥1200px; overlay di 600–1199px;
                bottom sheet di <600px (DESIGN-LAYOUT §8). Pembungkus ini
                memastikan panel overlay tidak menjadi item grid implisit. */}
            <div
              style={
                sheetPanel
                  ? {
                      position: "fixed",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      height: "70vh",
                      zIndex: 45,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      borderTop: "1px solid var(--line-strong)",
                    }
                  : overlayPanel
                    ? {
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: "var(--queue-w)",
                        maxWidth: "100%",
                        zIndex: 25,
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                        boxShadow: "-8px 0 24px rgba(0,0,0,0.25)",
                      }
                    : { display: "flex", flexDirection: "column", minHeight: 0 }
              }
            >
              <RightPanel
                tab={rightTab}
                onTabChange={setRightTab}
                onClose={closeRightPanel}
                playerState={state}
                view={queue.view}
                onPlayIndex={(pos) => void playQueueIndex(pos)}
                onRemove={(pos) => void queue.remove(pos)}
                onMove={(from, to) => void queue.move(from, to)}
                onClear={() => {
                  audioEngine.pause();
                  loadedVideoIdRef.current = null;
                  setTrack(null);
                  setPlayingSourceId(null);
                  void queue.clear();
                }}
                onToggleShuffle={() => void queue.setShuffle(!queue.view.shuffle)}
                onCycleRepeat={cycleRepeat}
              />
            </div>
          </>
        )}
      </div>

      {adaPlayerBar(bp) ? (
        <PlayerBar
          state={state}
          onToggle={togglePlay}
          onNext={() => void playNextInQueue()}
          onPrevious={() => void playPreviousInQueue()}
          onSeek={handleSeek}
          onVolume={handleVolume}
          onToggleQueue={() => toggleRightTab("queue")}
          onOpenNowPlaying={() => toggleRightTab("now")}
          queueOpen={queueOpen && rightTab === "queue"}
        />
      ) : (
        <MiniPlayer
          track={state.track}
          playing={state.status === "playing"}
          onToggle={togglePlay}
          onOpen={() => setRoute("queue")}
        />
      )}
      {!adaPlayerBar(bp) && <BottomNav route={route} onNavigate={setRoute} />}

      {/* Toast untuk error ringan (DESIGN.md §5): tidak memblokir UI. */}
      {detailId !== null &&
        (() => {
          const pl = lib.playlists.find((p) => p.id === detailId);
          if (!pl) return null;
          return (
            <PlaylistDetailDialog
              playlist={pl}
              baru={detailBaru}
              onClose={() => {
                setDetailId(null);
                setDetailBaru(false);
              }}
              onSaved={() => void lib.refreshPlaylists()}
            />
          );
        })()}

      {pickTarget && (
        <PlaylistPicker
          track={pickTarget}
          playlists={lib.playlists}
          onClose={() => setPickTarget(null)}
          onPick={async (id) => {
            await lib.addToPlaylist(id, pickTarget);
            setPickTarget(null);
            setToast("Ditambahkan ke playlist");
            setTimeout(() => setToast(null), 2500);
          }}
          onCreate={async (name) => {
            const p = await lib.createPlaylist(name);
            await lib.addToPlaylist(p.id, pickTarget);
            setPickTarget(null);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 92,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--panel-2)",
            border: "1px solid var(--danger)",
            color: "var(--ink)",
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
