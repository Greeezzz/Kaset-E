import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Track } from "../../types";
import { CoverArt } from "../../components/CoverArt";
import { formatDuration } from "../../lib/format";
import { T } from "../../lib/strings";
import { IkonPlay, IkonPause, IkonMenu, IkonHati } from "../../components/icons";
import { AksiMenu } from "../../components/AksiMenu";

const ROW_HEIGHT = 56;
const OVERSCAN = 6;

interface Props {
  tracks: Track[];
  /** Scroll container induk (`<main>`) untuk menghitung jendela virtualisasi. */
  scrollContainerRef: RefObject<HTMLElement | null>;
  activeVideoId?: string | null;
  isPlaying?: boolean;
  favoriteIds: Set<string>;
  onPlayFromIndex: (index: number) => void;
  onTogglePlay?: () => void;
  onQueue: (track: Track) => void;
  onFavorite: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  /** Ada hanya untuk playlist pengguna (bukan Lagu Disukai / Riwayat). */
  onRemove?: (track: Track) => void;
  labelHapus?: string;
}

/**
 * Tabel lagu bervirtualisasi untuk halaman Playlist & Lagu Disukai
 * (DESIGN-LAYOUT bagian 3.3).
 *
 * Virtualisasi wajib supaya playlist 500+ lagu tetap mulus: hanya baris di
 * dalam viewport + overscan yang dirender, dengan spacer atas/bawah di aliran
 * dokumen biasa (bukan absolute) agar dropdown menu `⋯` tidak terpotong oleh
 * stacking context.
 */
export function PlaylistTable({
  tracks,
  scrollContainerRef,
  activeVideoId = null,
  isPlaying = false,
  favoriteIds,
  onPlayFromIndex,
  onTogglePlay,
  onQueue,
  onFavorite,
  onAddToPlaylist,
  onRemove,
  labelHapus,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [lebar, setLebar] = useState(900);
  const [range, setRange] = useState({ start: 0, end: Math.min(tracks.length, 30) });

  // Pantau lebar tabel untuk menyembunyikan kolom ALBUM saat ruang sempit,
  // sehingga tidak pernah muncul scroll horizontal.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ukur = () => setLebar(el.clientWidth || 900);
    ukur();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(ukur);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hitung jendela baris yang terlihat di dalam scroll container `<main>`.
  useEffect(() => {
    const scroller = scrollContainerRef.current;
    const hitung = () => {
      if (!scroller || !bodyRef.current) {
        setRange({ start: 0, end: Math.min(tracks.length, 40) });
        return;
      }
      const listTop =
        bodyRef.current.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const relScroll = Math.max(0, scroller.scrollTop - listTop);
      const viewportH = scroller.clientHeight || 600;
      const start = Math.max(0, Math.floor(relScroll / ROW_HEIGHT) - OVERSCAN);
      const end = Math.min(
        tracks.length,
        Math.ceil((relScroll + viewportH) / ROW_HEIGHT) + OVERSCAN,
      );
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    hitung();
    if (!scroller) return;
    scroller.addEventListener("scroll", hitung, { passive: true });
    window.addEventListener("resize", hitung);
    return () => {
      scroller.removeEventListener("scroll", hitung);
      window.removeEventListener("resize", hitung);
    };
  }, [scrollContainerRef, tracks.length]);

  const tampilAlbum = lebar >= 660;
  const gridCols = tampilAlbum
    ? "44px minmax(0, 1fr) minmax(0, 200px) 68px 88px"
    : "44px minmax(0, 1fr) 68px 88px";

  const visibleStart = Math.min(range.start, tracks.length);
  const visibleEnd = Math.min(range.end, tracks.length);
  const topSpace = visibleStart * ROW_HEIGHT;
  const bottomSpace = Math.max(0, (tracks.length - visibleEnd) * ROW_HEIGHT);

  return (
    <div ref={rootRef} role="table" aria-label={T.playlist} style={{ width: "100%", minWidth: 0 }}>
      {/* Header kolom: mono caps 11px, garis bawah --line. */}
      <div
        role="row"
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          alignItems: "center",
          gap: "var(--s-2)",
          height: 36,
          padding: "0 var(--s-2)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span role="columnheader" className="label" style={{ textAlign: "center" }}>
          #
        </span>
        <span role="columnheader" className="label">
          {T.kolomJudul}
        </span>
        {tampilAlbum && (
          <span role="columnheader" className="label">
            {T.kolomAlbum}
          </span>
        )}
        <span role="columnheader" className="label" style={{ textAlign: "right" }}>
          {T.kolomDurasi}
        </span>
        <span role="columnheader" aria-hidden="true" />
      </div>

      {/* Isi tabel dengan spacer atas & bawah untuk virtualisasi. */}
      <div ref={bodyRef} role="rowgroup">
        {topSpace > 0 && <div style={{ height: topSpace }} aria-hidden="true" />}

        {tracks.slice(visibleStart, visibleEnd).map((track, offset) => {
          const index = visibleStart + offset;
          const active = activeVideoId === track.videoId;
          return (
            <BarisTabel
              key={`${track.videoId}-${index}`}
              track={track}
              index={index}
              gridCols={gridCols}
              tampilAlbum={tampilAlbum}
              active={active}
              playing={active && isPlaying}
              favorite={favoriteIds.has(track.videoId)}
              onPlayFromIndex={onPlayFromIndex}
              onTogglePlay={onTogglePlay}
              onQueue={onQueue}
              onFavorite={onFavorite}
              onAddToPlaylist={onAddToPlaylist}
              onRemove={onRemove}
              labelHapus={labelHapus}
            />
          );
        })}

        {bottomSpace > 0 && <div style={{ height: bottomSpace }} aria-hidden="true" />}
      </div>
    </div>
  );
}

function BarisTabel({
  track,
  index,
  gridCols,
  tampilAlbum,
  active,
  playing,
  favorite,
  onPlayFromIndex,
  onTogglePlay,
  onQueue,
  onFavorite,
  onAddToPlaylist,
  onRemove,
  labelHapus,
}: {
  track: Track;
  index: number;
  gridCols: string;
  tampilAlbum: boolean;
  active: boolean;
  playing: boolean;
  favorite: boolean;
  onPlayFromIndex: (index: number) => void;
  onTogglePlay?: () => void;
  onQueue: (track: Track) => void;
  onFavorite: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onRemove?: (track: Track) => void;
  labelHapus?: string;
}) {
  const [hover, setHover] = useState(false);
  const [fokus, setFokus] = useState(false);
  const [menuBuka, setMenuBuka] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Penutupan menu ditangani `AksiMenu`.

  const tampilAksi = hover || fokus || menuBuka;
  const sorot = active || hover;

  function klikPutar() {
    if (active && playing && onTogglePlay) {
      onTogglePlay();
    } else {
      onPlayFromIndex(index);
    }
  }

  function jalankan(fn: () => void) {
    setMenuBuka(false);
    fn();
  }

  return (
    <div
      role="row"
      onDoubleClick={() => onPlayFromIndex(index)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFokus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFokus(false);
      }}
      style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        alignItems: "center",
        gap: "var(--s-2)",
        height: ROW_HEIGHT,
        padding: "0 var(--s-2)",
        borderBottom: "1px solid var(--line)",
        background: sorot ? "var(--panel-2)" : "transparent",
        // Penanda aktif & hover: garis kuning 3px di tepi kiri (DESIGN-LAYOUT §3.3).
        boxShadow: sorot ? "inset 3px 0 0 var(--accent)" : "none",
        position: "relative",
        zIndex: menuBuka ? 20 : undefined,
      }}
    >
      {/* Kolom #: nomor / equalizer aktif / tombol play saat hover atau fokus. */}
      <div role="cell" style={{ display: "grid", placeItems: "center" }}>
        {tampilAksi ? (
          <button
            type="button"
            onClick={klikPutar}
            aria-label={playing ? `${T.jeda} ${track.title}` : `${T.putar} ${track.title}`}
            style={{
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              color: "var(--ink)",
              fontSize: 13,
            }}
          >
            {playing ? <IkonPause size={13} /> : <IkonPlay size={13} />}
          </button>
        ) : playing ? (
          <span className="eq-bars" style={{ color: "var(--ink)" }} aria-label={T.sedangDiputar}>
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span className="mono muted" style={{ fontSize: 12 }}>
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
      </div>

      {/* Kolom JUDUL: cover 40x40 + judul (tebal saat aktif) + artis. */}
      <div
        role="cell"
        style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", minWidth: 0 }}
      >
        <CoverArt coverKey={track.coverKey} title={track.title} size={40} radius={0} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 14,
              fontWeight: active ? 600 : 400,
              color: "var(--ink)",
            }}
          >
            {track.title}
          </div>
          <div
            className="muted"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 13,
            }}
          >
            {track.artist}
          </div>
        </div>
      </div>

      {/* Kolom ALBUM (disembunyikan saat area tengah sempit). */}
      {tampilAlbum && (
        <div
          role="cell"
          className="muted"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 13,
          }}
        >
          {track.album ?? "—"}
        </div>
      )}

      {/* Kolom DURASI: lebar tetap, rata kanan, tabular-nums. */}
      <div role="cell" className="mono muted" style={{ textAlign: "right", fontSize: 13 }}>
        {formatDuration(track.durationMs)}
      </div>

      {/* Aksi per baris: hanya tampil saat hover/fokus/menu terbuka (♡ dan ⋯). */}
      <div
        role="cell"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          opacity: tampilAksi ? 1 : 0,
          pointerEvents: tampilAksi ? "auto" : "none",
          transition: "opacity var(--t-fast) var(--ease)",
        }}
      >
        <button
          type="button"
          onClick={() => onFavorite(track)}
          aria-label={favorite ? T.hapusDariFavorit : T.favoritkan}
          aria-pressed={favorite}
          title={favorite ? T.hapusDariFavorit : T.favoritkan}
          style={{
            width: 44,
            height: 44,
            display: "grid",
            placeItems: "center",
          }}
        >
          {/* Kuning hanya sebagai latar + teks hitam agar kontras lolos di
              kedua tema (DESIGN-ENDFIELD bagian 3). */}
          <span
            aria-hidden="true"
            style={{
              width: 24,
              height: 24,
              display: "grid",
              placeItems: "center",
              background: favorite ? "var(--accent)" : "transparent",
              color: favorite ? "var(--accent-ink)" : "var(--ink-muted)",
              fontSize: 14,
            }}
          >
            <IkonHati size={15} isi={favorite} />
          </span>
        </button>

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuBuka((b) => !b)}
            aria-label={T.aksiLain}
            aria-haspopup="menu"
            aria-expanded={menuBuka}
            title={T.aksiLain}
            style={{
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              color: "var(--ink-muted)",
              fontSize: 16,
            }}
          >
            <IkonMenu size={16} />
          </button>

          {menuBuka && (
            <AksiMenu
              anchor={menuRef.current}
              onClose={() => setMenuBuka(false)}
              aksi={[
                {
                  label: T.tambahKeAntrean,
                  onClick: () => jalankan(() => onQueue(track)),
                },
                {
                  label: T.tambahKePlaylist,
                  onClick: () => jalankan(() => onAddToPlaylist(track)),
                },
                ...(onRemove
                  ? [
                      {
                        label: labelHapus ?? T.hapusDariPlaylist,
                        onClick: () => jalankan(() => onRemove(track)),
                        bahaya: true,
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
