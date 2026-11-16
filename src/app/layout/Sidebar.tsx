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
            // Item aktif = blok kuning dengan teks hitam. JANGAN teks kuning
            // di atas latar terang — kontrasnya gagal (DESIGN-ENDFIELD §3).
            background: route === it.id ? "var(--accent)" : "transparent",
            color: route === it.id ? "var(--accent-ink)" : "var(--ink)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
