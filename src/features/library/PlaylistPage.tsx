import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Playlist } from "../../hooks/useLibrary";
import type { Track } from "../../types";
import { PlaylistArt } from "../../components/PlaylistArt";
import { IkonPlay, IkonPause, IkonHati, IkonMenu } from "../../components/icons";
import { AksiMenu } from "../../components/AksiMenu";
import { EmptyState } from "../../components/EmptyState";
import { streamCache } from "../../lib/streamCache";
import { PlaylistTable } from "./PlaylistTable";
import { formatTotalDuration } from "../../lib/format";
import { buatIndeks, pecahKueri, saring } from "../../lib/cari";
import { T } from "../../lib/strings";

type SortKey = "asli" | "judul" | "artis" | "durasi";

const SORT_OPS: { key: SortKey; label: string }[] = [
  { key: "asli", label: T.urutAsli },
  { key: "judul", label: T.urutJudul },
  { key: "artis", label: T.urutArtis },
  { key: "durasi", label: T.urutDurasi },
];

interface Props {
  /** `null` = Lagu Disukai (koleksi dipin). */
  playlist: Playlist | null;
  tracks: Track[];
  loading?: boolean;
  scrollContainerRef: RefObject<HTMLElement | null>;
  activeVideoId?: string | null;
  isPlaying?: boolean;
  /** True bila playlist/koleksi ini adalah sumber pemutaran aktif. */
  isSourcePlaying?: boolean;
  shuffle: boolean;
  favoriteIds: Set<string>;
  onToggleShuffle: () => void;
  onTogglePlay: () => void;
  /** Ganti antrean dengan daftar lagu (dalam urutan tampil) mulai dari `index`. */
  onPlayTracks: (tracks: Track[], startIndex: number) => void;
  onQueue: (track: Track) => void;
  onFavorite: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
  onRenamePlaylist?: (id: number, name: string) => Promise<void>;
  onDeletePlaylist?: (id: number) => Promise<void>;
  onGoSearch: () => void;
  /** Pintasan membuka daftar riwayat putar (hanya ditampilkan di Lagu Disukai). */
  onOpenHistory?: () => void;
}

/**
 * Halaman tengah Playlist / Lagu Disukai (DESIGN-LAYOUT bagian 3).
 *
 * Header (cover 200px + corner brackets, judul besar display, metadata mono),
 * baris aksi (play kuning chamfer, ACAK, menu ⋯, sort), lalu tabel lagu
 * bervirtualisasi.
 */
export function PlaylistPage({
  playlist,
  tracks,
  loading = false,
  scrollContainerRef,
  activeVideoId = null,
  isPlaying = false,
  isSourcePlaying = false,
  shuffle,
  favoriteIds,
  onToggleShuffle,
  onTogglePlay,
  onPlayTracks,
  onQueue,
  onFavorite,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onRenamePlaylist,
  onDeletePlaylist,
  onGoSearch,
  onOpenHistory,
}: Props) {
  // Pilihan urutan DISIMPAN per playlist (localStorage), bukan hanya state
  // lokal. Sebelumnya `setSort("asli")` dipanggil setiap kali playlistId
  // berubah, sehingga membuka ulang playlist selalu mengembalikan urutannya ke
  // awal — pilihan pengguna hilang tanpa penjelasan.
  const [sort, setSort] = useState<SortKey>(() => bacaSort(playlist?.id ?? null));
  const [menuBuka, setMenuBuka] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [kueri, setKueri] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cariRef = useRef<HTMLInputElement | null>(null);

  // Reset mode edit/menu saat berpindah playlist — TAPI bukan pilihan urutan.
  // Urutan dimuat ulang dari preferensi tersimpan playlist tujuan.
  const playlistId = playlist?.id ?? null;
  useEffect(() => {
    setMenuBuka(false);
    setRenaming(false);
    setRenameVal("");
    setKueri("");
    setSort(bacaSort(playlistId));
  }, [playlistId]);

  // Pintasan `/` memfokuskan kotak cari, kecuali saat pengguna sedang mengetik
  // di kolom lain. Dipilih `/` karena `Ctrl+F` sudah dipakai pencarian bawaan
  // webview dan tidak bisa diambil alih tanpa mengganggu.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      cariRef.current?.focus();
      cariRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Prefetch lagu PERTAMA saat halaman playlist dibuka.
  //
  // Itu lagu yang paling mungkin diputar berikutnya (pengguna membuka playlist
  // biasanya untuk memutarnya), jadi resolve-nya layak dikerjakan lebih awal.
  // Hanya satu lagu: bukan seluruh playlist, karena itu akan membanjiri
  // throttle resolver untuk lagu yang belum tentu dipilih.
  //
  // Memakai `tracks[0]`: lagu pertama dalam urutan asli playlist, yang juga
  // yang tampil paling atas saat urutan belum diubah.
  const videoPertama = tracks[0]?.videoId ?? null;
  useEffect(() => {
    if (!videoPertama) return;
    // Jeda kecil supaya pembukaan halaman (render + cover) tidak berebut
    // dengan resolve.
    const t = setTimeout(() => streamCache.prefetch(videoPertama), 600);
    return () => clearTimeout(t);
  }, [playlistId, videoPertama]);

  // Simpan pilihan urutan setiap kali berubah.
  useEffect(() => {
    if (playlistId !== null) simpanSort(playlistId, sort);
  }, [playlistId, sort]);

  const sortedTracks = useMemo(() => {
    if (sort === "asli") return tracks;
    const copy = [...tracks];
    if (sort === "judul") {
      copy.sort((a, b) => a.title.localeCompare(b.title, "id", { sensitivity: "base" }));
    } else if (sort === "artis") {
      copy.sort((a, b) => a.artist.localeCompare(b.artist, "id", { sensitivity: "base" }));
    } else if (sort === "durasi") {
      copy.sort((a, b) => (a.durationMs ?? 0) - (b.durationMs ?? 0));
    }
    return copy;
  }, [tracks, sort]);

  // Filter pencarian. `useDeferredValue` menahan render tabel yang berat
  // selama pengguna masih mengetik: kotak cari tetap responsif, daftar menyusul
  // satu frame kemudian. Efeknya sama dengan debounce tanpa timer tambahan.
  const kueriTertunda = useDeferredValue(kueri);
  const kataCari = useMemo(() => pecahKueri(kueriTertunda), [kueriTertunda]);
  const indeksCari = useMemo(
    () => buatIndeks(sortedTracks, (t) => [t.title, t.artist, t.album]),
    [sortedTracks],
  );
  const tampil = useMemo(
    () => (kataCari.length === 0 ? sortedTracks : saring(indeksCari, kataCari)),
    [kataCari, indeksCari, sortedTracks],
  );

  const totalDurasi = useMemo(() => formatTotalDuration(tracks), [tracks]);
  const judul = playlist ? playlist.name : T.laguDisukai;
  const labelJenis = playlist ? T.playlist : T.koleksiDipin;
  const kosong = tracks.length === 0;
  const adaKueri = kataCari.length > 0;
  const filterKosong = adaKueri && tampil.length === 0;
  const bisaPutar = tampil.length > 0;

  async function simpanRename(e: React.FormEvent) {
    e.preventDefault();
    if (!playlist || !onRenamePlaylist) return;
    const bersih = renameVal.trim();
    setRenaming(false);
    if (!bersih || bersih === playlist.name) return;
    await onRenamePlaylist(playlist.id, bersih);
  }

  function mulaiRename() {
    if (!playlist || !onRenamePlaylist) return;
    setMenuBuka(false);
    setRenameVal(playlist.name);
    setRenaming(true);
  }

  function klikPutarUtama() {
    if (tampil.length === 0) return;
    // Saat filter aktif, yang diputar adalah hasil filter — sama dengan yang
    // terlihat di tabel. Memutar seluruh playlist sementara layar hanya
    // menampilkan 3 lagu akan membuat antrean terasa tidak nyambung.
    if (isSourcePlaying && !adaKueri) {
      onTogglePlay();
    } else {
      onPlayTracks(tampil, 0);
    }
  }

  return (
    <section style={{ padding: "var(--s-6) var(--s-6) var(--s-12)", minWidth: 0 }}>
      {/* 3.1 Header: cover besar 200px (corner brackets) + info kanan. */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "var(--s-6)",
          flexWrap: "wrap",
          paddingBottom: "var(--s-6)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          className="bracketed"
          style={{
            padding: 6,
            flex: "0 0 auto",
            background: "var(--panel)",
            border: "1px solid var(--line)",
          }}
        >
          {playlist ? (
            <PlaylistArt playlist={playlist} size={188} />
          ) : (
            <div
              aria-hidden="true"
              style={{
                width: 188,
                height: 188,
                display: "grid",
                placeItems: "center",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontSize: 72,
              }}
            >
              <IkonHati size={40} isi />
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)" }}>
            <span className="label">{labelJenis}</span>
            <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
          </div>

          {renaming && playlist ? (
            <form
              onSubmit={(e) => void simpanRename(e)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--s-2)",
                marginTop: "var(--s-2)",
                flexWrap: "wrap",
              }}
            >
              <input
                autoFocus
                type="text"
                value={renameVal}
                maxLength={80}
                onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setRenaming(false);
                }}
                aria-label={T.namaBaruUntuk(playlist.name)}
                style={{
                  flex: "1 1 240px",
                  minHeight: 44,
                  padding: "0 var(--s-3)",
                  background: "var(--panel)",
                  border: "1px solid var(--line-strong)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-display)",
                  fontSize: 28,
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              />
              <button
                type="submit"
                disabled={!renameVal.trim()}
                style={{
                  minHeight: 44,
                  padding: "0 var(--s-4)",
                  background: renameVal.trim() ? "var(--accent)" : "transparent",
                  color: renameVal.trim() ? "var(--accent-ink)" : "var(--ink-muted)",
                  border: "1px solid var(--line-strong)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                }}
              >
                {T.simpan}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(false)}
                style={{
                  minHeight: 44,
                  padding: "0 var(--s-3)",
                  color: "var(--ink-muted)",
                  border: "1px solid var(--line)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                }}
              >
                {T.batal}
              </button>
            </form>
          ) : playlist && onRenamePlaylist ? (
            <button
              type="button"
              onClick={mulaiRename}
              title={T.gantiNama}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 0,
                marginTop: "var(--s-2)",
              }}
            >
              <h1
                style={{
                  fontSize: "clamp(36px, 5vw, 64px)",
                  lineHeight: 1.02,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                }}
              >
                {judul}
              </h1>
            </button>
          ) : (
            <h1
              style={{
                marginTop: "var(--s-2)",
                fontSize: "clamp(36px, 5vw, 64px)",
                lineHeight: 1.02,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                wordBreak: "break-word",
              }}
            >
              {judul}
            </h1>
          )}

          {playlist?.description && (
            <p
              style={{
                margin: "var(--s-2) 0 0",
                fontSize: 13,
                color: "var(--ink-muted)",
                maxWidth: "62ch",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {playlist.description}
            </p>
          )}

          <p className="mono muted" style={{ margin: "var(--s-3) 0 0", fontSize: 12 }}>
            {adaKueri ? T.hasilCari(tampil.length, tracks.length) : `${tracks.length} ${T.lagu}`}
            {totalDurasi ? ` · ${totalDurasi}` : ""}
          </p>
        </div>
      </header>

      {/* 3.2 Baris aksi: play besar kuning chamfer, ACAK, menu ⋯, sort di kanan. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-3)",
          flexWrap: "wrap",
          padding: "var(--s-4) 0",
        }}
      >
        {/* Tombol play utama: blok kuning persegi chamfer, elemen paling mencolok. */}
        <button
          type="button"
          onClick={klikPutarUtama}
          disabled={!bisaPutar}
          aria-label={isSourcePlaying && isPlaying && !adaKueri ? T.jeda : T.putar}
          style={{
            width: 52,
            height: 52,
            display: "grid",
            placeItems: "center",
            background: bisaPutar ? "var(--accent)" : "transparent",
            color: bisaPutar ? "var(--accent-ink)" : "var(--ink-muted)",
            border: bisaPutar ? "none" : "1px solid var(--line)",
            clipPath: bisaPutar
              ? "polygon(var(--cut-sm) 0, 100% 0, 100% calc(100% - var(--cut-sm)), calc(100% - var(--cut-sm)) 100%, 0 100%, 0 var(--cut-sm))"
              : undefined,
            fontSize: 18,
            fontWeight: 700,
            cursor: bisaPutar ? "pointer" : "not-allowed",
          }}
        >
          {isSourcePlaying && isPlaying ? <IkonPause size={22} /> : <IkonPlay size={22} />}
        </button>

        <button
          type="button"
          onClick={onToggleShuffle}
          aria-pressed={shuffle}
          style={{
            minHeight: 44,
            padding: "0 var(--s-4)",
            border: shuffle ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
            background: shuffle ? "var(--accent)" : "transparent",
            color: shuffle ? "var(--accent-ink)" : "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.1em",
            fontWeight: shuffle ? 600 : 400,
          }}
        >
          {T.acak}
        </button>

        {playlist && (onRenamePlaylist || onDeletePlaylist) && (
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuBuka((b) => !b)}
              aria-label={T.menuPlaylist(playlist.name)}
              aria-haspopup="menu"
              aria-expanded={menuBuka}
              style={{
                width: 44,
                height: 44,
                display: "grid",
                placeItems: "center",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                fontSize: 18,
              }}
            >
              <IkonMenu size={16} />
            </button>

            {menuBuka && (
              <AksiMenu
                anchor={menuRef.current}
                onClose={() => setMenuBuka(false)}
                aksi={[
                  ...(onRenamePlaylist ? [{ label: T.gantiNama, onClick: mulaiRename }] : []),
                  ...(onDeletePlaylist
                    ? [
                        {
                          label: T.hapusPlaylist,
                          bahaya: true,
                          onClick: () => {
                            if (confirm(T.konfirmasiHapusPlaylist(playlist.name))) {
                              void onDeletePlaylist(playlist.id);
                            }
                          },
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        )}

        {!playlist && onOpenHistory && (
          <button
            type="button"
            onClick={onOpenHistory}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              border: "1px solid var(--line)",
              color: "var(--ink-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
            }}
          >
            {T.riwayatPutar}
          </button>
        )}

        <span style={{ flex: 1 }} />

        {/* Kotak cari di dalam playlist. Ditempatkan di baris aksi, bukan
            baris baru, supaya tabel tidak bergeser jauh saat halaman dibuka. */}
        <div
          role="search"
          style={{
            position: "relative",
            flex: "1 1 220px",
            minWidth: 180,
            maxWidth: 320,
          }}
        >
          <input
            ref={cariRef}
            // `type="text"`, bukan `search`: Ctrl+K global mencari
            // `input[type="search"]` pertama, dan kotak ini tidak boleh
            // merebut pintasan itu saat halaman playlist terbuka.
            type="text"
            className="k-input"
            value={kueri}
            onChange={(e) => setKueri(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setKueri("");
                e.currentTarget.blur();
              }
            }}
            placeholder={T.cariDiPlaylistPlaceholder}
            aria-label={T.cariDiPlaylist}
            title={T.cariDiPlaylistPintasan}
            autoComplete="off"
            spellCheck={false}
            style={{ paddingRight: kueri ? 40 : undefined }}
          />
          {kueri && (
            <button
              type="button"
              onClick={() => {
                setKueri("");
                cariRef.current?.focus();
              }}
              aria-label={T.hapusFilter}
              title={T.hapusFilter}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                width: 40,
                height: "100%",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-muted)",
                fontSize: 16,
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Pengumuman hasil untuk pembaca layar; tidak terlihat di layar
            karena jumlahnya sudah tampil di bawah judul. */}
        <span
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)",
            whiteSpace: "nowrap",
          }}
        >
          {adaKueri ? T.hasilCari(tampil.length, tracks.length) : ""}
        </span>

        {/* Filter/sort kecil di kanan (DESIGN-LAYOUT §3.2). */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: "var(--s-2)" }}>
          <span className="label">{T.urutkan}</span>
          <select
            aria-label={T.urutkan}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              background: "var(--panel)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              cursor: "pointer",
            }}
          >
            {SORT_OPS.map((op) => (
              <option key={op.key} value={op.key}>
                {op.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 3.3 Tabel lagu / 3.4 Empty state. */}
      {loading ? (
        <p className="label" style={{ padding: "var(--s-6) 0" }}>
          {T.memuat}
        </p>
      ) : kosong ? (
        <EmptyState
          title={T.noDataStandby}
          hint={playlist ? T.playlistKosongHint : T.favoritKosongHint}
          action={
            <button
              type="button"
              onClick={onGoSearch}
              style={{
                marginTop: "var(--s-2)",
                minHeight: 44,
                padding: "0 var(--s-4)",
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
              }}
            >
              {T.cariLagu}
            </button>
          }
        />
      ) : filterKosong ? (
        <EmptyState
          title={T.tidakAdaHasil}
          hint={T.tidakAdaHasilCari(kueriTertunda.trim())}
          action={
            <button
              type="button"
              onClick={() => {
                setKueri("");
                cariRef.current?.focus();
              }}
              style={{
                marginTop: "var(--s-2)",
                minHeight: 44,
                padding: "0 var(--s-4)",
                border: "1px solid var(--line-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
              }}
            >
              {T.hapusFilterCaps}
            </button>
          }
        />
      ) : (
        <PlaylistTable
          tracks={tampil}
          scrollContainerRef={scrollContainerRef}
          activeVideoId={activeVideoId}
          isPlaying={isPlaying}
          favoriteIds={favoriteIds}
          // Indeks yang dikirim adalah posisi di daftar yang TERLIHAT, jadi
          // antrean yang terbentuk persis sama dengan isi tabel saat itu.
          onPlayFromIndex={(idx) => onPlayTracks(tampil, idx)}
          onTogglePlay={onTogglePlay}
          onQueue={onQueue}
          onFavorite={onFavorite}
          onAddToPlaylist={onAddToPlaylist}
          onRemove={onRemoveFromPlaylist}
          labelHapus={T.hapusDariPlaylist}
        />
      )}
    </section>
  );
}

/**
 * Preferensi urutan per playlist.
 *
 * Disimpan di `localStorage`, bukan database: ini preferensi tampilan, bukan
 * data yang perlu disinkronkan atau dicadangkan. Kalau nanti Fase 6 (sync)
 * dikerjakan, pindahkan ke tabel `settings` dengan kunci per playlist.
 */
const KUNCI_SORT = "kaset.sort.playlist.";

function bacaSort(id: number | null): SortKey {
  if (id === null) return "asli";
  try {
    const v = localStorage.getItem(KUNCI_SORT + id);
    if (v === "judul" || v === "artis" || v === "durasi" || v === "asli") return v;
  } catch {
    // localStorage bisa gagal di mode privasi; jatuh ke urutan asli.
  }
  return "asli";
}

function simpanSort(id: number, sort: SortKey) {
  try {
    localStorage.setItem(KUNCI_SORT + id, sort);
  } catch {
    // Gagal simpan bukan alasan menggagalkan render.
  }
}
