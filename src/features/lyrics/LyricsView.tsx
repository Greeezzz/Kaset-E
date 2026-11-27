import { useCallback, useEffect, useRef, useState } from "react";
import type { LrclibCandidate, LrclibMetadata, LyricsResponse, Track } from "../../types";
import { audioEngine } from "../../lib/audio";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";
import { IkonFullscreen } from "../../components/icons";
import { invoke, runningInTauri } from "../../lib/tauri";

/**
 * LyricsView — L2/L3 `FEATURES-V3.md`.
 *
 * ## Spesifikasi L3 Tersinkron (§4 L3):
 * 1. Baris aktif disorot dengan warna kuning Endfield (latar `--accent` dengan teks `--accent-ink`,
 *    atau aksen jelas di atas latar gelap), baris lain meredup (`--ink-muted` / opacity 0.5).
 * 2. Auto-scroll halus ke baris aktif.
 * 3. Jika pengguna melakukan scroll manual (deteksi `onWheel` / `onTouchMove`), auto-scroll
 *    berhenti sementara dan muncul tombol mengambang "KEMBALI KE BARIS AKTIF".
 * 4. Klik baris lirik langsung seek ke timestamp baris tersebut via `onSeek`.
 * 5. Kontrol offset ±100 ms (dan tombol reset), tersimpan persisten ke database per lagu.
 * 6. Sinkronisasi hemat energi:
 *    - `requestAnimationFrame` hanya berjalan saat tab/jendela terlihat dan status pemutaran aktif.
 *    - Membaca posisi secara langsung via getter read-only `audioEngine.positionMs()`.
 *    - Re-render React **hanya terjadi saat indeks baris aktif benar-benar berubah**.
 * 7. Lirik non-sinkron tampil sebagai teks biasa yang bisa di-scroll.
 * 8. Impor .lrc dan drag & drop (L2) tetap terintegrasi utuh.
 */
export function LyricsView({
  track,
  onSeek,
  isPlaying = false,
  onLyricsLoaded,
  onOpenFullscreen,
}: {
  track: Track | null;
  onSeek?: (positionMs: number) => void;
  isPlaying?: boolean;
  onLyricsLoaded?: (data: LyricsResponse | null) => void;
  onOpenFullscreen?: () => void;
}) {
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // State sinkronisasi L3 & kontrol tampilan ala Referensi HTML
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [userScrolled, setUserScrolled] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [showRomaji, setShowRomaji] = useState(true);
  const [syncToolsOpen, setSyncToolsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Panel pencarian manual LRCLIB (§4 L5): jalur terakhir saat judul video
  // terlalu tidak standar untuk pencarian otomatis.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<LrclibCandidate[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Ref untuk menghindari stale closure dalam rAF loop
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const userScrolledRef = useRef(userScrolled);
  userScrolledRef.current = userScrolled;

  const dataRef = useRef(data);
  dataRef.current = data;

  const offsetMsRef = useRef(offsetMs);
  offsetMsRef.current = offsetMs;

  const videoId = track?.videoId;

  // Muat lirik dari DB saat lagu berubah, fallback ke LRCLIB jika opt-in aktif (§4 L5)
  const muatLirik = useCallback(
    async (currentTrack: Track) => {
      setLoading(true);
      setErrorMsg(null);
      setActiveIndex(-1);
      setUserScrolled(false);
      // Panel manual selalu mulai bersih saat lagu berganti.
      setManualOpen(false);
      setManualQuery("");
      setManualResults([]);
      setManualError(null);
      try {
        let res = await invoke<LyricsResponse | null>("lyrics_get", {
          videoId: currentTrack.videoId,
        });
        if (!res && runningInTauri) {
          // Lirik belum ada di DB lokal -> Coba ambil otomatis dari LRCLIB (hanya jika lirik.lrclib diaktifkan)
          res = await invoke<LyricsResponse | null>("lyrics_fetch_lrclib", {
            videoId: currentTrack.videoId,
            title: currentTrack.title,
            artist: currentTrack.artist,
            durationSecs: currentTrack.durationMs ? currentTrack.durationMs / 1000 : null,
          });
        }
        setData(res);
        setOffsetMs(res?.offset_ms ?? 0);
        onLyricsLoaded?.(res);
      } catch (err) {
        console.warn("Gagal memuat lirik:", err);
      } finally {
        setLoading(false);
      }
    },
    [onLyricsLoaded],
  );

  useEffect(() => {
    if (!track) {
      setData(null);
      onLyricsLoaded?.(null);
      return;
    }
    void muatLirik(track);
  }, [track, muatLirik, onLyricsLoaded]);

  // Efek Sinkronisasi Hemat Energi (§4 L3):
  // Menghitung baris aktif via rAF loop hanya saat memutar & tersinkron.
  // Re-render HANYA dipicu bila index aktif berubah!
  useEffect(() => {
    if (!isPlaying || !data?.parsed.is_synced || data.parsed.lines.length === 0) {
      return;
    }

    let rafId: number;

    const tick = () => {
      // Hentikan tick jika tab sedang tidak terlihat di latar belakang
      if (document.hidden) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const currentData = dataRef.current;
      if (!currentData || !currentData.parsed.is_synced) return;

      const lines = currentData.parsed.lines;
      const currentPos = audioEngine.positionMs();
      const effectivePos = currentPos + currentData.parsed.file_offset_ms + offsetMsRef.current;

      // Cari baris terakhir dengan time_ms <= effectivePos (binary search O(log n))
      let low = 0;
      let high = lines.length - 1;
      let targetIdx = -1;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (lines[mid].time_ms <= effectivePos) {
          targetIdx = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (targetIdx !== activeIndexRef.current) {
        setActiveIndex(targetIdx);
        // Auto scroll ke baris aktif jika user tidak sedang scroll manual
        if (!userScrolledRef.current && targetIdx >= 0) {
          const el = lineRefs.current[targetIdx];
          const container = containerRef.current;
          if (el && container) {
            const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
            container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, data?.parsed.is_synced, data?.parsed.lines.length]);

  // Scroll kembali ke baris aktif
  const scrollToActive = useCallback(() => {
    setUserScrolled(false);
    if (activeIndex >= 0) {
      const el = lineRefs.current[activeIndex];
      const container = containerRef.current;
      if (el && container) {
        const targetTop = el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
      }
    }
  }, [activeIndex]);

  // Klik baris lirik -> seek langsung
  const handleLineClick = useCallback(
    (timeMs: number) => {
      if (!onSeek) return;
      // Memperhitungkan file_offset dan user offset saat melompat
      const targetSeek = Math.max(0, timeMs - (data?.parsed.file_offset_ms ?? 0) - offsetMs);
      onSeek(targetSeek);
      setUserScrolled(false);
    },
    [onSeek, data?.parsed.file_offset_ms, offsetMs],
  );

  // Kontrol Offset (±100ms)
  const ubahOffset = useCallback(
    async (deltaMs: number) => {
      if (!videoId) return;
      const nextOffset = deltaMs === 0 ? 0 : offsetMs + deltaMs;
      setOffsetMs(nextOffset);
      try {
        await invoke("lyrics_set_offset", { videoId, offsetMs: nextOffset });
      } catch (err) {
        console.warn("Gagal menyimpan offset lirik:", err);
      }
    },
    [videoId, offsetMs],
  );

  // Buka panel pencarian manual dan isi kolom dengan judul yang sudah bersih.
  const bukaCariManual = useCallback(async () => {
    setSyncToolsOpen(true);
    setManualOpen(true);
    setManualError(null);
    if (manualQuery.trim() || !track) return;
    try {
      const meta = await invoke<LrclibMetadata>("lyrics_metadata_lirik", {
        title: track.title,
        artist: track.artist,
      });
      setManualQuery(meta.judul_bersih || track.title);
    } catch (err) {
      console.warn("Gagal membersihkan metadata lirik:", err);
      setManualQuery(track.title);
    }
  }, [manualQuery, track]);

  // Cari manual: user yang menentukan kata kunci, bukan sanitizer otomatis.
  const jalankanCariManual = useCallback(async () => {
    const q = manualQuery.trim();
    if (!q) return;
    setManualLoading(true);
    setManualError(null);
    try {
      const hasil = await invoke<LrclibCandidate[]>("lyrics_search_lrclib", {
        query: q,
        durationSecs: track?.durationMs ? track.durationMs / 1000 : null,
      });
      setManualResults(hasil);
      if (hasil.length === 0) setManualError(T.lrclibKosong);
    } catch (err) {
      console.warn("Gagal mencari lirik manual:", err);
      setManualResults([]);
      setManualError(T.lrclibGagal);
    } finally {
      setManualLoading(false);
    }
  }, [manualQuery, track]);

  // Terapkan kandidat pilihan user. Tersimpan per videoId, jadi pilihan yang
  // sama otomatis dipakai lagi saat video ini diputar ulang (§5 cache).
  const terapkanKandidat = useCallback(
    async (kandidat: LrclibCandidate) => {
      if (!videoId) return;
      setManualError(null);
      try {
        const res = await invoke<LyricsResponse>("lyrics_set_from_text", {
          videoId,
          text: kandidat.lrc,
          sumber: "lrclib",
          offsetMs: 0,
        });
        if (res.parsed.lines.length === 0) {
          setManualError(T.lrclibGagalSimpan);
          return;
        }
        setData(res);
        setOffsetMs(0);
        setManualOpen(false);
        setManualResults([]);
        onLyricsLoaded?.(res);
      } catch (err) {
        console.warn("Gagal menerapkan lirik pilihan:", err);
        setManualError(T.lrclibGagalSimpan);
      }
    },
    [videoId, onLyricsLoaded],
  );

  // Handler teks lirik (dari drag-drop / file picker)
  const prosesBerkas = useCallback(
    async (file: File) => {
      if (!videoId) return;
      setErrorMsg(null);

      if (file.size > 1_048_576) {
        setErrorMsg(T.lirikUkuranMaks);
        return;
      }

      try {
        const text = await file.text();
        if (!text.trim()) {
          setErrorMsg(T.lirikFormatTidakValid);
          return;
        }

        const res = await invoke<LyricsResponse>("lyrics_set_from_text", {
          videoId,
          text,
          sumber: "impor",
          offsetMs: 0,
        });

        if (res.parsed.lines.length === 0) {
          setErrorMsg(T.lirikFormatTidakValid);
          return;
        }

        setData(res);
        setOffsetMs(0);
        onLyricsLoaded?.(res);
      } catch (e) {
        console.error("Gagal membaca berkas lirik:", e);
        setErrorMsg(T.lirikGagalBaca);
      }
    },
    [videoId, onLyricsLoaded],
  );

  // Dialog Native Tauri / Browser fallback
  const handlePilihBerkas = useCallback(async () => {
    if (!videoId) return;
    setErrorMsg(null);

    if (runningInTauri) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          filters: [{ name: "Lyrics File (*.lrc, *.txt)", extensions: ["lrc", "txt"] }],
        });

        if (selected && typeof selected === "string") {
          const res = await invoke<LyricsResponse>("lyrics_import_file", {
            videoId,
            path: selected,
          });
          setData(res);
          setOffsetMs(res.offset_ms);
          onLyricsLoaded?.(res);
        }
      } catch (err) {
        const msg =
          err && typeof err === "object" && "message" in err && typeof err.message === "string"
            ? err.message
            : T.lirikGagalBaca;
        setErrorMsg(msg);
      }
    } else {
      fileInputRef.current?.click();
    }
  }, [videoId, onLyricsLoaded]);

  // Hapus lirik
  const handleHapus = useCallback(async () => {
    if (!videoId) return;
    try {
      await invoke("lyrics_delete", { videoId });
      setData(null);
      setErrorMsg(null);
      setActiveIndex(-1);
      onLyricsLoaded?.(null);
    } catch (err) {
      console.warn("Gagal menghapus lirik:", err);
    }
  }, [videoId, onLyricsLoaded]);

  // Drag & drop
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void prosesBerkas(file);
  };

  const panelCariLirik = (
    <>
      {/* Panel CARI LIRIK (LRCLIB Search) */}
      {manualOpen && (
        <div
          className="page-enter"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2)",
            padding: "var(--s-3)",
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--line-strong)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              className="mono muted"
              style={{ fontSize: 9, letterSpacing: "0.08em", fontWeight: 600 }}
            >
              {T.lrclibQueryLabel.toUpperCase()}:
            </span>
            <input
              className="k-input mono"
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void jalankanCariManual();
                }
              }}
              placeholder={T.lrclibQueryHint}
              aria-label={T.lrclibQueryLabel}
              style={{ flex: 1, minWidth: 160, height: 28, fontSize: 11 }}
            />
            <button
              type="button"
              onClick={() => void jalankanCariManual()}
              disabled={manualLoading || !manualQuery.trim()}
              className="k-btn k-btn-accent"
              style={{ minHeight: 28, height: 28, padding: "0 12px", fontSize: 10 }}
            >
              {manualLoading ? T.memuat : T.lrclibTombolCari}
            </button>
            <button
              type="button"
              onClick={() => {
                setManualOpen(false);
                setManualResults([]);
                setManualError(null);
              }}
              className="k-btn k-btn-quiet"
              style={{ minHeight: 28, height: 28, width: 28, padding: 0, fontSize: 11 }}
              aria-label="Tutup pencarian lirik"
            >
              ✕
            </button>
          </div>

          {manualError && (
            <p className="mono" style={{ fontSize: 10, color: "var(--danger)", margin: 0 }}>
              {manualError}
            </p>
          )}

          {manualResults.length > 0 && (
            <div style={{ border: "1px solid var(--line)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 56px 74px",
                  gap: 8,
                  padding: "5px 8px",
                  background: "var(--panel)",
                  borderBottom: "1px solid var(--line)",
                }}
              >
                {[
                  T.lrclibHasilJudul,
                  T.lrclibHasilArtis,
                  T.lrclibHasilDurasi,
                  T.lrclibHasilStatus,
                ].map((judul) => (
                  <span
                    key={judul}
                    className="mono muted"
                    style={{ fontSize: 9, letterSpacing: "0.08em", fontWeight: 600 }}
                  >
                    {judul}
                  </span>
                ))}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {manualResults.map((kandidat) => (
                  <button
                    key={`${kandidat.id ?? "x"}-${kandidat.track_name}-${kandidat.artist_name}`}
                    type="button"
                    onClick={() => void terapkanKandidat(kandidat)}
                    className="k-lirik-row mono"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 56px 74px",
                      gap: 8,
                      width: "100%",
                      alignItems: "center",
                      padding: "7px 8px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--line)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--ink)",
                    }}
                    title={`${kandidat.track_name} — ${kandidat.artist_name}`}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {kandidat.track_name}
                    </span>
                    <span
                      className="muted"
                      style={{
                        fontSize: 10,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {kandidat.artist_name}
                    </span>
                    <span className="muted" style={{ fontSize: 10 }}>
                      {formatDuration(kandidat.duration != null ? kandidat.duration * 1000 : null)}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "2px 5px",
                        justifySelf: "start",
                        letterSpacing: "0.06em",
                        border: `1px solid ${kandidat.synced ? "var(--ok)" : "var(--line-strong)"}`,
                        color: kandidat.synced ? "var(--ok)" : "var(--ink-muted)",
                      }}
                    >
                      {kandidat.synced ? "SYNCED" : "PLAIN"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--s-3)",
        padding: "var(--s-4)",
        border: isDragging ? "2px dashed var(--accent)" : "1px solid var(--line)",
        background: isDragging ? "var(--accent-glow, rgba(255, 230, 0, 0.05))" : "var(--panel)",
        borderRadius: 0,
        position: "relative",
        minHeight: 0,
        flex: 1,
        height: "100%",
        justifyContent: data ? "flex-start" : "center",
        alignItems: data ? "stretch" : "center",
        boxSizing: "border-box",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".lrc,.txt"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void prosesBerkas(file);
          e.target.value = "";
        }}
      />

      {loading ? (
        <p className="mono muted" style={{ fontSize: 11 }}>
          {T.memuat}
        </p>
      ) : data ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-3)",
            flex: 1,
          }}
        >
          {/* Header Panel Lirik Industrial ala Referensi HTML */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid var(--line)",
              paddingBottom: "var(--s-2)",
              flexWrap: "wrap",
              gap: "var(--s-2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
              <span
                className="mono"
                style={{ fontSize: 11, letterSpacing: "0.1em", fontWeight: 700 }}
              >
                02 / LYRICS
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  padding: "2px 6px",
                  background: "transparent",
                  color: data.parsed.is_synced ? "var(--ok)" : "var(--ink-muted)",
                  fontWeight: 600,
                  border: data.parsed.is_synced ? "1px solid var(--ok)" : "1px solid var(--line)",
                }}
              >
                {data.parsed.is_synced ? "SYNCED" : "TEXT"}
              </span>
              {offsetMs !== 0 && (
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    padding: "2px 6px",
                    border: "1px solid var(--line-strong)",
                    color: "var(--ink)",
                  }}
                >
                  {offsetMs >= 0 ? `+${offsetMs}ms` : `${offsetMs}ms`}
                </span>
              )}
            </div>

            {/* Utility Toolbar: [ROMAJI] [SYNC TOOLS] [LAYAR PENUH] [⋯] */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
              <button
                type="button"
                onClick={() => setShowRomaji((r) => !r)}
                aria-pressed={showRomaji}
                className={`k-btn ${showRomaji ? "k-btn-accent" : ""}`}
                style={{ minHeight: 32, height: 32, padding: "0 8px", fontSize: 10 }}
                title="Tampilkan atau sembunyikan baris Romanisasi / Romaji"
              >
                ROMAJI
              </button>

              <button
                type="button"
                onClick={() => setSyncToolsOpen((o) => !o)}
                aria-expanded={syncToolsOpen}
                className={`k-btn ${syncToolsOpen ? "k-btn-accent" : ""}`}
                style={{ minHeight: 32, height: 32, padding: "0 8px", fontSize: 10 }}
              >
                SYNC TOOLS
              </button>

              {onOpenFullscreen && (
                <button
                  type="button"
                  onClick={onOpenFullscreen}
                  title={T.fullscreenLirik}
                  aria-label={T.fullscreenLirik}
                  className="k-btn"
                  style={{ minHeight: 32, height: 32, width: 32, padding: 0 }}
                >
                  <IkonFullscreen size={14} />
                </button>
              )}

              {/* Overflow Menu Dropdown [⋯] */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((m) => !m)}
                  className="k-btn"
                  style={{ minHeight: 32, height: 32, width: 32, padding: 0, fontSize: 14 }}
                  aria-label="Menu opsi lirik lainnya"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      marginTop: 4,
                      width: 160,
                      background: "var(--panel)",
                      border: "1px solid var(--line-strong)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                      zIndex: 30,
                      display: "flex",
                      flexDirection: "column",
                      padding: "4px 0",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void ubahOffset(0);
                        setMenuOpen(false);
                      }}
                      className="mono"
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        fontSize: 10,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        background: "transparent",
                        border: "none",
                        color: "var(--ink)",
                      }}
                    >
                      <span>RESET OFFSET</span>
                      <span className="muted">0ms</span>
                    </button>
                    <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
                    <button
                      type="button"
                      onClick={() => {
                        void handleHapus();
                        setMenuOpen(false);
                      }}
                      className="mono"
                      style={{
                        padding: "8px 12px",
                        textAlign: "left",
                        fontSize: 10,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        background: "transparent",
                        border: "none",
                        color: "var(--danger)",
                        fontWeight: 700,
                      }}
                    >
                      <span>HAPUS LIRIK</span>
                      <span>✕</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Drawer SYNC TOOLS (Collapsible) */}
          {syncToolsOpen && (
            <div
              className="page-enter"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "var(--s-2)",
                padding: "var(--s-2) var(--s-3)",
                background: "var(--bg)",
                border: "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono muted" style={{ fontSize: 10 }}>
                  OFFSET:
                </span>
                <button
                  type="button"
                  onClick={() => void ubahOffset(-1000)}
                  className="k-btn"
                  style={{ minHeight: 28, height: 28, padding: "0 8px", fontSize: 10 }}
                  title="Geser 1 detik (untuk MV dengan intro panjang)"
                >
                  -1s
                </button>
                <button
                  type="button"
                  onClick={() => void ubahOffset(-100)}
                  className="k-btn"
                  style={{ minHeight: 28, height: 28, padding: "0 8px", fontSize: 10 }}
                >
                  -100ms
                </button>
                <span
                  onClick={() => void ubahOffset(0)}
                  className="mono"
                  style={{
                    fontSize: 11,
                    minWidth: 54,
                    textAlign: "center",
                    padding: "3px 6px",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                  title="Klik untuk reset offset ke 0ms"
                >
                  {offsetMs >= 0 ? `+${offsetMs}ms` : `${offsetMs}ms`}
                </span>
                <button
                  type="button"
                  onClick={() => void ubahOffset(100)}
                  className="k-btn"
                  style={{ minHeight: 28, height: 28, padding: "0 8px", fontSize: 10 }}
                >
                  +100ms
                </button>
                <button
                  type="button"
                  onClick={() => void ubahOffset(1000)}
                  className="k-btn"
                  style={{ minHeight: 28, height: 28, padding: "0 8px", fontSize: 10 }}
                  title="Geser 1 detik (untuk MV dengan intro panjang)"
                >
                  +1s
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  type="button"
                  onClick={handlePilihBerkas}
                  className="k-btn k-btn-quiet"
                  style={{ minHeight: 28, height: 28, padding: "0 10px", fontSize: 10 }}
                >
                  {T.imporLrc}
                </button>
                <button
                  type="button"
                  onClick={() => void bukaCariManual()}
                  aria-expanded={manualOpen}
                  className={`k-btn ${manualOpen ? "k-btn-accent" : ""}`}
                  style={{ minHeight: 28, height: 28, padding: "0 10px", fontSize: 10 }}
                  title="Cari lirik manual di LRCLIB"
                >
                  {T.lrclibCari}
                </button>
              </div>
            </div>
          )}

          {panelCariLirik}

          {errorMsg && (
            <p className="mono" style={{ fontSize: 10, color: "var(--danger)" }}>
              {errorMsg}
            </p>
          )}

          {/* Area Lirik yang Bisa Di-scroll dengan Top & Bottom Fade Mask */}
          <div
            ref={containerRef}
            onWheel={() => setUserScrolled(true)}
            onTouchMove={() => setUserScrolled(true)}
            className="lyrics-scroll-mask"
            style={{
              flex: 1,
              minHeight: 0,
              height: "100%",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "var(--s-6) 0",
              position: "relative",
              scrollBehavior: "smooth",
            }}
          >
            {data.parsed.lines.map((line, idx) => {
              const aktif = data.parsed.is_synced && idx === activeIndex;

              return (
                <div
                  key={idx}
                  ref={(el) => {
                    lineRefs.current[idx] = el;
                  }}
                  onClick={() => {
                    if (data.parsed.is_synced) {
                      handleLineClick(line.time_ms);
                    }
                  }}
                  role={data.parsed.is_synced ? "button" : undefined}
                  tabIndex={data.parsed.is_synced ? 0 : undefined}
                  aria-current={aktif ? "true" : undefined}
                  onKeyDown={(e) => {
                    if (data.parsed.is_synced && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleLineClick(line.time_ms);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: aktif ? "10px 14px" : "6px 12px",
                    cursor: data.parsed.is_synced ? "pointer" : "default",
                    transition: "all 0.18s cubic-bezier(0.2, 0, 0, 1)",
                    background: aktif ? "var(--panel)" : "transparent",
                    color: aktif
                      ? "var(--ink)"
                      : data.parsed.is_synced && activeIndex >= 0
                        ? "var(--ink-muted)"
                        : "var(--ink)",
                    opacity: aktif ? 1 : data.parsed.is_synced && activeIndex >= 0 ? 0.35 : 0.85,
                    borderLeft: aktif ? "4px solid var(--accent)" : "4px solid transparent",
                  }}
                >
                  {data.parsed.is_synced && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        padding: "2px 6px",
                        flexShrink: 0,
                        letterSpacing: "0.04em",
                        lineHeight: 1.5,
                        background: aktif ? "var(--accent)" : "transparent",
                        color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
                        fontWeight: aktif ? 700 : 400,
                        border: aktif ? "1px solid #111111" : "1px solid transparent",
                      }}
                    >
                      {formatDuration(line.time_ms)}
                    </span>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, flexGrow: 1 }}>
                    <span
                      style={{
                        fontSize: aktif ? "1.25rem" : "1rem",
                        fontWeight: aktif ? 700 : 500,
                        lineHeight: 1.4,
                        transition: "font-size 0.18s ease, font-weight 0.18s ease",
                      }}
                    >
                      {line.text}
                    </span>
                    {showRomaji &&
                      line.romanized &&
                      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff]/.test(
                        line.text,
                      ) &&
                      line.romanized.trim().toLowerCase() !== line.text.trim().toLowerCase() && (
                        <span
                          className="mono muted"
                          style={{
                            fontSize: 11,
                            lineHeight: 1.3,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {line.romanized}
                        </span>
                      )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tombol Mengambang "KEMBALI KE BARIS AKTIF" saat user scroll manual */}
          {userScrolled && activeIndex >= 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginTop: "-8px",
              }}
            >
              <button
                type="button"
                onClick={scrollToActive}
                className="k-btn k-btn-accent"
                style={{
                  minHeight: 32,
                  height: 32,
                  padding: "0 16px",
                  fontSize: 10,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                {T.kembaliKeBarisAktif}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Keadaan Kosong (Empty State) */
        <div
          style={{ textAlign: "center", display: "grid", gap: "var(--s-3)", placeItems: "center" }}
        >
          <p className="muted" style={{ fontSize: 12 }}>
            {T.lirikTidakAda}
          </p>
          <div style={{ display: "flex", gap: "var(--s-2)", alignItems: "center" }}>
            <button
              type="button"
              onClick={handlePilihBerkas}
              className="mono"
              style={{
                fontSize: 11,
                padding: "8px 16px",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {T.imporLrc}
            </button>
            <button
              type="button"
              onClick={() => void bukaCariManual()}
              className="mono"
              style={{
                fontSize: 11,
                padding: "8px 16px",
                border: "1px solid var(--line-strong)",
                background: "transparent",
                color: "var(--ink)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {T.lrclibCari}
            </button>
          </div>
          {panelCariLirik}
          <p className="mono muted" style={{ fontSize: 9, letterSpacing: "0.08em" }}>
            {T.lirikDropHint}
          </p>
          {errorMsg && (
            <p className="mono" style={{ fontSize: 10, color: "var(--danger)" }}>
              {errorMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
