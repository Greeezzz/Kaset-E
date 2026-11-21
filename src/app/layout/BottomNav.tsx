import type { Route } from "../routes";
import { T } from "../../lib/strings";

const ITEMS: { id: Route; label: string }[] = [
  // Satu bahasa untuk semua label UI (DESIGN-LAYOUT bagian 7). Sebelumnya
  // campur: "Search" di sidebar, "ANTREAN" di panel kanan.
  { id: "search", label: T.navCari },
  { id: "library", label: T.navLibrary },
  { id: "settings", label: T.navPengaturan },
];

export function BottomNav({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav
      aria-label="Navigasi utama"
      style={{
        display: "flex",
        height: "var(--bottomnav-h)",
        borderTop: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {ITEMS.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={route === it.id ? "page" : undefined}
          onClick={() => onNavigate(it.id)}
          style={{
            flex: 1,
            minHeight: 44,
            // Lihat catatan di Sidebar: aktif = blok kuning + teks hitam.
            background: route === it.id ? "var(--accent)" : "transparent",
            color: route === it.id ? "var(--accent-ink)" : "var(--ink-muted)",
            fontSize: 13,
          }}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
