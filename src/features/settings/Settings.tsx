import { useEffect, useState } from "react";
import { invoke, runningInTauri } from "../../lib/tauri";
import { currentTheme, setTheme, type Theme } from "../../lib/theme";

/**
 * Settings. Fase 1: menampilkan status katalog (nyata vs mock) supaya user tahu
 * apakah pencarian sudah mengambil data sungguhan atau masih contoh.
 */
export function Settings() {
  const [catalogLive, setCatalogLive] = useState<boolean | null>(null);
  const [trackCount, setTrackCount] = useState<number | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());

  useEffect(() => {
    if (!runningInTauri) {
      setCatalogLive(false);
      return;
    }
    let cancelled = false;

    // Katalog di-upgrade di background saat app start, jadi status bisa berubah
    // dari mock ke nyata. Polling singkat lebih jujur daripada sekali baca.
    const check = async () => {
      try {
        const live = await invoke<boolean>("catalog_status");
        if (!cancelled) setCatalogLive(live);
        return live;
      } catch {
        if (!cancelled) setCatalogLive(false);
        return false;
      }
    };

    void check();
    void invoke<number>("tracks_count")
      .then(setTrackCount)
      .catch(() => setTrackCount(null));

    const timer = setInterval(async () => {
      if (await check()) clearInterval(timer);
    }, 1500);
    const giveUp = setTimeout(() => clearInterval(timer), 20_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, []);

  const statusText =
    catalogLive === null ? "Memeriksa…" : catalogLive ? "YouTube Music (aktif)" : "Mock (contoh)";

  return (
    <section style={{ padding: "var(--s-4)", maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>Settings</h1>

      <dl
        style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--s-2) var(--s-4)" }}
      >
        <dt className="muted">Shell</dt>
        <dd style={{ margin: 0 }}>{runningInTauri ? "Tauri (desktop)" : "Browser (mock)"}</dd>

        <dt className="muted">Katalog</dt>
        <dd style={{ margin: 0 }}>
          {statusText}
          {catalogLive === false && (
            <span className="muted" style={{ display: "block", fontSize: 13 }}>
              Pencarian masih memakai data contoh. Biasanya karena belum ada koneksi.
            </span>
          )}
        </dd>

        <dt className="muted">Lagu tersimpan</dt>
        <dd style={{ margin: 0 }}>
          {trackCount === null ? "—" : `${trackCount} lagu`}
          <span className="muted" style={{ display: "block", fontSize: 13 }}>
            Metadata lagu yang sudah dikenal database. Wajib ada sebelum lagu bisa difavoritkan,
            masuk playlist, atau disimpan di queue.
          </span>
        </dd>

        <dt className="muted">Tema</dt>
        <dd style={{ margin: 0 }}>
          <div role="radiogroup" aria-label="Tema" style={{ display: "flex", gap: "var(--s-2)" }}>
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={theme === t}
                onClick={() => {
                  setTheme(t);
                  setThemeState(t);
                }}
                style={{
                  minHeight: 44,
                  padding: "0 var(--s-3)",
                  border: "1px solid var(--line)",
                  background: theme === t ? "var(--accent)" : "transparent",
                  color: theme === t ? "var(--accent-ink)" : "var(--ink)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {t === "light" ? "Terminal Kertas" : "Terminal Malam"}
              </button>
            ))}
          </div>
        </dd>

        <dt className="muted">Data</dt>
        <dd style={{ margin: 0 }}>Lokal saja — tanpa server, tanpa telemetri.</dd>
      </dl>

      <p className="muted" style={{ marginTop: "var(--s-6)", fontSize: 13 }}>
        Kaset adalah proyek pribadi/edukasi dan tidak berafiliasi dengan Google atau YouTube.
      </p>
    </section>
  );
}
