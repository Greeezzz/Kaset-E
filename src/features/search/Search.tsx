import { useEffect, useRef, useState } from "react";
import { invoke } from "../../lib/tauri";
import type { SearchResults, Track } from "../../types";
import { TrackRow } from "../../components/TrackRow";
import { EmptyState } from "../../components/EmptyState";
import { T } from "../../lib/strings";
import { SuggestionPanel } from "./SuggestionPanel";
import { useSearchSuggestions } from "./useSearchSuggestions";

export function Search({
  onPlay,
  onQueue,
  onPlayNext,
  onFavorite,
  favoriteIds,
  onAddToPlaylist,
  query,
  setQuery,
}: {
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  onFavorite: (t: Track) => void;
  /** videoId yang sudah difavoritkan, supaya hati terisi dengan benar. */
  favoriteIds: Set<string>;
  onAddToPlaylist: (t: Track) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [panelTerbuka, setPanelTerbuka] = useState(false);
  const [sorot, setSorot] = useState(-1);
  const bungkusRef = useRef<HTMLDivElement | null>(null);

  const saran = useSearchSuggestions(query, panelTerbuka);

  // Klik di luar kotak menutup panel. Tanpa ini panel menutupi hasil pencarian
  // dan tidak ada cara menutupnya selain memilih saran.
  useEffect(() => {
    if (!panelTerbuka) return;
    const onDown = (e: MouseEvent) => {
      if (bungkusRef.current && !bungkusRef.current.contains(e.target as Node)) {
        setPanelTerbuka(false);
        setSorot(-1);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panelTerbuka]);

  /** Jalankan pencarian untuk kata kunci tertentu (dipakai form & saran). */
  async function cari(q: string) {
    const bersih = q.trim();
    if (!bersih) return;
    setPanelTerbuka(false);
    setSorot(-1);
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<SearchResults>("search", { query: bersih });
      setResults(r);
      // Riwayat berubah setelah pencarian; muat ulang supaya entri baru muncul
      // saat panel dibuka berikutnya.
      void saran.muatRiwayat();
    } catch (err) {
      // Pesan untuk user singkat; detail teknis nanti masuk log (AGENTS.md).
      setError(err instanceof Error ? err.message : "Pencarian gagal");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    await cari(query);
  }

  function pilihSaran(q: string) {
    setQuery(q);
    void cari(q);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!panelTerbuka) {
      // Panah bawah saat panel tertutup = buka panel tanpa harus mengetik.
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPanelTerbuka(true);
        setSorot(saran.items.length > 0 ? 0 : -1);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSorot((i) => (saran.items.length === 0 ? -1 : (i + 1) % saran.items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSorot((i) => (saran.items.length === 0 ? -1 : i <= 0 ? saran.items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      const item = sorot >= 0 ? saran.items[sorot] : null;
      if (item) {
        e.preventDefault();
        pilihSaran(item.query);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPanelTerbuka(false);
      setSorot(-1);
    }
  }

  const tampilkanPanel = panelTerbuka && (saran.items.length > 0 || saran.memuat);

  return (
    <section style={{ padding: "var(--s-4) var(--s-4) var(--s-8)", maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>CARI</h1>

      <form onSubmit={runSearch} style={{ display: "flex", gap: "var(--s-2)" }}>
        <div ref={bungkusRef} style={{ position: "relative", flex: 1 }}>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPanelTerbuka(true);
              setSorot(-1);
            }}
            onFocus={() => setPanelTerbuka(true)}
            onKeyDown={onKeyDown}
            placeholder="Cari lagu, artis, atau album"
            aria-label="Kata kunci pencarian"
            aria-autocomplete="list"
            aria-expanded={tampilkanPanel}
            aria-controls="panel-saran-pencarian"
            autoComplete="off"
            style={{
              width: "100%",
              minHeight: 44,
              padding: "0 var(--s-3)",
              border: "1px solid var(--line-strong)",
              background: "var(--panel)",
              color: "var(--ink)",
              font: "inherit",
            }}
          />

          {tampilkanPanel ? (
            <div id="panel-saran-pencarian">
              <SuggestionPanel
                items={saran.items}
                sorot={sorot}
                memuat={saran.memuat}
                onPilih={pilihSaran}
                onHapus={(q) => void saran.hapusRiwayat(q)}
                onKosongkan={() => void saran.kosongkanRiwayat()}
                onSorot={setSorot}
              />
            </div>
          ) : null}
        </div>
        <button
          type="submit"
          style={{
            minHeight: 44,
            padding: "0 var(--s-4)",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Cari
        </button>
      </form>

      <div style={{ marginTop: "var(--s-4)" }}>
        {loading && <p className="muted">Mencari…</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        {results && results.tracks.length > 0 && (
          <div style={{ display: "grid", gap: 2 }}>
            {results.tracks.map((t, i) => (
              <TrackRow
                key={t.videoId}
                track={t}
                index={i}
                onPlay={onPlay}
                onQueue={onQueue}
                onPlayNext={onPlayNext}
                onFavorite={onFavorite}
                favorite={favoriteIds.has(t.videoId)}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        )}

        {results && results.tracks.length === 0 && (
          <EmptyState title={T.tidakAdaHasil} hint={T.tidakAdaHasilHint} />
        )}

        {!results && !loading && !error && (
          <EmptyState title="MULAI DARI SINI" hint={T.mulaiHint} />
        )}
      </div>
    </section>
  );
}
