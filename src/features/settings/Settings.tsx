import { useEffect, useRef, useState } from "react";
import { invoke, runningInTauri } from "../../lib/tauri";
import { currentTheme, setTheme, type Theme } from "../../lib/theme";
import { T } from "../../lib/strings";

interface ImportReport {
  favoritesAdded: number;
  playlistsCreated: number;
  tracksAdded: number;
}

/**
 * Settings. Fase 1: menampilkan status katalog (nyata vs mock) supaya user tahu
 * apakah pencarian sudah mengambil data sungguhan atau masih contoh, serta
 * ekspor/impor JSON library.
 */
export function Settings({ onLibraryChanged }: { onLibraryChanged?: () => void }) {
  const [catalogLive, setCatalogLive] = useState<boolean | null>(null);
  const [trackCount, setTrackCount] = useState<number | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => currentTheme());
  const [resolverLive, setResolverLive] = useState<boolean | null>(null);
  const [backupMsg, setBackupMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function ekspor() {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const json = await invoke<string>("export_library");
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const tanggal = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `kaset-library-${tanggal}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg({ text: T.eksporBerhasil });
    } catch {
      setBackupMsg({ text: T.eksporGagal, error: true });
    } finally {
      setBackupBusy(false);
    }
  }

  async function impor(file: File) {
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const json = await file.text();
      const rep = await invoke<ImportReport>("import_library", { json });
      setBackupMsg({
        text: T.imporHasil(rep.favoritesAdded, rep.playlistsCreated, rep.tracksAdded),
      });
      onLibraryChanged?.();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err && typeof err.message === "string"
          ? err.message
          : T.imporGagal;
      setBackupMsg({ text: msg, error: true });
    } finally {
      setBackupBusy(false);
    }
  }

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

    // Resolver di-upgrade di background (termasuk mengunduh yt-dlp sekali),
    // jadi statusnya dipantau sampai berubah.
    const checkResolver = () =>
      invoke<boolean>("resolver_status")
        .then((live) => {
          setResolverLive(live);
          return live;
        })
        .catch(() => {
          setResolverLive(false);
          return false;
        });
    void checkResolver();
    const resolverTimer = setInterval(async () => {
      if (await checkResolver()) clearInterval(resolverTimer);
    }, 2000);
    const resolverGiveUp = setTimeout(() => {
      clearInterval(resolverTimer);
      setResolverLive((v) => v ?? false);
    }, 60_000);

    const timer = setInterval(async () => {
      if (await check()) clearInterval(timer);
    }, 1500);
    const giveUp = setTimeout(() => clearInterval(timer), 20_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(giveUp);
      clearInterval(resolverTimer);
      clearTimeout(resolverGiveUp);
    };
  }, []);

  const statusText =
    catalogLive === null ? T.memeriksa : catalogLive ? T.katalogAktif : T.katalogMock;

  return (
    <section style={{ padding: "var(--s-6) var(--s-6) var(--s-8)", maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>{T.pengaturan}</h1>

      <dl
        style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--s-2) var(--s-4)" }}
      >
        <dt className="muted">{T.pengaturanShell}</dt>
        <dd style={{ margin: 0 }}>{runningInTauri ? T.shellDesktop : T.shellBrowser}</dd>

        <dt className="muted">{T.pengaturanKatalog}</dt>
        <dd style={{ margin: 0 }}>
          {statusText}
          {catalogLive === false && (
            <span className="muted" style={{ display: "block", fontSize: 13 }}>
              {T.katalogMockHint}
            </span>
          )}
        </dd>

        <dt className="muted">{T.pengaturanLaguTersimpan}</dt>
        <dd style={{ margin: 0 }}>
          {trackCount === null ? "—" : `${trackCount} ${T.lagu.toLowerCase()}`}
          <span className="muted" style={{ display: "block", fontSize: 13 }}>
            {T.laguTersimpanHint}
          </span>
        </dd>

        <dt className="muted">{T.pengaturanPemutaran}</dt>
        <dd style={{ margin: 0 }}>
          {resolverLive === null
            ? T.memeriksa
            : resolverLive
              ? T.pemutaranAktif
              : T.pemutaranBelumTersedia}
          {resolverLive === false && (
            <span className="muted" style={{ display: "block", fontSize: 13 }}>
              {T.pemutaranHint}
            </span>
          )}
        </dd>

        <dt className="muted">{T.pengaturanTema}</dt>
        <dd style={{ margin: 0 }}>
          <div
            role="radiogroup"
            aria-label={T.pengaturanTema}
            style={{ display: "flex", gap: "var(--s-2)" }}
          >
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
                {t === "light" ? T.temaTerang : T.temaGelap}
              </button>
            ))}
          </div>
        </dd>

        <dt className="muted">{T.pengaturanData}</dt>
        <dd style={{ margin: 0 }}>{T.dataLokal}</dd>

        <dt className="muted">{T.pengaturanCadangan}</dt>
        <dd style={{ margin: 0 }}>
          <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={backupBusy}
              onClick={() => void ekspor()}
              style={{
                minHeight: 44,
                padding: "0 var(--s-3)",
                border: "1px solid var(--line-strong)",
                background: "transparent",
                color: "var(--ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
              }}
            >
              {T.eksporJson}
            </button>
            <button
              type="button"
              disabled={backupBusy}
              onClick={() => importInputRef.current?.click()}
              style={{
                minHeight: 44,
                padding: "0 var(--s-3)",
                border: "1px solid var(--line-strong)",
                background: "transparent",
                color: "var(--ink)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.08em",
              }}
            >
              {T.imporJson}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void impor(f);
              }}
            />
          </div>
          <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 6 }}>
            {T.cadanganHint}
          </span>
          {backupMsg && (
            <p
              role={backupMsg.error ? "alert" : "status"}
              style={{
                margin: "6px 0 0",
                fontSize: 13,
                color: backupMsg.error ? "var(--danger)" : "var(--ok)",
              }}
            >
              {backupMsg.text}
            </p>
          )}
        </dd>
      </dl>

      <p className="muted" style={{ marginTop: "var(--s-6)", fontSize: 13 }}>
        {T.disclaimer}
      </p>
    </section>
  );
}
