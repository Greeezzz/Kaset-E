import { runningInTauri } from "../../lib/tauri";

export function Settings() {
  return (
    <section style={{ padding: "var(--s-4)", maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>Settings</h1>

      <dl
        style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--s-2) var(--s-4)" }}
      >
        <dt className="muted">Shell</dt>
        <dd style={{ margin: 0 }}>{runningInTauri ? "Tauri (desktop)" : "Browser (mock)"}</dd>

        <dt className="muted">Tema</dt>
        <dd style={{ margin: 0 }}>Gelap (mode terang nanti)</dd>

        <dt className="muted">Data</dt>
        <dd style={{ margin: 0 }}>Lokal saja — tanpa server, tanpa telemetri.</dd>
      </dl>

      <p className="muted" style={{ marginTop: "var(--s-6)", fontSize: 13 }}>
        Kaset adalah proyek pribadi/edukasi dan tidak berafiliasi dengan Google atau YouTube.
      </p>
    </section>
  );
}
