import { useState } from "react";
import { invoke } from "../../lib/tauri";
import type { SearchResults, Track } from "../../types";
import { TrackRow } from "../../components/TrackRow";
import { EmptyState } from "../../components/EmptyState";

export function Search({
  onPlay,
  onQueue,
  onPlayNext,
  query,
  setQuery,
}: {
  onPlay: (t: Track) => void;
  onQueue: (t: Track) => void;
  onPlayNext: (t: Track) => void;
  query: string;
  setQuery: (q: string) => void;
}) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await invoke<SearchResults>("search", { query });
      setResults(r);
    } catch (err) {
      // Pesan untuk user singkat; detail teknis nanti masuk log (AGENTS.md).
      setError(err instanceof Error ? err.message : "Pencarian gagal");
      setResults(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={{ padding: "var(--s-4) var(--s-4) var(--s-8)", maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>Search</h1>

      <form onSubmit={runSearch} style={{ display: "flex", gap: "var(--s-2)" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari lagu, artis, atau album"
          aria-label="Kata kunci pencarian"
          style={{
            flex: 1,
            minHeight: 44,
            padding: "0 var(--s-3)",
            borderRadius: "var(--r-sm)",
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            font: "inherit",
          }}
        />
        <button
          type="submit"
          style={{
            minHeight: 44,
            padding: "0 var(--s-4)",
            borderRadius: "var(--r-sm)",
            background: "var(--accent)",
            color: "var(--accent-ink)",
            fontWeight: 600,
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
              />
            ))}
          </div>
        )}

        {results && results.tracks.length === 0 && (
          <EmptyState title="Tidak ada hasil" hint="Coba kata kunci lain." />
        )}

        {!results && !loading && !error && (
          <EmptyState
            title="Mulai dari sini"
            hint="Ketik judul lagu atau nama artis, lalu tekan Cari."
          />
        )}
      </div>
    </section>
  );
}
