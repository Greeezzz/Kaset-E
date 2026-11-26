import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsResponse, Track } from "../../types";
import { audioEngine } from "../../lib/audio";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";
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
}: {
  track: Track | null;
  onSeek?: (positionMs: number) => void;
  isPlaying?: boolean;
  onLyricsLoaded?: (data: LyricsResponse | null) => void;
}) {
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // State sinkronisasi L3
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [userScrolled, setUserScrolled] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);

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

  // Muat lirik dari DB saat lagu berubah
  const muatLirik = useCallback(
    async (vid: string) => {
      setLoading(true);
      setErrorMsg(null);
      setActiveIndex(-1);
      setUserScrolled(false);
      try {
        const res = await invoke<LyricsResponse | null>("lyrics_get", { videoId: vid });
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
    if (!videoId) {
      setData(null);
      onLyricsLoaded?.(null);
      return;
    }
    void muatLirik(videoId);
  }, [videoId, muatLirik, onLyricsLoaded]);

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
          if (el && containerRef.current) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
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
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
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
        minHeight: 280,
        justifyContent: data ? "flex-start" : "center",
        alignItems: "center",
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
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
          {/* Header Panel Lirik */}
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
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.1em", fontWeight: 600 }}>
                {T.lirik}
              </span>
              <span
                className="mono muted"
                style={{
                  fontSize: 9,
                  border: "1px solid var(--line)",
                  padding: "1px 6px",
                  background: "var(--panel-2)",
                }}
              >
                {data.parsed.is_synced ? T.lirikTersinkron : T.lirikTeksBiasa}
              </span>
            </div>

            {/* Kontrol Offset & Aksi */}
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
              {data.parsed.is_synced && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    background: "var(--panel-2)",
                    padding: "2px 4px",
                    border: "1px solid var(--line)",
                  }}
                  title={T.lirikOffsetHint}
                >
                  <button
                    type="button"
                    onClick={() => void ubahOffset(-100)}
                    aria-label="Kurangi offset 100ms"
                    className="mono"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--ink)",
                      cursor: "pointer",
                      padding: "0 4px",
                      fontSize: 10,
                    }}
                  >
                    -
                  </button>
                  <span
                    onClick={() => void ubahOffset(0)}
                    title="Klik untuk reset offset ke 0"
                    className="mono"
                    style={{
                      fontSize: 9,
                      cursor: "pointer",
                      minWidth: 46,
                      textAlign: "center",
                      color: offsetMs !== 0 ? "var(--accent)" : "var(--ink-muted)",
                      fontWeight: offsetMs !== 0 ? 600 : 400,
                    }}
                  >
                    {offsetMs >= 0 ? `+${offsetMs}ms` : `${offsetMs}ms`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void ubahOffset(100)}
                    aria-label="Tambah offset 100ms"
                    className="mono"
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--ink)",
                      cursor: "pointer",
                      padding: "0 4px",
                      fontSize: 10,
                    }}
                  >
                    +
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handlePilihBerkas}
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  border: "1px solid var(--line)",
                  background: "transparent",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                {T.imporLrc}
              </button>
              <button
                type="button"
                onClick={handleHapus}
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  border: "1px solid var(--danger)",
                  background: "transparent",
                  color: "var(--danger)",
                  cursor: "pointer",
                }}
              >
                {T.hapusLirik}
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="mono" style={{ fontSize: 10, color: "var(--danger)" }}>
              {errorMsg}
            </p>
          )}

          {/* Area Lirik yang Bisa Di-scroll */}
          <div
            ref={containerRef}
            onWheel={() => setUserScrolled(true)}
            onTouchMove={() => setUserScrolled(true)}
            style={{
              maxHeight: 280,
              minHeight: 180,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "var(--s-4) 0",
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
                    padding: "6px 10px",
                    cursor: data.parsed.is_synced ? "pointer" : "default",
                    transition: "all 0.15s ease",
                    background: aktif ? "var(--accent)" : "transparent",
                    color: aktif
                      ? "var(--accent-ink)"
                      : data.parsed.is_synced && activeIndex >= 0
                        ? "var(--ink-muted)"
                        : "var(--ink)",
                    fontWeight: aktif ? 600 : 400,
                    opacity: aktif ? 1 : data.parsed.is_synced && activeIndex >= 0 ? 0.45 : 0.9,
                    borderLeft: aktif ? "3px solid var(--ink)" : "3px solid transparent",
                  }}
                >
                  {data.parsed.is_synced && (
                    <span
                      className="mono"
                      style={{
                        fontSize: 9,
                        width: 36,
                        flexShrink: 0,
                        opacity: aktif ? 0.85 : 0.6,
                        letterSpacing: "0.04em",
                        lineHeight: 1.6,
                      }}
                    >
                      {formatDuration(line.time_ms)}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 14,
                      lineHeight: 1.45,
                      flexGrow: 1,
                    }}
                  >
                    {line.text}
                  </span>
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
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  padding: "4px 12px",
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
                }}
              >
                {T.kembaliKeBarisAktif}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Keadaan Kosong (Empty State) */
        <div style={{ textAlign: "center", display: "grid", gap: "var(--s-3)", placeItems: "center" }}>
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
          </div>
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
