import { useEffect, useRef, useState } from "react";
import { invoke, listen, runningInTauri } from "../../lib/tauri";
import { currentTheme, setTheme, type Theme } from "../../lib/theme";
import { T } from "../../lib/strings";
import { PageHead } from "../../components/PageHead";
import {
  supabase,
  performFullSync,
  signInWithGoogleOAuth,
  type SyncStatus,
} from "../../lib/supabase";

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

  // Cloud Sync Supabase (Fase 6)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isLoggedIn: false,
    userEmail: null,
    lastSyncAt: null,
    isSyncing: false,
    error: null,
  });
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [manualTokenInput, setManualTokenInput] = useState("");
  const [showManualToken, setShowManualToken] = useState(false);

  async function processAuthHash(hashString: string) {
    try {
      setAuthBusy(true);
      let cleaned = hashString.trim();
      if (cleaned.includes("#")) {
        cleaned = cleaned.substring(cleaned.indexOf("#") + 1);
      } else if (cleaned.includes("?")) {
        cleaned = cleaned.substring(cleaned.indexOf("?") + 1);
      }
      const params = new URLSearchParams(cleaned);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setAuthMsg({ text: `Gagal login: ${error.message}`, error: true });
        } else if (data?.session?.user) {
          setSyncStatus((s) => ({
            ...s,
            isLoggedIn: true,
            userEmail: data.session!.user.email ?? null,
          }));
          setAuthMsg({ text: "Berhasil login dengan Google!" });
          setShowManualToken(false);
          setManualTokenInput("");
          void handleSync();
        }
      } else {
        setAuthMsg({ text: "Token tidak ditemukan dalam URL yang ditempel.", error: true });
      }
    } catch (e) {
      console.error("Gagal parse token:", e);
      setAuthMsg({ text: "Gagal memproses token autentikasi.", error: true });
    } finally {
      setAuthBusy(false);
    }
  }

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

    // Periksa status auth Supabase
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setSyncStatus((s) => ({
        ...s,
        isLoggedIn: !!session?.user,
        userEmail: session?.user?.email ?? null,
      }));
    });

    void invoke<string | null>("setting_get", { key: "last_sync_at" })
      .then((v) => {
        if (v) setSyncStatus((s) => ({ ...s, lastSyncAt: Number(v) }));
      })
      .catch(() => {});

    // Tangkap token dari server local callback OAuth (port 3000)
    let offOAuth: (() => void) | null = null;
    if (runningInTauri) {
      void listen("oauth://token", (payload: string) => {
        try {
          const parsed = JSON.parse(payload) as { hash?: string };
          if (parsed.hash) {
            void processAuthHash(parsed.hash);
          }
        } catch (e) {
          console.error("Gagal parse token OAuth payload:", e);
        }
      }).then((un) => {
        offOAuth = un;
      });
    }

    return () => {
      if (offOAuth) offOAuth();
    };
  }, []);

  async function handleGoogleLogin() {
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      if (runningInTauri) {
        await invoke("start_oauth_server").catch(() => {});
      }
      const res = await signInWithGoogleOAuth();
      if (res.error) throw new Error(res.error);
      if (res.url) {
        if (runningInTauri) {
          await invoke("plugin:opener|open_url", { url: res.url });
        } else {
          window.open(res.url, "_blank");
        }
        setAuthMsg({
          text: "Browser dibuka. Jika browser menolak konek ke localhost, kamu bisa menyalin URL lengkap browser dan menempelkannya di bawah.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuka login Google";
      setAuthMsg({ text: msg, error: true });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!authEmail || !authPassword) return;
    setAuthBusy(true);
    setAuthMsg(null);
    try {
      if (authMode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setSyncStatus((s) => ({
          ...s,
          isLoggedIn: true,
          userEmail: data.user?.email ?? null,
        }));
        setAuthMsg({ text: "Berhasil masuk!" });
        void handleSync();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        setAuthMsg({
          text: data.session
            ? "Akun berhasil dibuat dan otomatis masuk!"
            : "Akun berhasil didaftarkan! Periksa email untuk konfirmasi.",
        });
        if (data.session) {
          setSyncStatus((s) => ({
            ...s,
            isLoggedIn: true,
            userEmail: data.user?.email ?? null,
          }));
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Autentikasi gagal";
      setAuthMsg({ text: msg, error: true });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    setAuthBusy(true);
    try {
      await supabase.auth.signOut();
      setSyncStatus((s) => ({
        ...s,
        isLoggedIn: false,
        userEmail: null,
      }));
      setAuthMsg({ text: "Berhasil keluar dari akun." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal logout";
      setAuthMsg({ text: msg, error: true });
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSync() {
    setSyncStatus((s) => ({ ...s, isSyncing: true, error: null }));
    try {
      const res = await performFullSync();
      const now = Date.now();
      if (runningInTauri) {
        await invoke("setting_set", { key: "last_sync_at", value: String(now) });
      }
      setSyncStatus((s) => ({
        ...s,
        isSyncing: false,
        lastSyncAt: now,
      }));
      setAuthMsg({
        text: `Sinkronisasi selesai! (${res.playlistsSynced} playlist, ${res.favoritesSynced} favorit disinkronkan)`,
      });
      if (onLibraryChanged) onLibraryChanged();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal sinkronisasi";
      setSyncStatus((s) => ({ ...s, isSyncing: false, error: msg }));
      setAuthMsg({ text: `Sinkronisasi gagal: ${msg}`, error: true });
    }
  }

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

      {/* Cloud Sync & Akun (Fase 6) */}
      <div
        style={{
          border: "1px solid var(--line)",
          background: "var(--bg-elevated, var(--bg))",
          padding: "var(--s-4)",
          marginBottom: "var(--s-6)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--s-3)" }}>
          <h2 style={{ fontSize: 14, margin: 0, letterSpacing: "0.06em", textTransform: "uppercase" }} className="mono">
            // CLOUD SYNC & AKUN
          </h2>
          <span
            className="mono"
            style={{
              fontSize: 10,
              padding: "2px 6px",
              background: syncStatus.isLoggedIn ? "rgba(34, 197, 94, 0.15)" : "var(--line)",
              color: syncStatus.isLoggedIn ? "var(--ok, #22c55e)" : "var(--muted)",
              borderRadius: 2,
            }}
          >
            {syncStatus.isLoggedIn ? "TERHUBUNG" : "OFFLINE / LOCAL ONLY"}
          </span>
        </div>

        {syncStatus.isLoggedIn ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div>
                <span className="mono muted" style={{ fontSize: 11, display: "block" }}>
                  MASUK SEBAGAI
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{syncStatus.userEmail}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={syncStatus.isSyncing}
                  className="mono"
                  style={{
                    padding: "6px 12px",
                    background: "var(--accent)",
                    color: "var(--accent-ink)",
                    border: "none",
                    fontWeight: 700,
                    fontSize: 11,
                  }}
                >
                  {syncStatus.isSyncing ? "MENYINKRONKAN..." : "SINKRONKAN SEKARANG"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={authBusy}
                  className="mono"
                  style={{
                    padding: "6px 12px",
                    background: "transparent",
                    color: "var(--danger)",
                    border: "1px solid var(--line-strong)",
                    fontSize: 11,
                  }}
                >
                  KELUAR
                </button>
              </div>
            </div>
            {syncStatus.lastSyncAt && (
              <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 10 }}>
                Terakhir sinkron: {new Date(syncStatus.lastSyncAt).toLocaleString("id-ID")}
              </span>
            )}
          </div>
        ) : (
          <div>
            <p style={{ margin: "0 0 var(--s-3)", fontSize: 13, color: "var(--muted)" }}>
              Masuk dengan akun Google agar playlist dan lagu favoritmu otomatis tersinkronisasi antara Desktop dan Android.
            </p>
            {/* Tombol Google OAuth */}
            <div>
              <button
                type="button"
                onClick={() => void handleGoogleLogin()}
                disabled={authBusy}
                className="mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 16px",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  border: "1px solid var(--accent)",
                  fontWeight: 700,
                  fontSize: 12,
                  letterSpacing: "0.06em",
                  cursor: "pointer",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                MASUK DENGAN GOOGLE
              </button>
            </div>

            {/* Alternatif Tempel URL jika browser diblokir atau gagal auto-redirect */}
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setShowManualToken((s) => !s)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: 11,
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {showManualToken ? "Sembunyikan opsi tempel URL" : "Browser menolak sambungan (connection refused)? Klik di sini"}
              </button>

              {showManualToken && (
                <div style={{ marginTop: 8, padding: 10, background: "rgba(0,0,0,0.15)", border: "1px dashed var(--line)" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 11, color: "var(--muted)" }}>
                    Salin seluruh URL dari address bar browser setelah login Google (yang berawalan <code>http://localhost:3000/#access_token=...</code>) dan tempel di bawah:
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="Tempel URL callback di sini..."
                      value={manualTokenInput}
                      onChange={(e) => setManualTokenInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        background: "var(--bg)",
                        border: "1px solid var(--line-strong)",
                        color: "var(--ink)",
                        fontSize: 12,
                        fontFamily: "monospace",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void processAuthHash(manualTokenInput)}
                      disabled={!manualTokenInput.trim() || authBusy}
                      className="mono"
                      style={{
                        padding: "6px 14px",
                        background: "var(--accent)",
                        color: "var(--accent-ink)",
                        border: "none",
                        fontWeight: 700,
                        fontSize: 11,
                      }}
                    >
                      MASUK
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "var(--s-3) 0" }}>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
              <span className="mono muted" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                ATAU DENGAN EMAIL
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            </div>

            <form onSubmit={(e) => void handleAuthSubmit(e)} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                  style={{
                    flex: "1 1 200px",
                    padding: "8px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--line-strong)",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                />
                <input
                  type="password"
                  placeholder="Kata Sandi (min. 6 karakter)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  required
                  minLength={6}
                  style={{
                    flex: "1 1 200px",
                    padding: "8px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--line-strong)",
                    color: "var(--ink)",
                    fontSize: 13,
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="submit"
                    disabled={authBusy}
                    className="mono"
                    style={{
                      padding: "8px 18px",
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                      border: "none",
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: "0.08em",
                    }}
                  >
                    {authBusy ? "MEMPROSES..." : authMode === "login" ? "MASUK" : "DAFTAR AKUN BARU"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode((m) => (m === "login" ? "register" : "login"));
                      setAuthMsg(null);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--ink)",
                      fontSize: 12,
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    {authMode === "login" ? "Belum punya akun? Buat akun" : "Sudah punya akun? Masuk"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
        {authMsg && (
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 12,
              color: authMsg.error ? "var(--danger)" : "var(--ok)",
            }}
          >
            {authMsg.text}
          </p>
        )}
      </div>

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
