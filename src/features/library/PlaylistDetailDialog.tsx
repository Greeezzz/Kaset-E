import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "../../lib/tauri";
import { PlaylistArt } from "../../components/PlaylistArt";
import { CoverArt } from "../../components/CoverArt";
import { IkonTutup } from "../../components/icons";
import type { Playlist } from "../../hooks/useLibrary";

type ModeCover = "auto" | "custom" | "generative";

interface Props {
  playlist: Playlist;
  onClose: () => void;
  /** Dipanggil setelah tersimpan, supaya daftar di sidebar ikut segar. */
  onSaved: () => void;
  /** true = playlist baru, jadi judulnya "PLAYLIST BARU". */
  baru?: boolean;
}

/**
 * Dialog Nama & Detail (DESIGN-LAYOUT §5).
 *
 * Tiga mode cover:
 *  - OTOMATIS: mosaik 4 cover lagu pertama (dihitung dari data lagu).
 *  - UPLOAD:   gambar dipilih dari disk, dikirim sebagai byte mentah ke Rust,
 *              lalu Rust yang memvalidasi/meng-crop/menyimpan. Webview tidak
 *              pernah menulis file gambar sendiri.
 *  - GENERATIF: placeholder deterministik dari judul (CoverArt FNV-1a).
 *
 * Validasi panjang ditampilkan sebagai penghitung karakter, bukan pesan error
 * setelah ditekan simpan: batas 80/200 sudah diketahui dari dokumen, jadi
 * memberi tahu lebih awal lebih berguna daripada menolak di akhir.
 */
export function PlaylistDetailDialog({ playlist, onClose, onSaved, baru }: Props) {
  const [nama, setNama] = useState(playlist.name);
  const [deskripsi, setDeskripsi] = useState(playlist.description ?? "");
  const [mode, setMode] = useState<ModeCover>(playlist.coverMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Path absolut cover kustom dari Rust (bukan disusun di UI).
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const p = await invoke<string | null>("playlist_cover_path", { id: playlist.id });
        if (!batal && p) setCoverUrl(convertFileSrc(p) + `?v=${previewKey}`);
      } catch {
        // Cover tidak ada bukan error yang perlu ditampilkan.
      }
    })();
    return () => {
      batal = true;
    };
  }, [playlist.id, previewKey]);

  async function pilihBerkas(file: File) {
    setError(null);
    setBusy(true);
    try {
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await invoke("playlist_cover_set", { id: playlist.id, bytes });
      setMode("custom");
      // Naikkan kunci preview supaya URL berubah — file baru punya nama unik,
      // tapi ini juga menangani kasus nama sama.
      setPreviewKey((n) => n + 1);
    } catch (e) {
      setError(pesanError(e, "Gambar gagal diproses. Coba file lain."));
    } finally {
      setBusy(false);
    }
  }

  async function hapusCover() {
    setBusy(true);
    setError(null);
    try {
      await invoke("playlist_cover_clear", { id: playlist.id });
      setCoverUrl(null);
      setMode("auto");
    } catch (e) {
      setError(pesanError(e, "Cover gagal dihapus."));
    } finally {
      setBusy(false);
    }
  }

  async function simpan() {
    const n = nama.trim();
    if (!n) {
      setError("Nama playlist tidak boleh kosong.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("playlist_update_details", {
        id: playlist.id,
        name: n,
        description: deskripsi.trim() || null,
        coverMode: mode,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(pesanError(e, "Gagal menyimpan."));
    } finally {
      setBusy(false);
    }
  }

  const namaPanjang = nama.trim().length > 80;
  const deskripsiPanjang = deskripsi.length > 200;
  const bisaSimpan = nama.trim().length > 0 && !namaPanjang && !deskripsiPanjang && !busy;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={baru ? "Playlist baru" : "Detail playlist"}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "min(640px, calc(100vh - 32px))",
          overflowY: "auto",
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
          <span className="label">{baru ? "PLAYLIST BARU" : "DETAIL PLAYLIST"}</span>
          <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            style={{ width: 32, height: 32, color: "var(--ink-muted)" }}
          >
            <IkonTutup size={16} />
          </button>
        </header>

        <div style={{ display: "flex", gap: "var(--s-3)", padding: "var(--s-3)" }}>
          {/* Pratinjau cover: satu kotak besar, bukan tiga pratinjau kecil.
              Yang dilihat pengguna adalah hasil akhir, bukan ketiga opsinya. */}
          <div style={{ flex: "0 0 132px" }}>
            <PratinjauCover mode={mode} playlist={playlist} url={coverUrl} nama={nama} />
          </div>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "var(--s-2)",
            }}
          >
            <label style={{ display: "block" }}>
              <span className="label" style={{ display: "block", marginBottom: 4 }}>
                NAMA
              </span>
              <input
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                maxLength={120}
                autoFocus
                aria-invalid={namaPanjang || undefined}
                style={inputStyle(namaPanjang)}
              />
              <Penghitung n={nama.trim().length} batas={80} />
            </label>

            <label style={{ display: "block" }}>
              <span className="label" style={{ display: "block", marginBottom: 4 }}>
                DESKRIPSI <span className="muted">(opsional)</span>
              </span>
              <textarea
                value={deskripsi}
                onChange={(e) => setDeskripsi(e.target.value)}
                rows={2}
                maxLength={260}
                aria-invalid={deskripsiPanjang || undefined}
                style={{ ...inputStyle(deskripsiPanjang), resize: "vertical", minHeight: 56 }}
              />
              <Penghitung n={deskripsi.length} batas={200} />
            </label>
          </div>
        </div>

        <div style={{ padding: "0 var(--s-3) var(--s-3)" }}>
          <span className="label" style={{ display: "block", marginBottom: "var(--s-2)" }}>
            COVER
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <OpsiCover
              aktif={mode === "auto"}
              judul="OTOMATIS"
              ket="Mosaik 4 cover lagu pertama"
              onClick={() => setMode("auto")}
            />
            <OpsiCover
              aktif={mode === "custom"}
              judul="UPLOAD"
              ket={
                coverUrl
                  ? "Gambar sudah diunggah — pilih untuk mengganti"
                  : "Pilih gambar dari disk (PNG/JPG/WebP)"
              }
              onClick={() => {
                setMode("custom");
                fileRef.current?.click();
              }}
            />
            <OpsiCover
              aktif={mode === "generative"}
              judul="GENERATIF"
              ket="Pola dari inisial judul"
              onClick={() => setMode("generative")}
            />
          </div>

          {mode === "custom" && coverUrl && (
            <button
              type="button"
              onClick={() => void hapusCover()}
              disabled={busy}
              style={{
                marginTop: "var(--s-2)",
                padding: "6px 10px",
                background: "transparent",
                border: "1px solid var(--line-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
                cursor: "pointer",
              }}
            >
              HAPUS COVER
            </button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset value supaya memilih berkas yang sama dua kali tetap
              // memicu onChange.
              e.target.value = "";
              if (f) void pilihBerkas(f);
            }}
          />
        </div>

        {error && (
          <p
            role="alert"
            style={{
              margin: "0 var(--s-3) var(--s-2)",
              padding: "8px 10px",
              borderLeft: "3px solid var(--danger, #c0392b)",
              background: "var(--panel-2)",
              fontSize: 12,
            }}
          >
            {error}
          </p>
        )}

        <footer
          style={{
            display: "flex",
            gap: "var(--s-2)",
            padding: "var(--s-3)",
            borderTop: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: 44,
              background: "transparent",
              border: "1px solid var(--line-strong)",
              color: "var(--ink)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              cursor: "pointer",
            }}
          >
            BATAL
          </button>
          <button
            type="button"
            onClick={() => void simpan()}
            disabled={!bisaSimpan}
            style={{
              flex: 1,
              minHeight: 44,
              background: bisaSimpan ? "var(--accent)" : "var(--panel-2)",
              border: "none",
              color: bisaSimpan ? "var(--accent-ink)" : "var(--ink-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              fontWeight: 600,
              cursor: bisaSimpan ? "pointer" : "not-allowed",
            }}
          >
            {busy ? "MENYIMPAN…" : "SIMPAN"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Kotak pratinjau 132×132 yang mengikuti mode yang sedang dipilih. */
function PratinjauCover({
  mode,
  playlist,
  url,
  nama,
}: {
  mode: ModeCover;
  playlist: Playlist;
  url: string | null;
  nama: string;
}) {
  const kotak = (isi: React.ReactNode) => (
    <div
      style={{
        width: 132,
        height: 132,
        background: "var(--panel-2)",
        border: "1px solid var(--line)",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
      }}
    >
      {isi}
    </div>
  );

  if (mode === "custom" && url) {
    return kotak(
      <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />,
    );
  }
  if (mode === "generative") {
    return kotak(<CoverArt coverKey={null} title={nama || playlist.name} size={132} radius={0} />);
  }
  return kotak(
    <PlaylistArt
      playlist={{ ...playlist, name: nama || playlist.name, coverMode: "auto" }}
      size={132}
    />,
  );
}

function OpsiCover({
  aktif,
  judul,
  ket,
  onClick,
}: {
  aktif: boolean;
  judul: string;
  ket: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktif}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 1,
        padding: "8px 10px",
        minHeight: 44,
        width: "100%",
        textAlign: "left",
        background: aktif ? "var(--accent)" : "transparent",
        color: aktif ? "var(--accent-ink)" : "var(--ink)",
        border: "none",
        cursor: "pointer",
      }}
    >
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>
        {judul}
      </span>
      <span
        style={{
          fontSize: 11,
          opacity: aktif ? 0.8 : 0.65,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {ket}
      </span>
    </button>
  );
}

function Penghitung({ n, batas }: { n: number; batas: number }) {
  const lewat = n > batas;
  return (
    <span
      className="mono"
      style={{
        display: "block",
        textAlign: "right",
        fontSize: 10,
        letterSpacing: "0.06em",
        marginTop: 2,
        color: lewat ? "var(--danger, #c0392b)" : "var(--ink-muted)",
      }}
    >
      {n}/{batas}
    </span>
  );
}

function inputStyle(invalid: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    background: "var(--panel-2)",
    border: `1px solid ${invalid ? "var(--danger, #c0392b)" : "var(--line)"}`,
    color: "var(--ink)",
    fontFamily: "inherit",
    fontSize: 13,
  };
}

function pesanError(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
