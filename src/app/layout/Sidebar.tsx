import { useRef, useState } from "react";
import type { Route } from "../routes";
import { T } from "../../lib/strings";
import { PlaylistArt } from "../../components/PlaylistArt";
import { IkonHati, IkonMenu, IkonCari, IkonPengaturan, IkonTambah } from "../../components/icons";
import { AksiMenu } from "../../components/AksiMenu";
import type { Playlist } from "../../hooks/useLibrary";
import type { Track } from "../../types";

const NAV: { id: Route; label: string; ikon: React.ReactNode }[] = [
  // Satu bahasa untuk semua label UI (DESIGN-LAYOUT bagian 7).
  { id: "search", label: T.navCari, ikon: <IkonCari size={18} /> },
  { id: "settings", label: T.navPengaturan, ikon: <IkonPengaturan size={18} /> },
];

interface Props {
  route: Route;
  onNavigate: (r: Route) => void;
  playlists: Playlist[];
  favorites: Track[];
  selectedPlaylistId: number | null;
  /** ID playlist yang sedang aktif diputar (untuk equalizer bar-segmen). */
  playingPlaylistId?: number | null;
  onSelectPlaylist: (id: number) => void;
  onSelectFavorites: () => void;
  onCreatePlaylist: (name: string) => Promise<void>;
  /** Buka dialog impor playlist dari berkas. */
  onImportPlaylist: () => void;
  /** Buka dialog Nama & Detail untuk playlist ini. */
  onEditPlaylist: (id: number) => void;
  onRenamePlaylist: (id: number, name: string) => Promise<void>;
  onDeletePlaylist: (id: number) => Promise<void>;
  /**
   * Rel ikon sempit (600–899px, DESIGN-LAYOUT §8): hanya cover + ikon, tanpa
   * judul dan metadata. Label tetap ada di `aria-label`/`title` supaya
   * pembaca layar dan tooltip tidak kehilangan konteks.
   */
  rel?: boolean;
}

/**
 * Sidebar kiri: navigasi + daftar library.
 *
 * Scroll-nya sendiri (DESIGN-LAYOUT bagian 1): kepala dan navigasi tetap di
 * tempat, hanya daftar library yang bergulir. Kalau seluruh sidebar ikut
 * scroll, tombol navigasi bisa hilang ke atas saat playlist banyak.
 *
 * "LAGU DISUKAI" selalu paling atas dan tidak bisa diganti nama atau dihapus —
 * itu bukan playlist, itu tampilan lain dari tabel favorites.
 */
export function Sidebar({
  route,
  onNavigate,
  playlists,
  favorites,
  selectedPlaylistId,
  playingPlaylistId = null,
  onSelectPlaylist,
  onSelectFavorites,
  onCreatePlaylist,
  onImportPlaylist,
  onRenamePlaylist,
  onEditPlaylist,
  onDeletePlaylist,
  rel = false,
}: Props) {
  const diLibrary = route === "library";

  const [buatBuka, setBuatBuka] = useState(false);
  const [namaBaru, setNamaBaru] = useState("");
  const [sibukBuat, setSibukBuat] = useState(false);

  const [menuId, setMenuId] = useState<number | null>(null);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");

  async function kirimBuat(e: React.FormEvent) {
    e.preventDefault();
    const bersih = namaBaru.trim();
    if (!bersih || sibukBuat) return;
    setSibukBuat(true);
    try {
      await onCreatePlaylist(bersih);
      setNamaBaru("");
      setBuatBuka(false);
    } finally {
      setSibukBuat(false);
    }
  }

  async function simpanRename(id: number) {
    const bersih = renameVal.trim();
    setRenameId(null);
    setRenameVal("");
    if (!bersih) return;
    await onRenamePlaylist(id, bersih);
  }

  const favoritAktif = diLibrary && selectedPlaylistId === null;

  return (
    <nav
      aria-label="Navigasi utama"
      style={{
        borderRight: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Kepala panel: nomor + judul, mono caps (gaya sistem Endfield). */}
      <div
        style={{
          padding: "var(--s-4) var(--s-4) var(--s-2)",
          display: "flex",
          alignItems: "baseline",
          gap: "var(--s-2)",
          flex: "0 0 auto",
        }}
      >
        {rel ? (
          // Rel ikon: nomor bab saja, judul tidak muat dan akan terpotong.
          <span
            className="mono muted"
            style={{ fontSize: 11, letterSpacing: "0.14em", margin: "0 auto" }}
            aria-hidden="true"
          >
            01
          </span>
        ) : (
          <>
            <span
              className="mono muted"
              style={{ fontSize: 11, letterSpacing: "0.14em" }}
              aria-hidden="true"
            >
              01 /
            </span>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: "0.04em",
                flex: 1,
              }}
            >
              {T.navLibrary}
            </span>
            <span className="mono muted" style={{ fontSize: 11 }} aria-hidden="true">
              {playlists.length}
            </span>
          </>
        )}
      </div>

      <div
        style={{
          padding: "0 var(--s-3) var(--s-2)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: "0 0 auto",
        }}
      >
        {NAV.map((it) => {
          const aktif = route === it.id;
          return (
            <button
              key={it.id}
              type="button"
              aria-current={aktif ? "page" : undefined}
              onClick={() => onNavigate(it.id)}
              aria-label={it.label}
              title={rel ? it.label : undefined}
              style={{
                padding: rel ? 0 : "10px var(--s-3)",
                minHeight: 44,
                minWidth: 44,
                display: rel ? "grid" : "block",
                placeItems: rel ? "center" : undefined,
                textAlign: "left",
                background: aktif ? "var(--accent)" : "transparent",
                color: aktif ? "var(--accent-ink)" : "var(--ink)",
                border: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: aktif ? 600 : 400,
              }}
            >
              {rel ? it.ikon : it.label}
            </button>
          );
        })}

        {/* Tombol buat playlist: outline, bukan kuning — kuning hanya untuk
            keadaan aktif, supaya tidak ada dua ajakan yang bersaing. */}
        <button
          type="button"
          onClick={() => {
            // Di rel ikon, form inline selebar 72px tidak terbaca. Langsung
            // buat playlist lalu buka dialog Nama & Detail yang punya ruang.
            if (rel) {
              void onCreatePlaylist("Playlist baru");
              return;
            }
            setBuatBuka((b) => !b);
            setNamaBaru("");
          }}
          aria-expanded={buatBuka}
          aria-label={T.baruPlaylist}
          title={rel ? T.baruPlaylist : undefined}
          style={{
            marginTop: "var(--s-2)",
            padding: rel ? 0 : "10px var(--s-3)",
            minHeight: 44,
            minWidth: 44,
            display: rel ? "grid" : "block",
            placeItems: rel ? "center" : undefined,
            textAlign: "left",
            background: "transparent",
            color: "var(--ink)",
            border: "1px solid var(--line-strong)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.1em",
            cursor: "pointer",
          }}
        >
          {rel ? <IkonTambah size={18} /> : T.baru}
        </button>

        <button
          type="button"
          onClick={onImportPlaylist}
          aria-label={T.imporPlaylistBaru}
          title={rel ? T.imporPlaylistBaru : undefined}
          style={{
            padding: rel ? 0 : "10px var(--s-3)",
            minHeight: 44,
            minWidth: 44,
            display: rel ? "grid" : "block",
            placeItems: rel ? "center" : undefined,
            textAlign: "left",
            background: "transparent",
            color: "var(--ink-muted)",
            border: "1px solid var(--line)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.1em",
            cursor: "pointer",
          }}
        >
          {rel ? <IkonTambah size={18} /> : T.imporPlaylistBaru}
        </button>

        {buatBuka && !rel && (
          <form
            onSubmit={(e) => void kirimBuat(e)}
            style={{
              marginTop: "var(--s-2)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--s-1)",
              padding: "var(--s-2)",
              background: "var(--bg)",
              border: "1px solid var(--line)",
            }}
          >
            <input
              autoFocus
              type="text"
              value={namaBaru}
              maxLength={80}
              onChange={(e) => setNamaBaru(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setBuatBuka(false);
                  setNamaBaru("");
                }
              }}
              placeholder={T.namaPlaylistBaru}
              aria-label={T.namaPlaylistBaru}
              style={{
                width: "100%",
                minHeight: 36,
                padding: "0 var(--s-2)",
                background: "var(--panel)",
                border: "1px solid var(--line-strong)",
                color: "var(--ink)",
                fontSize: 13,
              }}
            />
            <div style={{ display: "flex", gap: "var(--s-1)" }}>
              <button
                type="submit"
                disabled={sibukBuat || !namaBaru.trim()}
                style={{
                  flex: 1,
                  minHeight: 34,
                  background: namaBaru.trim() ? "var(--accent)" : "transparent",
                  color: namaBaru.trim() ? "var(--accent-ink)" : "var(--ink-muted)",
                  border: "1px solid var(--line)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                }}
              >
                {T.simpan}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBuatBuka(false);
                  setNamaBaru("");
                }}
                style={{
                  minHeight: 34,
                  padding: "0 var(--s-2)",
                  color: "var(--ink-muted)",
                  border: "1px solid var(--line)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                }}
              >
                {T.batal}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Daftar library — satu-satunya bagian sidebar yang bergulir. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          borderTop: "1px solid var(--line)",
          padding: "var(--s-2)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {/* LAGU DISUKAI: dipin di atas, cover khusus (hati), tidak bisa dihapus. */}
        <BarisLibrary
          rel={rel}
          aktif={favoritAktif}
          judul={T.laguDisukai}
          meta={`${favorites.length} ${T.lagu}`}
          onClick={onSelectFavorites}
          cover={
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                flex: "0 0 44px",
                display: "grid",
                placeItems: "center",
                // Saat baris aktif (berlatar kuning), balik kotak hati jadi
                // hitam-kuning agar kotak cover tidak tenggelam ke latar baris.
                background: favoritAktif ? "var(--accent-ink)" : "var(--accent)",
                color: favoritAktif ? "var(--accent)" : "var(--accent-ink)",
                fontSize: 18,
              }}
            >
              <IkonHati size={20} isi />
            </div>
          }
        />

        {playlists.length === 0 ? (
          <p className="muted" style={{ fontSize: 12, padding: "var(--s-2)", margin: 0 }}>
            {T.belumAdaPlaylistSidebar}
          </p>
        ) : (
          playlists.map((p) =>
            renameId === p.id ? (
              <form
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void simpanRename(p.id);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--s-1)",
                  padding: "6px 8px",
                  minHeight: 56,
                  background: "var(--bg)",
                  border: "1px solid var(--line-strong)",
                }}
              >
                <input
                  autoFocus
                  type="text"
                  value={renameVal}
                  maxLength={80}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setRenameId(null);
                      setRenameVal("");
                    }
                  }}
                  aria-label={T.namaBaruUntuk(p.name)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 34,
                    padding: "0 var(--s-2)",
                    background: "var(--panel)",
                    border: "1px solid var(--line)",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                />
                <button
                  type="submit"
                  disabled={!renameVal.trim()}
                  style={{
                    minHeight: 34,
                    padding: "0 var(--s-2)",
                    background: renameVal.trim() ? "var(--accent)" : "transparent",
                    color: renameVal.trim() ? "var(--accent-ink)" : "var(--ink-muted)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    letterSpacing: "0.08em",
                  }}
                >
                  {T.simpan}
                </button>
              </form>
            ) : (
              <BarisLibrary
                key={p.id}
                rel={rel}
                aktif={diLibrary && selectedPlaylistId === p.id}
                sedangDiputar={playingPlaylistId === p.id}
                judul={p.name}
                meta={`${T.playlist} · ${p.trackCount} ${T.lagu}`}
                onClick={() => onSelectPlaylist(p.id)}
                cover={<PlaylistArt playlist={p} size={44} />}
                menuBuka={menuId === p.id}
                onToggleMenu={(buka) => setMenuId(buka ? p.id : null)}
                onRename={() => {
                  setMenuId(null);
                  setRenameId(p.id);
                  setRenameVal(p.name);
                }}
                onEdit={() => {
                  setMenuId(null);
                  onEditPlaylist(p.id);
                }}
                onDelete={() => {
                  setMenuId(null);
                  if (confirm(T.konfirmasiHapusPlaylist(p.name))) {
                    void onDeletePlaylist(p.id);
                  }
                }}
              />
            ),
          )
        )}
      </div>
    </nav>
  );
}

/** Satu baris library: cover + nama + metadata mono kecil + menu opsional. */
function BarisLibrary({
  cover,
  judul,
  meta,
  aktif,
  rel = false,
  sedangDiputar = false,
  onClick,
  menuBuka = false,
  onToggleMenu,
  onRename,
  onEdit,
  onDelete,
}: {
  cover: React.ReactNode;
  judul: string;
  meta: string;
  aktif: boolean;
  sedangDiputar?: boolean;
  onClick: () => void;
  /** Rel ikon: cover saja tanpa judul/metadata (DESIGN-LAYOUT §8). */
  rel?: boolean;
  menuBuka?: boolean;
  onToggleMenu?: (buka: boolean) => void;
  onRename?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [fokus, setFokus] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const adaMenu = Boolean(onToggleMenu && (onRename || onDelete));

  const tampilMenuBtn = adaMenu && (hover || fokus || menuBuka);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        width: "100%",
        background: aktif ? "var(--accent)" : hover ? "var(--panel-2)" : "transparent",
        color: aktif ? "var(--accent-ink)" : "var(--ink)",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFokus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFokus(false);
      }}
      onContextMenu={(e) => {
        if (!adaMenu || !onToggleMenu) return;
        e.preventDefault();
        onToggleMenu(true);
      }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={aktif ? "page" : undefined}
        aria-label={rel ? judul : undefined}
        title={rel ? judul : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: rel ? "center" : undefined,
          gap: rel ? 0 : "var(--s-2)",
          padding: rel ? 4 : "6px 8px",
          minHeight: 56,
          minWidth: 0,
          flex: 1,
          textAlign: "left",
          background: "transparent",
          color: "inherit",
          border: "none",
          cursor: "pointer",
        }}
      >
        {cover}
        <span style={{ minWidth: 0, flex: 1, display: rel ? "none" : undefined }}>
          <span
            style={{
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 14,
              fontWeight: aktif ? 600 : 400,
            }}
          >
            {judul}
          </span>
          <span
            className="mono"
            style={{
              display: "block",
              fontSize: 10,
              letterSpacing: "0.06em",
              // Metadata ikut berubah warna saat aktif supaya tetap terbaca
              // di atas blok kuning.
              color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
              opacity: aktif ? 0.75 : 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {meta.toUpperCase()}
          </span>
        </span>
        {sedangDiputar && (
          <span className="eq-bars" aria-label={T.sedangDiputar}>
            <span />
            <span />
            <span />
          </span>
        )}
      </button>

      {adaMenu && onToggleMenu && (
        <div ref={menuRef} style={{ position: "relative", flex: "0 0 auto" }}>
          <button
            type="button"
            onClick={() => onToggleMenu(!menuBuka)}
            aria-label={T.menuPlaylist(judul)}
            aria-haspopup="menu"
            aria-expanded={menuBuka}
            title={T.aksiLain}
            style={{
              width: 44,
              height: 44,
              display: "grid",
              placeItems: "center",
              background: "transparent",
              border: "none",
              color: aktif ? "var(--accent-ink)" : "var(--ink-muted)",
              fontSize: 16,
              opacity: tampilMenuBtn ? 1 : 0,
              pointerEvents: tampilMenuBtn ? "auto" : "none",
              transition: "opacity var(--t-fast) var(--ease)",
            }}
          >
            <IkonMenu size={18} />
          </button>

          {menuBuka && (
            <AksiMenu
              anchor={menuRef.current?.querySelector("button") ?? null}
              onClose={() => onToggleMenu?.(false)}
              aksi={[
                ...(onEdit ? [{ label: T.detailCover, onClick: onEdit }] : []),
                ...(onRename ? [{ label: T.gantiNama, onClick: onRename }] : []),
                ...(onDelete ? [{ label: T.hapus, onClick: onDelete, bahaya: true }] : []),
              ]}
            />
          )}
        </div>
      )}
    </div>
  );
}
