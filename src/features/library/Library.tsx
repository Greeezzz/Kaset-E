import { useEffect, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { TrackRow } from "../../components/TrackRow";
import type { Playlist, useLibrary } from "../../hooks/useLibrary";
import type { Track } from "../../types";

export type LibraryTab = "Playlist" | "Favorit" | "History";

interface Props {
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
  lib: ReturnType<typeof useLibrary>;
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  /** Putar seluruh isi playlist sebagai antrean baru. */
  onPlayPlaylist: (id: number) => void;
  /** Buka dialog "tambahkan ke playlist" untuk sebuah lagu. */
  onPickPlaylist: (t: Track) => void;
}

const TABS: LibraryTab[] = ["Playlist", "Favorit", "History"];

const BTN = {
  border: "1px solid var(--line)",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
} as const;

/**
 * Library.
 *
 * Tiga tab, satu pola: daftar lagu dengan aksi yang sama seperti di pencarian
 * (putar, antrekan, putar berikutnya). Konsistensi ini disengaja — user tidak
 * perlu mempelajari tata cara baru hanya karena lagunya berasal dari library.
 */
export function Library({
  tab,
  setTab,
  lib,
  onPlay,
  onQueue,
  onPlayNext,
  onPlayPlaylist,
  onPickPlaylist,
}: Props) {
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Track[]>([]);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Diambil terpisah karena `lib` adalah objek baru setiap render, sementara
  // fungsi-fungsi ini stabil (useCallback). Tanpa pemisahan ini, effect akan
  // berjalan di setiap render.
  const { refreshFavorites, refreshHistory, refreshPlaylists } = lib;

  // Riwayat tidak di-refresh setiap kali lagu diputar (itu berarti memuat
  // ulang seluruh daftar puluhan kali per lagu), jadi dimuat saat tab dibuka.
  // Tanpa ini, tab History menampilkan "0 LAGU" padahal database sudah terisi.
  useEffect(() => {
    if (tab === "Favorit") void refreshFavorites();
    if (tab === "History") void refreshHistory();
    if (tab === "Playlist") void refreshPlaylists();
  }, [tab, refreshFavorites, refreshHistory, refreshPlaylists]);

  async function openPlaylist(p: Playlist) {
    if (openId === p.id) {
      setOpenId(null);
      setDetail([]);
      return;
    }
    setOpenId(p.id);
    setDetail(await lib.playlistTracks(p.id));
  }

  async function buat(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await lib.createPlaylist(name);
    setNewName("");
  }

  async function simpanNama(id: number) {
    const name = renameValue.trim();
    if (name) await lib.renamePlaylist(id, name);
    setRenaming(null);
    setRenameValue("");
  }

  /** Satu baris lagu + aksi tambahan di kanan (di luar TrackRow). */
  function baris(t: Track, i: number, aksi: React.ReactNode) {
    return (
      <div key={`${t.videoId}-${i}`} style={{ display: "flex", alignItems: "center" }}>
        <TrackRow track={t} index={i} onPlay={onPlay} onQueue={onQueue} onPlayNext={onPlayNext} />
        {aksi}
      </div>
    );
  }

  return (
    <section style={{ padding: "var(--s-4)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-2)",
          marginBottom: "var(--s-3)",
        }}
      >
        <h1 style={{ fontSize: 24 }}>Library</h1>
        <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
        <span className="label">
          {lib.playlists.length} PLAYLIST · {lib.favorites.length} FAVORIT
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Bagian library"
        style={{ display: "flex", gap: "var(--s-1)" }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              ...BTN,
              minHeight: 40,
              padding: "0 var(--s-3)",
              background: tab === t ? "var(--accent)" : "transparent",
              color: tab === t ? "var(--accent-ink)" : "var(--ink-muted)",
              textTransform: "uppercase",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "var(--s-4)" }}>
        {tab === "Playlist" && (
          <>
            <form
              onSubmit={buat}
              style={{ display: "flex", gap: "var(--s-2)", marginBottom: "var(--s-3)" }}
            >
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nama playlist baru"
                aria-label="Nama playlist baru"
                style={{
                  flex: 1,
                  minHeight: 40,
                  padding: "0 var(--s-3)",
                  background: "var(--panel)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                style={{
                  ...BTN,
                  minHeight: 40,
                  padding: "0 var(--s-4)",
                  background: newName.trim() ? "var(--accent)" : "transparent",
                  color: newName.trim() ? "var(--accent-ink)" : "var(--ink-muted)",
                }}
              >
                BUAT
              </button>
            </form>

            {lib.playlists.length === 0 ? (
              <EmptyState
                title="BELUM ADA PLAYLIST"
                hint="Buat playlist lewat kolom di atas, lalu tambahkan lagu dari pencarian."
              />
            ) : (
              <div style={{ display: "grid", gap: "var(--s-1)" }}>
                {lib.playlists.map((p) => (
                  <div
                    key={p.id}
                    style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--s-2)",
                        padding: "var(--s-2)",
                      }}
                    >
                      {renaming === p.id ? (
                        <>
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void simpanNama(p.id);
                              if (e.key === "Escape") setRenaming(null);
                            }}
                            aria-label={`Nama baru untuk ${p.name}`}
                            style={{
                              flex: 1,
                              minHeight: 32,
                              padding: "0 var(--s-2)",
                              background: "var(--bg)",
                              border: "1px solid var(--accent)",
                              color: "var(--ink)",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void simpanNama(p.id)}
                            style={{ minHeight: 32, padding: "0 var(--s-2)", color: "var(--ink)" }}
                          >
                            SIMPAN
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void openPlaylist(p)}
                          aria-expanded={openId === p.id}
                          style={{
                            flex: 1,
                            minHeight: 32,
                            textAlign: "left",
                            color: "var(--ink)",
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--s-2)",
                          }}
                        >
                          <span
                            className="mono"
                            style={{ color: "var(--ink-muted)", fontSize: 12 }}
                          >
                            {openId === p.id ? "▾" : "▸"}
                          </span>
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
                          <span className="label">{p.trackCount} LAGU</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onPlayPlaylist(p.id)}
                        disabled={p.trackCount === 0}
                        title="Putar playlist"
                        aria-label={`Putar playlist ${p.name}`}
                        style={{
                          width: 32,
                          height: 32,
                          color: p.trackCount === 0 ? "var(--ink-muted)" : "var(--ink)",
                          opacity: p.trackCount === 0 ? 0.4 : 1,
                        }}
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenaming(p.id);
                          setRenameValue(p.name);
                        }}
                        aria-label={`Ganti nama ${p.name}`}
                        title="Ganti nama"
                        style={{ width: 32, height: 32, color: "var(--ink-muted)" }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            confirm(`Hapus playlist "${p.name}"? Lagu di dalamnya tidak terhapus.`)
                          ) {
                            void lib.deletePlaylist(p.id);
                            if (openId === p.id) {
                              setOpenId(null);
                              setDetail([]);
                            }
                          }
                        }}
                        aria-label={`Hapus playlist ${p.name}`}
                        title="Hapus playlist"
                        style={{ width: 32, height: 32, color: "var(--danger)" }}
                      >
                        ✕
                      </button>
                    </div>

                    {openId === p.id && (
                      <div style={{ borderTop: "1px solid var(--line)", padding: "var(--s-2)" }}>
                        {detail.length === 0 ? (
                          <p className="muted" style={{ fontSize: 13, padding: "var(--s-2)" }}>
                            Playlist kosong. Tambahkan lagu lewat tombol + di hasil pencarian.
                          </p>
                        ) : (
                          detail.map((t, i) =>
                            baris(
                              t,
                              i,
                              <button
                                type="button"
                                onClick={async () => {
                                  await lib.removeFromPlaylist(p.id, t.videoId);
                                  setDetail(await lib.playlistTracks(p.id));
                                }}
                                aria-label={`Hapus ${t.title} dari ${p.name}`}
                                title="Hapus dari playlist"
                                style={{
                                  width: 32,
                                  height: 32,
                                  color: "var(--ink-muted)",
                                  flex: "0 0 32px",
                                }}
                              >
                                ✕
                              </button>,
                            ),
                          )
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "Favorit" &&
          (lib.favorites.length === 0 ? (
            <EmptyState
              title="BELUM ADA FAVORIT"
              hint="Tekan ♥ pada lagu yang kamu suka — dari pencarian maupun dari pemutar."
            />
          ) : (
            lib.favorites.map((t, i) =>
              baris(
                t,
                i,
                <button
                  type="button"
                  onClick={() => void lib.toggleFavorite(t)}
                  aria-label={`Hapus ${t.title} dari favorit`}
                  title="Hapus dari favorit"
                  style={{ width: 32, height: 32, color: "var(--accent)", flex: "0 0 32px" }}
                >
                  ♥
                </button>,
              ),
            )
          ))}

        {tab === "History" && (
          <>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--s-2)" }}>
              <span className="label">{lib.history.length} LAGU TERAKHIR</span>
              <span
                style={{ flex: 1, borderTop: "1px solid var(--line)", margin: "0 var(--s-2)" }}
              />
              <button
                type="button"
                onClick={() => {
                  if (confirm("Hapus seluruh riwayat putar?")) void lib.clearHistory();
                }}
                disabled={lib.history.length === 0}
                style={{
                  ...BTN,
                  minHeight: 28,
                  padding: "0 var(--s-2)",
                  color: lib.history.length === 0 ? "var(--ink-muted)" : "var(--danger)",
                  opacity: lib.history.length === 0 ? 0.5 : 1,
                }}
              >
                HAPUS RIWAYAT
              </button>
            </div>

            {lib.history.length === 0 ? (
              <EmptyState
                title="RIWAYAT KOSONG"
                hint="Lagu yang kamu putar akan tercatat di sini."
              />
            ) : (
              lib.history.map((t, i) =>
                baris(
                  t,
                  i,
                  <button
                    type="button"
                    onClick={() => onPickPlaylist(t)}
                    aria-label={`Tambahkan ${t.title} ke playlist`}
                    title="Tambahkan ke playlist"
                    style={{ width: 32, height: 32, color: "var(--ink-muted)", flex: "0 0 32px" }}
                  >
                    ≣
                  </button>,
                ),
              )
            )}
          </>
        )}
      </div>
    </section>
  );
}
