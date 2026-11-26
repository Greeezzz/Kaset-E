import { useEffect, useRef, useState } from "react";
import { invoke, runningInTauri } from "../../lib/tauri";
import { currentTheme, setTheme, type Theme } from "../../lib/theme";
import { T } from "../../lib/strings";
import { PageHead } from "../../components/PageHead";

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
  // Statistik (Fase 4b)
  const [statsAktif, setStatsAktif] = useState(true);
  const [statsMsg, setStatsMsg] = useState<string | null>(null);
  const [modeNp, setModeNp] = useState<"standar" | "kaset">("standar");
  const [lrclibAktif, setLrclibAktif] = useState(false);

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

  useEffect(() => {
    if (!runningInTauri) return;
    void invoke<string | null>("setting_get", { key: "nowplaying.mode" })
      .then((v) => {
        if (v === "kaset" || v === "standar") setModeNp(v);
      })
      .catch(() => {});
    void invoke<string | null>("setting_get", { key: "listen_stats" })
      .then((v) => setStatsAktif(v !== "0"))
      .catch(() => setStatsAktif(true));
    void invoke<string | null>("setting_get", { key: "lirik.lrclib" })
      .then((v) => setLrclibAktif(v === "1"))
      .catch(() => setLrclibAktif(false));
  }, []);

  async function ubahPencatatan(aktif: boolean) {
    setStatsAktif(aktif);
    try {
      await invoke("setting_set", { key: "listen_stats", value: aktif ? "1" : "0" });
    } catch {
      // Gagal simpan: kembalikan saklar supaya UI tidak berbohong.
      setStatsAktif(!aktif);
    }
  }

  // Mode Now Playing (FEATURES-V3 K1). Dibaca dari tabel `settings` yang sama
  // dengan hook di App; di sini hanya untuk menampilkan pilihan.
  async function ubahModeNowPlaying(m: "standar" | "kaset") {
    setModeNp(m);
    try {
      await invoke("setting_set", { key: "nowplaying.mode", value: m });
    } catch {
      setModeNp((v) => (v === m ? (m === "kaset" ? "standar" : "kaset") : v));
    }
  }

  async function hapusStatistik() {
    setStatsMsg(null);
    try {
      const n = await invoke<number>("listen_clear");
      setStatsMsg(T.statsDihapus(n));
    } catch {
      setStatsMsg(T.statsHapusGagal);
    }
  }

  const statusText =
    catalogLive === null ? T.memeriksa : catalogLive ? T.katalogAktif : T.katalogMock;

  return (
    <section
      className="page-enter"
      style={{ padding: "var(--s-6) var(--s-6) var(--s-8)", maxWidth: 720 }}
    >
      <PageHead title={T.pengaturan} />

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

        <dt className="muted">{T.pengaturanLirik}</dt>
        <dd style={{ margin: 0 }}>
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--s-3)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={lrclibAktif}
              onChange={async (e) => {
                const checked = e.target.checked;
                setLrclibAktif(checked);
                try {
                  await invoke("setting_set", {
                    key: "lirik.lrclib",
                    value: checked ? "1" : "0",
                  });
                } catch {
                  setLrclibAktif(!checked);
                }
              }}
              style={{
                width: 18,
                height: 18,
                accentColor: "var(--accent)",
                marginTop: 2,
              }}
            />
            <div style={{ display: "grid", gap: 4 }}>
              <span style={{ fontWeight: 600 }}>{T.lrclibAktif}</span>
              <span className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                {T.lrclibKet}
              </span>
            </div>
          </label>
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

      <h2 style={{ fontSize: 15, margin: "var(--s-6) 0 var(--s-2)" }}>{T.pengaturanTampilan}</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>{T.pengaturanModeNowPlaying}</span>
        {(["standar", "kaset"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => void ubahModeNowPlaying(m)}
            aria-pressed={modeNp === m}
            className="mono"
            style={{
              padding: "6px 12px",
              fontSize: 11,
              letterSpacing: "0.08em",
              border: modeNp === m ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
              background: modeNp === m ? "var(--accent)" : "transparent",
              color: modeNp === m ? "var(--accent-ink)" : "var(--ink)",
              fontWeight: modeNp === m ? 600 : 400,
            }}
          >
            {m === "standar" ? T.modeStandar : T.modeKaset}
          </button>
        ))}
      </div>
      <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 6 }}>
        {T.pengaturanModeHint}
      </span>

      <h2 style={{ fontSize: 15, margin: "var(--s-6) 0 var(--s-2)" }}>{T.statsPengaturan}</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={statsAktif}
            onChange={(e) => void ubahPencatatan(e.target.checked)}
          />
          {T.statsCatat}
        </label>
        <button
          type="button"
          onClick={() => void hapusStatistik()}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--line-strong)",
            background: "transparent",
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.06em",
          }}
        >
          {T.statsHapus}
        </button>
        {statsMsg && (
          <span className="muted" style={{ fontSize: 12 }}>
            {statsMsg}
          </span>
        )}
      </div>
      <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 6 }}>
        {T.statsCatatHint}
      </span>

      <p className="muted" style={{ marginTop: "var(--s-6)", fontSize: 13 }}>
        {T.disclaimer}
      </p>
    </section>
  );
}
