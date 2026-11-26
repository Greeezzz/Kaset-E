import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricsResponse, Track } from "../../types";
import { T } from "../../lib/strings";
import { invoke, runningInTauri } from "../../lib/tauri";

/**
 * LyricsView — L2/L3 `FEATURES-V3.md`.
 *
 * L2:
 * - Mengambil lirik dari DB via `lyrics_get`.
 * - Tombol "IMPOR .LRC" dengan native file picker via `open` dari `@tauri-apps/plugin-dialog`
 *   (atau fallback `<input type="file" accept=".lrc,.txt">` di mode web/browser).
 * - Drag-drop berkas `.lrc` langsung ke kontainer lirik.
 * - Validasi: ukuran maks 1 MB, decode UTF-8/fallback, tolak lirik kosong.
 * - Tombol "HAPUS LIRIK".
 * - Pemulihan state persisten per track `videoId`.
 */
export function LyricsView({
  track,
  onLyricsLoaded,
}: {
  track: Track | null;
  onLyricsLoaded?: (data: LyricsResponse | null) => void;
}) {
  const [data, setData] = useState<LyricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const videoId = track?.videoId;

  const muatLirik = useCallback(
    async (vid: string) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await invoke<LyricsResponse | null>("lyrics_get", { videoId: vid });
        setData(res);
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

  // Handler teks lirik (dari File drag-drop atau input HTML)
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
      onLyricsLoaded?.(null);
    } catch (err) {
      console.warn("Gagal menghapus lirik:", err);
    }
  }, [videoId, onLyricsLoaded]);

  // Drag & drop listener
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => {
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void prosesBerkas(file);
    }
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
        minHeight: 220,
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
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid var(--line)",
              paddingBottom: "var(--s-2)",
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
              <span className="mono muted" style={{ fontSize: 9 }}>
                ({data.parsed.lines.length} baris)
              </span>
            </div>

            <div style={{ display: "flex", gap: "var(--s-2)" }}>
              <button
                type="button"
                onClick={handlePilihBerkas}
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "4px 8px",
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
                  padding: "4px 8px",
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

          {/* Pratinjau teks lirik (sebelum L3 tampilan sync penuh) */}
          <div
            style={{
              maxHeight: 260,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "var(--s-2) 0",
            }}
          >
            {data.parsed.lines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: "var(--ink)",
                  display: "flex",
                  gap: 12,
                }}
              >
                {data.parsed.is_synced && (
                  <span
                    className="mono muted"
                    style={{ fontSize: 10, width: 44, flexShrink: 0, opacity: 0.6 }}
                  >
                    {Math.floor(line.time_ms / 60000)}:
                    {String(Math.floor((line.time_ms % 60000) / 1000)).padStart(2, "0")}
                  </span>
                )}
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
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
