import { useState } from "react";
import type { Playlist } from "../../hooks/useLibrary";
import { IkonTutup } from "../../components/icons";
import { T } from "../../lib/strings";
import type { Track } from "../../types";

interface Props {
  track: Track;
  playlists: Playlist[];
  onClose: () => void;
  onPick: (id: number) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

/**
 * Dialog kecil untuk memasukkan lagu ke playlist.
 *
 * Dibuat sebagai overlay ringan, bukan halaman, karena aksinya sering dan
 * pendek: user tidak boleh kehilangan konteks daftar yang sedang dilihat.
 */
export function PlaylistPicker({ track, playlists, onClose, onPick, onCreate }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function jalankan(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      // Klik di luar dialog menutup; klik di dalam tidak.
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={T.tambahKePlaylist}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, calc(100vw - 32px))",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--s-2)",
            padding: "var(--s-3)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span className="label">{T.tambahKePlaylistCaps}</span>
          <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label={T.tutup}
            style={{ width: 32, height: 32, color: "var(--ink-muted)" }}
          >
            <IkonTutup size={16} />
          </button>
        </header>

        <p
          style={{
            padding: "var(--s-2) var(--s-3)",
            fontSize: 13,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {track.title} <span className="muted">— {track.artist}</span>
        </p>

        <div style={{ overflowY: "auto", flex: 1, padding: "0 var(--s-2) var(--s-2)" }}>
          {playlists.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, padding: "var(--s-2)" }}>
              {T.belumAdaPlaylistPicker}
            </p>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => void jalankan(() => onPick(p.id))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--s-2)",
                  width: "100%",
                  minHeight: 40,
                  padding: "0 var(--s-2)",
                  textAlign: "left",
                  color: "var(--ink)",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
                <span className="label">{p.trackCount}</span>
              </button>
            ))
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void jalankan(() => onCreate(n));
          }}
          style={{
            display: "flex",
            gap: "var(--s-2)",
            padding: "var(--s-2) var(--s-3) var(--s-3)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={T.playlistBaruPlaceholder}
            aria-label={T.namaPlaylistBaru}
            style={{
              flex: 1,
              minHeight: 36,
              padding: "0 var(--s-2)",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            style={{
              minHeight: 36,
              padding: "0 var(--s-3)",
              border: "1px solid var(--line)",
              background: name.trim() ? "var(--accent)" : "transparent",
              color: name.trim() ? "var(--accent-ink)" : "var(--ink-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
            }}
          >
            {T.buat}
          </button>
        </form>
      </div>
    </div>
  );
}
