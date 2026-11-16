import { EmptyState } from "../../components/EmptyState";

const TABS = ["Playlist", "Favorit", "History"] as const;

export function Library({
  tab,
  setTab,
}: {
  tab: (typeof TABS)[number];
  setTab: (t: (typeof TABS)[number]) => void;
}) {
  return (
    <section style={{ padding: "var(--s-4)" }}>
      <h1 style={{ fontSize: 24, marginBottom: "var(--s-4)" }}>Library</h1>

      <div
        role="tablist"
        aria-label="Bagian library"
        style={{ display: "flex", gap: "var(--s-2)" }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              minHeight: 44,
              padding: "0 var(--s-3)",
              borderRadius: "var(--r-sm)",
              background: tab === t ? "var(--surface-2)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "var(--s-4)" }}>
        <EmptyState
          title={`${tab} masih kosong`}
          hint="Isi library akan muncul di sini setelah backend Fase 1 tersambung."
        />
      </div>
    </section>
  );
}
