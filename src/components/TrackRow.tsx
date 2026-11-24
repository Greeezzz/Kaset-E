import { useRef, useState } from "react";

import type { Track } from "../types";
import { CoverArt } from "./CoverArt";
import { formatDuration } from "../lib/format";
import { T } from "../lib/strings";
import { IkonMenu, IkonHati } from "./icons";
import { AksiMenu } from "./AksiMenu";
import { usePrefetchHover } from "../hooks/usePrefetchHover";

interface Props {
  track: Track;
  active?: boolean;
  onPlay?: (track: Track) => void;
  /** Antrekan lagu ini di akhir antrean. */
  onQueue?: (track: Track) => void;
  /** Path cover lokal, diisi setelah event cover://ready (Fase 1). */
  coverPath?: string | null;
  /** Indeks urut untuk label teknis mono (opsional). */
  index?: number;
  /** Toggle favorit. Ada = tombol hati ditampilkan. */
  onFavorite?: (track: Track) => void;
  /** Apakah lagu ini sudah difavoritkan. */
  favorite?: boolean;
  /** Buka dialog "tambahkan ke playlist". */
  onAddToPlaylist?: (track: Track) => void;
  /** Hapus dari playlist/antrean; muncul di menu kalau diberikan. */
  onRemove?: (track: Track) => void;
  /** Label aksi hapus, mis. "Hapus dari playlist". */
  labelHapus?: string;
}

/**
 * Satu baris lagu.
 *
 * Kenapa aksinya cuma dua (hati dan menu) dan bukan empat ikon permanen:
 * dengan tinggi baris ~40px, empat tombol membuat baris terlihat penuh dan
 * area sentuhnya di bawah 44px. Semua aksi sekunder dipindah ke menu titik
 * tiga — jalur yang juga satu-satunya bisa dipakai di layar sentuh nanti
 * (DESIGN-LAYOUT bagian 3.3).
 *
 * Ikon hanya muncul saat hover ATAU saat baris punya fokus keyboard. Tanpa
 * syarat fokus, pengguna keyboard tidak akan pernah bisa menjangkau menunya.
 */
export function TrackRow({
  track,
  active = false,
  onPlay,
  onQueue,
  coverPath,
  index,
  onFavorite,
  favorite = false,
  onAddToPlaylist,
  onRemove,
  labelHapus,
}: Props) {
  const [menuBuka, setMenuBuka] = useState(false);
  const [hover, setHover] = useState(false);
  const hoverPrefetch = usePrefetchHover();
  const [fokus, setFokus] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const adaMenu = Boolean(onQueue ?? onAddToPlaylist ?? onRemove);

  // Penutupan menu (klik luar, Escape, scroll) ditangani `AksiMenu` sendiri —
  // menduplikasinya di sini berarti dua listener bersaing menutup menu yang
  // sama.

  const tampilAksi = hover || fokus || menuBuka;

  /** Jalankan aksi menu lalu tutup. */
  const jalankan = (fn: () => void) => {
    setMenuBuka(false);
    fn();
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-2)",
        position: "relative",
        background: active ? "var(--panel-2)" : "transparent",
        // Penanda aktif = garis kuning di tepi kiri (DESIGN-ENDFIELD bagian 6),
        // bukan teks kuning (kontras gagal di tema terang).
        boxShadow: active ? "inset 3px 0 0 var(--accent)" : "none",
      }}
      onMouseEnter={() => {
        setHover(true);
        // Prefetch saat kursor berhenti di baris (debounce 400 ms). Tidak
        // dipasang di hasil pencarian sebagai daftar — lihat usePrefetchHover.
        hoverPrefetch.onHover(track.videoId);
      }}
      onMouseLeave={() => {
        setHover(false);
        hoverPrefetch.onKeluar();
      }}
      onFocus={() => setFokus(true)}
      onBlur={(e) => {
        // Fokus pindah ke elemen lain di luar baris ini = bukan fokus kita lagi.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFokus(false);
      }}
    >
      <button
        type="button"
        onClick={() => onPlay?.(track)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s-3)",
          flex: 1,
          minWidth: 0,
          padding: "var(--s-2)",
          textAlign: "left",
          color: "var(--ink)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        {index !== undefined && (
          <span
            className="label"
            style={{ width: 24, textAlign: "right", flex: "0 0 24px" }}
            aria-hidden="true"
          >
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <CoverArt coverKey={track.coverKey} title={track.title} localPath={coverPath} size={40} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: active ? 600 : 400,
            }}
          >
            {track.title}
          </span>
          <span
            className="muted"
            style={{
              display: "block",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {track.artist}
          </span>
        </span>
        <span className="muted mono" style={{ fontSize: 13 }}>
          {formatDuration(track.durationMs)}
        </span>
      </button>

      {/* Aksi: hanya saat hover/fokus/menu terbuka. */}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          flex: "0 0 auto",
          opacity: tampilAksi ? 1 : 0,
          // Tetap ada di layout supaya lebar kolom tidak melompat saat hover,
          // tapi tidak bisa diklik saat tak terlihat.
          pointerEvents: tampilAksi ? "auto" : "none",
          transition: "opacity 100ms ease",
        }}
      >
        {onFavorite && (
          <button
            type="button"
            onClick={() => onFavorite(track)}
            aria-label={favorite ? T.hapusDariFavorit : T.favoritkan}
            aria-pressed={favorite}
            title={favorite ? T.hapusDariFavorit : T.favoritkan}
            style={{
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              // Hati terisi = kuning penuh (kuning hanya untuk keadaan aktif).
              color: favorite ? "var(--accent)" : "var(--ink-muted)",
              fontSize: 15,
            }}
          >
            <IkonHati size={15} isi={favorite} />
          </button>
        )}

        {adaMenu && (
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuBuka((b) => !b)}
              aria-label={T.aksiLain}
              aria-haspopup="menu"
              aria-expanded={menuBuka}
              title={T.aksiLain}
              style={{
                width: 40,
                height: 40,
                display: "grid",
                placeItems: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
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
                  ...(onQueue
                    ? [
                        {
                          label: T.tambahKeAntrean,
                          onClick: () => jalankan(() => onQueue(track)),
                        },
                      ]
                    : []),
                  ...(onAddToPlaylist
                    ? [
                        {
                          label: T.tambahKePlaylist,
                          onClick: () => jalankan(() => onAddToPlaylist(track)),
                        },
                      ]
                    : []),
                  ...(onRemove
                    ? [
                        {
                          label: labelHapus ?? T.hapus,
                          onClick: () => jalankan(() => onRemove(track)),
                          bahaya: true,
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        )}
      </span>
    </div>
  );
}
