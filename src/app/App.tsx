import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Route } from "./routes";
import { invoke, listen } from "../lib/tauri";
import type { LyricsResponse, PlayerState, Track } from "../types";
import { Sidebar } from "./layout/Sidebar";
import { BottomNav } from "./layout/BottomNav";
import { MiniPlayer } from "./layout/MiniPlayer";
import { PlayerBar } from "../features/player/PlayerBar";
import { useMenyiapkanPemutar } from "../hooks/useMenyiapkanPemutar";
import { T } from "../lib/strings";

import { RightPanel } from "../features/queue/RightPanel";
import { Search } from "../features/search/Search";
import { Library } from "../features/library/Library";
import { Settings } from "../features/settings/Settings";
import { Stats } from "../features/stats/Stats";
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
import { pencatatMendengar } from "../lib/listen";
import { useLibrary } from "../hooks/useLibrary";
import { PlaylistPicker } from "../features/library/PlaylistPicker";
import { PlaylistDetailDialog } from "../features/library/PlaylistDetailDialog";
import { ImportDialog } from "../features/library/ImportDialog";

const KasetMode = lazy(() =>
  import("../features/player/KasetMode").then((m) => ({ default: m.KasetMode })),
);
const LyricsView = lazy(() =>
  import("../features/lyrics/LyricsView").then((m) => ({ default: m.LyricsView })),
);
const FullscreenLyrics = lazy(() =>
  import("../features/lyrics/FullscreenLyrics").then((m) => ({ default: m.FullscreenLyrics })),
);
/**
 * Kapan prefetch lagu berikutnya dipicu, dihitung dari posisi lagu aktif.
 *
 * 4 detik: cukup lama agar lagu yang baru dibuka tidak langsung memicu resolve
 * kedua (yang akan berebut slot dengan lagu aktif), cukup cepat agar prefetch
 * selesai jauh sebelum lagu berganti.
 */
const AMBANG_PREFETCH_MS = 4000;

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
  const menyiapkanPemutar = useMenyiapkanPemutar();
  const [route, setRoute] = useState<Route>("search");
  // Mode panggung tengah: null = rute biasa (Search, Library, Stats, dll); "kaset" = KasetMode; "lyrics" = LyricsView
  const [centerMode, setCenterMode] = useState<"kaset" | "lyrics" | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [cachedLyrics, setCachedLyrics] = useState<LyricsResponse | null>(null);

  // Panel kanan: default TERBUKA di desktop (3-column layout)
  const [queueOpen, setQueueOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [libTab, setLibTab] = useState<"Playlist" | "Favorit" | "History">("Playlist");
  // Playlist yang sedang dipilih di sidebar (null = Lagu Disukai).
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  // Sumber pemutaran aktif: ID playlist atau "favorites" (untuk tombol play/pause & equalizer).
  const [playingSourceId, setPlayingSourceId] = useState<number | "favorites" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  const { state, setTrack, setTrackWithPosition, setPlaying, setStatus } = usePlayerStore();
  const queue = useQueue();
  const refreshQueue = queue.refresh;
  const lib = useLibrary();
  // Lagu yang sedang dipilih untuk dimasukkan ke playlist (null = dialog tutup).
  const [pickTarget, setPickTarget] = useState<Track | null>(null);
  // Dialog Nama & Detail: null = tertutup, angka = playlist yang diedit.
  // `true` di state kedua menandai playlist baru (judul dialog berbeda).
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailBaru, setDetailBaru] = useState(false);
  // Dialog impor playlist dari berkas (Fase 5).
  const [importBuka, setImportBuka] = useState(false);
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

        // Catat waktu mendengar (Fase 4a). Akumulator yang memutuskan kapan
        // menulis; di sini cuma meneruskan posisi.
        pencatatMendengar.catat(positionMs);

        // Prefetch lagu berikutnya BEBERAPA DETIK SETELAH lagu ini mulai.
        //
        // Dulu dipicu saat sisa < 15 detik. Itu terlalu telat: resolve butuh
        // ~2,5-3 detik setelah pindah ke yt-dlp onedir (dulu 5-6 detik), jadi
        // kalau lagu pendek atau pengguna skip di menit akhir, prefetch belum
        // selesai dan terdengar jeda hening.
        //
        // Sekarang dipicu sekali per lagu di detik ke-AMBANG_PREFETCH. Biaya
        // awalnya satu resolve lebih awal, dan itu ditukar dengan klik->bunyi
        // yang jauh lebih pendek untuk lagu berikutnya.
        if (!prefetchRef.current && durationMs > 0 && positionMs >= AMBANG_PREFETCH_MS) {
          const { items, cursor } = queueViewRef.current;
          const berikut = items[cursor + 1];
          if (berikut?.track.videoId) {
            prefetchRef.current = berikut.track.videoId;
            streamCache.prefetch(berikut.track.videoId);
            console.info(
              `[perf] prefetch mulai videoId=${berikut.track.videoId} pada ${Math.round(positionMs)}ms`,
            );
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

  // Simpan posisi pemutaran berkala ke settings (debounced 1 detik)
  const simpanPosisiRef = useRef<number | null>(null);
  useEffect(() => {
    if (!state.track?.videoId || state.positionMs <= 0) return;
    if (simpanPosisiRef.current) window.clearTimeout(simpanPosisiRef.current);
    simpanPosisiRef.current = window.setTimeout(() => {
      void invoke("setting_set", {
        key: `playback_pos_${state.track!.videoId}`,
        value: String(Math.round(state.positionMs)),
      }).catch(() => {});
    }, 1000);
    return () => {
      if (simpanPosisiRef.current) window.clearTimeout(simpanPosisiRef.current);
    };
  }, [state.track?.videoId, state.positionMs]);

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

  // Toggle panel kanan dengan persistensi
  function toggleQueue() {
    setQueueOpen((buka) => {
      const baru = !buka;
      void invoke("setting_set", { key: "queue_open", value: baru ? "1" : "0" }).catch(() => {});
      return baru;
    });
  }

  // Sinkronisasi awal: kalau antrean dipulihkan dari SQLite saat start,
  // tampilkan lagu aktif di PlayerBar (status paused) beserta posisi terakhirnya
  // supaya PlayerBar dan panel kanan selalu membaca kebenaran yang sama (DESIGN-LAYOUT §6).
  const queueCurrent = queue.view.current;
  useEffect(() => {
    if (!state.track && queueCurrent) {
      let hidup = true;
      void invoke<string | null>("setting_get", {
        key: `playback_pos_${queueCurrent.videoId}`,
      })
        .then((v) => {
          if (!hidup) return;
          const pos = v ? Number(v) : 0;
          if (Number.isFinite(pos) && pos > 0) {
            setTrackWithPosition(queueCurrent, pos);
          } else {
            setTrack(queueCurrent);
          }
        })
        .catch(() => {
          if (hidup) setTrack(queueCurrent);
        });
      return () => {
        hidup = false;
      };
    }
  }, [state.track, queueCurrent, setTrack, setTrackWithPosition]);

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
        toggleQueue();
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
  async function startAudio(t: Track, startAtMs = 0) {
    playStartAtRef.current = { videoId: t.videoId, at: performance.now() };
    // Lagu berganti: prefetch berikutnya boleh dijadwalkan lagi.
    prefetchRef.current = null;
    // Sisa waktu lagu sebelumnya dikirim dulu supaya tidak hilang saat skip.
    pencatatMendengar.gantiLagu(t.videoId);
    if (startAtMs > 0) {
      setTrackWithPosition(t, startAtMs);
    } else {
      setTrack(t);
    }
    setStatus("loading");
    // Riwayat dicatat di sini karena inilah titik lagu benar-benar diminta
    // diputar — bukan saat diklik dan resolve-nya gagal.
    void lib.recordPlay(t);
    try {
      // URL diambil dari cache kalau masih layak. Resolve memanggil yt-dlp dan
      // memakan beberapa detik — memutarnya ulang untuk lagu yang sama persis
      // adalah pemborosan yang terasa oleh user.
      const stream = await streamCache.get(t.videoId);
      await audioEngine.load(stream.url, startAtMs);
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

  function handleNavigate(r: Route) {
    setCenterMode(null);
    setRoute(r);
  }

  function handleSelectFavorites() {
    setCenterMode(null);
    setSelectedPlaylistId(null);
    setLibTab("Favorit");
    setRoute("library");
  }

  function handleSelectPlaylist(id: number) {
    setCenterMode(null);
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
        void startAudio(state.track, state.positionMs);
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
            onNavigate={handleNavigate}
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
            onImportPlaylist={() => setImportBuka(true)}
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
        <main
          ref={mainRef}
          style={{
            minWidth: 0,
            height: "100%",
            minHeight: 0,
            overflowY: centerMode ? "hidden" : "auto",
            overflowX: "hidden",
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          {centerMode === "kaset" ? (
            <Suspense
              fallback={
                <div
                  style={{ padding: 24, color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}
                >
                  MEMUAT DECK KASET...
                </div>
              }
            >
              <KasetMode
                state={state}
                onToggle={togglePlay}
                onNext={() => void playNextInQueue()}
                onPrevious={() => void playPreviousInQueue()}
                onSeek={handleSeek}
              />
            </Suspense>
          ) : centerMode === "lyrics" ? (
            <Suspense
              fallback={
                <div
                  style={{ padding: 24, color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}
                >
                  MEMUAT LIRIK...
                </div>
              }
            >
              <LyricsView
                track={state.track}
                isPlaying={state.status === "playing"}
                onSeek={handleSeek}
                onLyricsLoaded={setCachedLyrics}
                onOpenFullscreen={() => setFullscreenOpen(true)}
              />
            </Suspense>
          ) : (
            <>
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
              {route === "stats" && <Stats />}
              {route === "settings" && <Settings onLibraryChanged={() => void lib.refreshAll()} />}
              {/* Fallback jika route "queue" dipanggil dari mobile */}
              {route === "queue" && (
                <Suspense fallback={null}>
                  <KasetMode
                    state={state}
                    onToggle={togglePlay}
                    onNext={() => void playNextInQueue()}
                    onPrevious={() => void playPreviousInQueue()}
                    onSeek={handleSeek}
                  />
                </Suspense>
              )}
            </>
          )}
        </main>

        {queueOpen && (isWide || sheetPanel) && (
          <>
            {/* Bottom sheet (<600px): latar gelap menutup panel saat diketuk. */}
            {sheetPanel && (
              <div
                onClick={() => setQueueOpen(false)}
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
                onClose={() => setQueueOpen(false)}
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
                onToggleShufflePintar={() => void queue.setShufflePintar(!queue.view.shufflePintar)}
                onCycleRepeat={cycleRepeat}
                onFavorite={(t) => void lib.toggleFavorite(t)}
                isFavorite={Boolean(
                  state.track && lib.favorites.some((f) => f.videoId === state.track?.videoId),
                )}
              />
            </div>
          </>
        )}
      </div>

      {adaPlayerBar(bp) ? (
        <>
          {menyiapkanPemutar && (
            <div
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "6px var(--s-4)",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                flex: "0 0 auto",
              }}
            >
              <span>{T.menyiapkanPemutar}</span>
              <span style={{ opacity: 0.7, fontSize: 10, letterSpacing: 0 }}>
                {T.menyiapkanPemutarHint}
              </span>
            </div>
          )}
          <PlayerBar
            state={state}
            onToggle={togglePlay}
            onNext={() => void playNextInQueue()}
            onPrevious={() => void playPreviousInQueue()}
            onSeek={handleSeek}
            onVolume={handleVolume}
            onToggleKaset={() => setCenterMode((prev) => (prev === "kaset" ? null : "kaset"))}
            onToggleLyrics={() => setCenterMode((prev) => (prev === "lyrics" ? null : "lyrics"))}
            onToggleQueue={() => setQueueOpen((prev) => !prev)}
            onOpenFullscreen={() => setFullscreenOpen(true)}
            kasetActive={centerMode === "kaset"}
            lyricsActive={centerMode === "lyrics"}
            queueOpen={queueOpen}
          />
        </>
      ) : (
        <MiniPlayer
          track={state.track}
          playing={state.status === "playing"}
          onToggle={togglePlay}
          onOpen={() => setCenterMode("kaset")}
        />
      )}
      {!adaPlayerBar(bp) && <BottomNav route={route} onNavigate={setRoute} />}

      {fullscreenOpen && (
        <Suspense fallback={null}>
          <FullscreenLyrics
            track={state.track}
            lyricsData={cachedLyrics}
            isPlaying={state.status === "playing"}
            positionMs={state.positionMs}
            durationMs={state.durationMs}
            onSeek={handleSeek}
            onToggle={togglePlay}
            onNext={() => void playNextInQueue()}
            onPrevious={() => void playPreviousInQueue()}
            onClose={() => setFullscreenOpen(false)}
          />
        </Suspense>
      )}

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

      {importBuka && (
        <ImportDialog
          onClose={() => setImportBuka(false)}
          onSelesai={(id) => {
            void lib.refreshPlaylists();
            setSelectedPlaylistId(id);
            setLibTab("Playlist");
            setRoute("library");
          }}
        />
      )}

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
