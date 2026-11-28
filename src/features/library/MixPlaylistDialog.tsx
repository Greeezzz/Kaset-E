import { useState } from "react";
import type { Playlist } from "../../hooks/useLibrary";
import type { Track } from "../../types";
import { IkonTutup, IkonPlay } from "../../components/icons";
import { PlaylistArt } from "../../components/PlaylistArt";
import { mixPlaylists, type MixMode } from "../../lib/mixPlaylist";

interface Props {
  playlists: Playlist[];
  favorites: Track[];
  onClose: () => void;
  fetchPlaylistTracks: (playlistId: number) => Promise<Track[]>;
  onPlayMix: (tracks: Track[]) => void;
  onCreatePlaylistWithTracks?: (name: string, tracks: Track[]) => Promise<void>;
}

export function MixPlaylistDialog({
  playlists,
  favorites,
  onClose,
  fetchPlaylistTracks,
  onPlayMix,
  onCreatePlaylistWithTracks,
}: Props) {
  // Simpan ID yang dipilih: "favorites" atau nomor id playlist
  const [selectedIds, setSelectedIds] = useState<Set<number | "favorites">>(new Set());
  const [mixMode, setMixMode] = useState<MixMode>("interleaved");
  const [loading, setLoading] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");

  const toggleSelect = (id: number | "favorites") => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMixAndPlay = async () => {
    if (selectedIds.size < 2) return;
    setLoading(true);
    try {
      const allLists: Track[][] = [];

      for (const id of selectedIds) {
        if (id === "favorites") {
          allLists.push(favorites);
        } else {
          const list = await fetchPlaylistTracks(id);
          allLists.push(list);
        }
      }

      const mixed = mixPlaylists(allLists, mixMode);

      if (saveAsNew && newPlaylistName.trim() && onCreatePlaylistWithTracks) {
        await onCreatePlaylistWithTracks(newPlaylistName.trim(), mixed);
      }

      onPlayMix(mixed);
      onClose();
    } catch (err) {
      console.error("Gagal melakukan mix playlist:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mix Playlist"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, calc(100vw - 32px))",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          border: "1px solid var(--line-strong)",
          boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "var(--s-4)",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div className="mono muted" style={{ fontSize: 11, letterSpacing: "0.1em" }}>
              // FITUR CAMPURAN
            </div>
            <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>Mix Playlist</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--ink-muted)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <IkonTutup size={18} />
          </button>
        </div>

        {/* Konten Pemilihan Playlist */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--s-4)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-2)",
          }}
        >
          <p style={{ margin: "0 0 var(--s-2)", fontSize: 13, color: "var(--muted)" }}>
            Pilih minimal 2 playlist untuk dicampur ke dalam antrean pemutaran:
          </p>

          {/* Opsi Lagu Disukai */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              background: selectedIds.has("favorites") ? "var(--accent-dim, rgba(255,204,0,0.12))" : "var(--bg)",
              border: selectedIds.has("favorites") ? "1px solid var(--accent)" : "1px solid var(--line)",
              cursor: "pointer",
              borderRadius: 2,
            }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has("favorites")}
              onChange={() => toggleSelect("favorites")}
              style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
            />
            <div
              style={{
                width: 38,
                height: 38,
                background: "var(--accent)",
                color: "var(--accent-ink)",
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              ♥
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Lagu Disukai (Favorit)</div>
              <div className="mono muted" style={{ fontSize: 11 }}>
                {favorites.length} lagu
              </div>
            </div>
          </label>

          {/* Daftar Semua Playlist */}
          {playlists.map((p) => {
            const terpilih = selectedIds.has(p.id);
            return (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: terpilih ? "var(--accent-dim, rgba(255,204,0,0.12))" : "var(--bg)",
                  border: terpilih ? "1px solid var(--accent)" : "1px solid var(--line)",
                  cursor: "pointer",
                  borderRadius: 2,
                }}
              >
                <input
                  type="checkbox"
                  checked={terpilih}
                  onChange={() => toggleSelect(p.id)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
                />
                <PlaylistArt playlist={p} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {p.trackCount} lagu
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Pilihan Mode Campuran & Opsi Simpan */}
        <div
          style={{
            padding: "var(--s-4)",
            borderTop: "1px solid var(--line)",
            background: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: "0.08em", marginBottom: 6 }}>
              POLA PENCAMPURAN (MIX MODE)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <button
                type="button"
                onClick={() => setMixMode("interleaved")}
                className="mono"
                style={{
                  padding: "8px 4px",
                  fontSize: 11,
                  background: mixMode === "interleaved" ? "var(--accent)" : "transparent",
                  color: mixMode === "interleaved" ? "var(--accent-ink)" : "var(--ink)",
                  border: mixMode === "interleaved" ? "1px solid var(--accent)" : "1px solid var(--line)",
                  cursor: "pointer",
                  fontWeight: mixMode === "interleaved" ? 700 : 400,
                }}
              >
                Bergantian
              </button>
              <button
                type="button"
                onClick={() => setMixMode("shuffle")}
                className="mono"
                style={{
                  padding: "8px 4px",
                  fontSize: 11,
                  background: mixMode === "shuffle" ? "var(--accent)" : "transparent",
                  color: mixMode === "shuffle" ? "var(--accent-ink)" : "var(--ink)",
                  border: mixMode === "shuffle" ? "1px solid var(--accent)" : "1px solid var(--line)",
                  cursor: "pointer",
                  fontWeight: mixMode === "shuffle" ? 700 : 400,
                }}
              >
                Acak Total
              </button>
              <button
                type="button"
                onClick={() => setMixMode("sequential")}
                className="mono"
                style={{
                  padding: "8px 4px",
                  fontSize: 11,
                  background: mixMode === "sequential" ? "var(--accent)" : "transparent",
                  color: mixMode === "sequential" ? "var(--accent-ink)" : "var(--ink)",
                  border: mixMode === "sequential" ? "1px solid var(--accent)" : "1px solid var(--line)",
                  cursor: "pointer",
                  fontWeight: mixMode === "sequential" ? 700 : 400,
                }}
              >
                Bersambung
              </button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {mixMode === "interleaved" && "Lagu diputar bergantian 1:1 dari tiap playlist (A1, B1, A2, B2...)"}
              {mixMode === "shuffle" && "Semua lagu dari playlist terpilih digabung dan diacak merata."}
              {mixMode === "sequential" && "Playlist pertama dimainkan hingga selesai, lalu lanjut ke playlist berikutnya."}
            </div>
          </div>

          {/* Opsi Simpan sebagai Playlist baru */}
          {onCreatePlaylistWithTracks && (
            <div style={{ paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={saveAsNew}
                  onChange={(e) => setSaveAsNew(e.target.checked)}
                  style={{ accentColor: "var(--accent)" }}
                />
                Simpan hasil racikan ini sebagai playlist baru
              </label>

              {saveAsNew && (
                <input
                  type="text"
                  placeholder="Nama playlist racikan (mis: Chill & Nostalgia Mix)"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  style={{
                    width: "100%",
                    marginTop: 8,
                    padding: "6px 10px",
                    background: "var(--panel)",
                    border: "1px solid var(--line-strong)",
                    color: "var(--ink)",
                    fontSize: 12,
                  }}
                />
              )}
            </div>
          )}

          {/* Tombol Aksi */}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => void handleMixAndPlay()}
              disabled={selectedIds.size < 2 || loading || (saveAsNew && !newPlaylistName.trim())}
              className="mono"
              style={{
                flex: 1,
                padding: "10px 16px",
                background: selectedIds.size >= 2 ? "var(--accent)" : "var(--line)",
                color: selectedIds.size >= 2 ? "var(--accent-ink)" : "var(--muted)",
                border: "none",
                fontWeight: 700,
                fontSize: 12,
                letterSpacing: "0.08em",
                cursor: selectedIds.size >= 2 ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <IkonPlay size={14} />
              {loading ? "MEMPROSES..." : `PUTAR CAMPURAN (${selectedIds.size} PLAYLIST)`}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="mono"
              style={{
                padding: "10px 16px",
                background: "transparent",
                color: "var(--ink)",
                border: "1px solid var(--line)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              BATAL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
