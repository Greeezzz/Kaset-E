import type { Route } from "../routes";

const ITEMS: { id: Route; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "library", label: "Library" },
  { id: "settings", label: "Settings" },
];

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav
      aria-label="Navigasi utama"
      style={{
        width: "var(--sidebar-w)",
        flex: `0 0 var(--sidebar-w)`,
        borderRight: "1px solid var(--border)",
        background: "var(--surface)",
        padding: "var(--s-4)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s-1)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 600,
          padding: "var(--s-2) var(--s-3) var(--s-6)",
        }}
      >
        Kaset
      </div>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={route === it.id ? "page" : undefined}
          onClick={() => onNavigate(it.id)}
          style={{
            padding: "var(--s-2) var(--s-3)",
            borderRadius: "var(--r-sm)",
            textAlign: "left",
            background: route === it.id ? "var(--surface-2)" : "transparent",
            color: route === it.id ? "var(--accent)" : "var(--text)",
          }}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
