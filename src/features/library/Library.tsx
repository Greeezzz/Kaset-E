import { useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { EmptyState } from "../../components/EmptyState";
import { PlaylistPage } from "./PlaylistPage";
import { PlaylistTable } from "./PlaylistTable";
import type { useLibrary } from "../../hooks/useLibrary";
import type { Track } from "../../types";
import { T } from "../../lib/strings";

export type LibraryTab = "Playlist" | "Favorit" | "History";

interface Props {
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
  lib: ReturnType<typeof useLibrary>;
  isWide: boolean;
  scrollContainerRef: RefObject<HTMLElement | null>;
  /** Playlist yang dipilih dari sidebar (`null` = Lagu Disukai). */
  selectedPlaylistId: number | null;
  onSelectPlaylist: (id: number | null) => void;
  activeVideoId?: string | null;
  isPlaying?: boolean;
  /** ID playlist yang sedang aktif diputar (`"favorites"` untuk Lagu Disukai). */
  playingSourceId?: number | "favorites" | null;
  shuffle: boolean;
  onToggleShuffle: () => void;
  onTogglePlay: () => void;
  onPlayTracks: (
    tracks: Track[],
    startIndex: number,
    sourceId: number | "favorites" | null,
  ) => void;
  onQueue: (t: Track) => void;
  onPickPlaylist: (t: Track) => void;
  onRenamePlaylist: (id: number, name: string) => Promise<void>;
  onDeletePlaylist: (id: number) => Promise<void>;
  onGoSearch: () => void;
  onOpenMix?: () => void;
}

/**
 * Layar Library (area tengah).
 *
 * Pada desktop (`isWide`), navigasi daftar playlist + Lagu Disukai ada di
 * sidebar kiri sehingga area tengah langsung menampilkan `PlaylistPage` penuh
 * (atau `History` saat dibuka dari pintasan). Pada layar sempit tanpa sidebar,
 * disediakan pemilih ringkas di atas agar semua koleksi tetap terjangkau.
 */
export function Library({
  tab,
  setTab,
  lib,
  isWide,
  scrollContainerRef,
  selectedPlaylistId,
  onSelectPlaylist,
  activeVideoId = null,
  isPlaying = false,
  playingSourceId = null,
  shuffle,
  onToggleShuffle,
  onTogglePlay,
  onPlayTracks,
  onQueue,
  onPickPlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onGoSearch,
  onOpenMix,
}: Props) {
  const [detail, setDetail] = useState<Track[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { refreshFavorites, refreshHistory, refreshPlaylists, playlistTracks } = lib;

  const selectedPlaylist = useMemo(
    () =>
      selectedPlaylistId === null
        ? null
        : (lib.playlists.find((p) => p.id === selectedPlaylistId) ?? null),
    [lib.playlists, selectedPlaylistId],
  );

  // Kunci penyegaran daftar lagu: ikut berubah saat `updatedAt` atau jumlah lagu
  // berubah (mis. setelah menambah lagu dari dialog PlaylistPicker).
  const playlistVersion = selectedPlaylist
    ? `${selectedPlaylist.id}:${selectedPlaylist.trackCount}:${selectedPlaylist.updatedAt}`
    : null;

  useEffect(() => {
    if (tab === "Favorit") void refreshFavorites();
    if (tab === "History") void refreshHistory();
    if (tab === "Playlist") void refreshPlaylists();
  }, [tab, refreshFavorites, refreshHistory, refreshPlaylists]);

  useEffect(() => {
    if (selectedPlaylistId === null) {
      setDetail([]);
      setLoadingDetail(false);
      return;
    }
    let hidup = true;
    setLoadingDetail(true);
    void playlistTracks(selectedPlaylistId)
      .then((list) => {
        if (hidup) setDetail(list);
      })
      .catch(() => {
        if (hidup) setDetail([]);
      })
      .finally(() => {
        if (hidup) setLoadingDetail(false);
      });
    return () => {
      hidup = false;
    };
  }, [selectedPlaylistId, playlistVersion, playlistTracks]);

  const favoriteIds = useMemo(() => new Set(lib.favorites.map((f) => f.videoId)), [lib.favorites]);

  // Tampilan Riwayat Putar.
  if (tab === "History") {
    return (
      <section style={{ padding: "var(--s-6) var(--s-6) var(--s-12)", minWidth: 0 }}>
        {!isWide && (
          <MobileBar
            tab={tab}
            selectedPlaylistId={selectedPlaylistId}
            playlists={lib.playlists}
            onSelectFavorites={() => {
              onSelectPlaylist(null);
              setTab("Favorit");
            }}
            onSelectPlaylist={(id) => {
              onSelectPlaylist(id);
              setTab("Playlist");
            }}
            onSelectHistory={() => setTab("History")}
            onOpenMix={onOpenMix}
          />
        )}

        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--s-3)",
            flexWrap: "wrap",
            paddingBottom: "var(--s-4)",
            marginBottom: "var(--s-4)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={() => {
              onSelectPlaylist(null);
              setTab("Favorit");
            }}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              border: "1px solid var(--line)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: "var(--ink)",
            }}
          >
            ← {T.laguDisukai}
          </button>
          <h1 style={{ fontSize: 28 }}>{T.riwayatPutar}</h1>
          <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
          <span className="label">
            {lib.history.length} {T.laguTerakhir}
          </span>
          <button
            type="button"
            onClick={() => {
              if (confirm(T.konfirmasiHapusRiwayat)) void lib.clearHistory();
            }}
            disabled={lib.history.length === 0}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              border: "1px solid var(--line)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              color: lib.history.length === 0 ? "var(--ink-muted)" : "var(--danger)",
              opacity: lib.history.length === 0 ? 0.5 : 1,
            }}
          >
            {T.hapusRiwayatSemua}
          </button>
        </header>

        {lib.history.length === 0 ? (
          <EmptyState title={T.riwayatKosong} hint={T.riwayatKosongHint} />
        ) : (
          <PlaylistTable
            tracks={lib.history}
            scrollContainerRef={scrollContainerRef}
            activeVideoId={activeVideoId}
            isPlaying={isPlaying}
            favoriteIds={favoriteIds}
            onPlayFromIndex={(idx) => onPlayTracks(lib.history, idx, null)}
            onTogglePlay={onTogglePlay}
            onQueue={onQueue}
            onFavorite={(t) => void lib.toggleFavorite(t)}
            onAddToPlaylist={onPickPlaylist}
          />
        )}
      </section>
    );
  }

  const menampilkanPlaylist = tab === "Playlist" && selectedPlaylist !== null;
  const tracksTampil = menampilkanPlaylist ? detail : lib.favorites;
  const sourceId: number | "favorites" = menampilkanPlaylist ? selectedPlaylist.id : "favorites";

  return (
    <div style={{ minWidth: 0 }}>
      {!isWide && (
        <div style={{ padding: "var(--s-4) var(--s-4) 0" }}>
          <MobileBar
            tab={tab}
            selectedPlaylistId={selectedPlaylistId}
            playlists={lib.playlists}
            onSelectFavorites={() => {
              onSelectPlaylist(null);
              setTab("Favorit");
            }}
            onSelectPlaylist={(id) => {
              onSelectPlaylist(id);
              setTab("Playlist");
            }}
            onSelectHistory={() => setTab("History")}
            onOpenMix={onOpenMix}
          />
        </div>
      )}

      <PlaylistPage
        playlist={menampilkanPlaylist ? selectedPlaylist : null}
        tracks={tracksTampil}
        loading={menampilkanPlaylist ? loadingDetail : lib.loading}
        scrollContainerRef={scrollContainerRef}
        activeVideoId={activeVideoId}
        isPlaying={isPlaying}
        isSourcePlaying={playingSourceId === sourceId}
        shuffle={shuffle}
        favoriteIds={favoriteIds}
        onToggleShuffle={onToggleShuffle}
        onTogglePlay={onTogglePlay}
        onPlayTracks={(list, idx) => onPlayTracks(list, idx, sourceId)}
        onQueue={onQueue}
        onFavorite={(t) => void lib.toggleFavorite(t)}
        onAddToPlaylist={onPickPlaylist}
        onRemoveFromPlaylist={
          menampilkanPlaylist
            ? (t) => {
                void lib.removeFromPlaylist(selectedPlaylist.id, t.videoId);
              }
            : undefined
        }
        onRenamePlaylist={menampilkanPlaylist ? onRenamePlaylist : undefined}
        onDeletePlaylist={menampilkanPlaylist ? onDeletePlaylist : undefined}
        onGoSearch={onGoSearch}
        onOpenHistory={!menampilkanPlaylist ? () => setTab("History") : undefined}
      />
    </div>
  );
}

/** Pemilih koleksi ringkas saat sidebar tersembunyi (< 900px). */
function MobileBar({
  tab,
  selectedPlaylistId,
  playlists,
  onSelectFavorites,
  onSelectPlaylist,
  onSelectHistory,
  onOpenMix,
}: {
  tab: LibraryTab;
  selectedPlaylistId: number | null;
  playlists: { id: number; name: string }[];
  onSelectFavorites: () => void;
  onSelectPlaylist: (id: number) => void;
  onSelectHistory: () => void;
  onOpenMix?: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--s-1)",
        overflowX: "auto",
        paddingBottom: "var(--s-2)",
        marginBottom: "var(--s-2)",
      }}
    >
      {onOpenMix && (
        <button
          type="button"
          onClick={onOpenMix}
          style={{
            flex: "0 0 auto",
            minHeight: 44,
            padding: "0 var(--s-3)",
            border: "1px solid var(--accent)",
            background: "transparent",
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
            fontWeight: 700,
          }}
        >
          ⚡ MIX
        </button>
      )}
      <Pill aktif={tab === "Favorit"} onClick={onSelectFavorites}>
        {T.laguDisukai}
      </Pill>
      {playlists.map((p) => (
        <Pill
          key={p.id}
          aktif={tab === "Playlist" && selectedPlaylistId === p.id}
          onClick={() => onSelectPlaylist(p.id)}
        >
          {p.name}
        </Pill>
      ))}
      <Pill aktif={tab === "History"} onClick={onSelectHistory}>
        {T.riwayat}
      </Pill>
    </div>
  );
}

function Pill({
  aktif,
  onClick,
  children,
}: {
  aktif: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: "0 0 auto",
        minHeight: 44,
        padding: "0 var(--s-3)",
        border: "1px solid var(--line)",
        background: aktif ? "var(--accent)" : "var(--panel)",
        color: aktif ? "var(--accent-ink)" : "var(--ink)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}
