import { useEffect, useRef, useState } from "react";
import { invoke } from "../../lib/tauri";
import type { SearchResults, Track } from "../../types";
import { TrackRow } from "../../components/TrackRow";
import { EmptyState } from "../../components/EmptyState";
import { PageHead } from "../../components/PageHead";
import { IkonRiwayat } from "../../components/icons";
import { T } from "../../lib/strings";
import { SuggestionPanel } from "./SuggestionPanel";
import { useSearchSuggestions } from "./useSearchSuggestions";

export function Search({
  onPlay,
  onQueue,
  onFavorite,
  favoriteIds,
  onAddToPlaylist,
  activeVideoId = null,
  query,
  setQuery,
}: {
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
  onFavorite: (t: Track) => void;
  /** videoId yang sudah difavoritkan, supaya hati terisi dengan benar. */
  favoriteIds: Set<string>;
  onAddToPlaylist: (t: Track) => void;
  activeVideoId?: string | null;
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

  const { muatRiwayat } = saran;
  // Muat riwayat saat halaman mount agar chip pencarian terakhir langsung tersedia
  useEffect(() => {
    void muatRiwayat(8);
  }, [muatRiwayat]);

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
      setError(err instanceof Error ? err.message : T.pencarianGagal);
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

  const metaText = results?.tracks.length ? `${results.tracks.length} ${T.hasil}` : undefined;

  return (
    <section style={{ padding: "var(--s-6) var(--s-6) var(--s-8)", minWidth: 0 }}>
      <PageHead title={T.navCari} meta={metaText} />

      <form onSubmit={runSearch} style={{ display: "flex", gap: "var(--s-2)" }}>
        <div ref={bungkusRef} style={{ position: "relative", flex: 1 }}>
          <input
            type="search"
            className="k-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPanelTerbuka(true);
              setSorot(-1);
            }}
            onFocus={() => setPanelTerbuka(true)}
            onKeyDown={onKeyDown}
            placeholder={T.cariPlaceholder}
            aria-label={T.labelKataKunci}
            aria-autocomplete="list"
            aria-expanded={tampilkanPanel}
            aria-controls="panel-saran-pencarian"
            autoComplete="off"
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
        <button type="submit" className="k-btn k-btn-accent">
          {T.cari}
        </button>
      </form>

      <div style={{ marginTop: "var(--s-4)" }}>
        {loading && (
          <div role="status" aria-label={T.sedangMencari} style={{ display: "grid", gap: 8 }}>
            {[1, 0.85, 0.7, 0.55, 0.4, 0.25, 0.15].map((op, i) => (
              <div
                key={i}
                className="skeleton"
                style={{
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 var(--s-2)",
                  gap: "var(--s-2)",
                  opacity: op,
                }}
              >
                <div style={{ width: 40, height: 40, background: "var(--panel)" }} />
                <div style={{ flex: 1, display: "grid", gap: 6 }}>
                  <div style={{ height: 10, width: "40%", background: "var(--panel)" }} />
                  <div style={{ height: 8, width: "25%", background: "var(--panel)" }} />
                </div>
                <div style={{ width: 36, height: 8, background: "var(--panel)" }} />
              </div>
            ))}
          </div>
        )}

        {error && (
          <EmptyState
            kode="ERR"
            title={T.pencarianGagal}
            hint={error}
            action={
              <button
                type="button"
                className="k-btn"
                onClick={() => void cari(query)}
                style={{ marginTop: "var(--s-2)" }}
              >
                {T.cobaLagi}
              </button>
            }
          />
        )}

        {!loading && !error && results && results.tracks.length > 0 && (
          <div className="page-enter" style={{ display: "grid", gap: 2 }}>
            {results.tracks.map((t, i) => (
              <TrackRow
                key={t.videoId}
                track={t}
                index={i}
                active={activeVideoId === t.videoId}
                onPlay={onPlay}
                onQueue={onQueue}
                onFavorite={onFavorite}
                favorite={favoriteIds.has(t.videoId)}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        )}

        {!loading && !error && results && results.tracks.length === 0 && (
          <EmptyState kode="0 HASIL" title={T.tidakAdaHasil} hint={T.tidakAdaHasilHint} />
        )}

        {!loading && !error && !results && (
          <div>
            {saran.riwayat.length > 0 && (
              <div style={{ marginBottom: "var(--s-6)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "var(--s-2)",
                  }}
                >
                  <span className="label" style={{ color: "var(--ink-muted)" }}>
                    {T.pencarianTerakhir}
                  </span>
                  <button
                    type="button"
                    onClick={() => void saran.kosongkanRiwayat()}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      color: "var(--ink-muted)",
                      cursor: "pointer",
                      padding: "4px 8px",
                    }}
                  >
                    {T.kosongkan}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
                  {saran.riwayat.slice(0, 8).map((r) => (
                    <button
                      key={r.query}
                      type="button"
                      className="k-chip"
                      onClick={() => pilihSaran(r.query)}
                      title={r.query}
                    >
                      <IkonRiwayat size={14} />
                      <span>{r.query}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <EmptyState kode="STANDBY" title={T.mulaiDariSini} hint={T.mulaiHint} />
          </div>
        )}
      </div>
    </section>
  );
}
