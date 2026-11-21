import type { Route } from "../routes";
import { T } from "../../lib/strings";

const ITEMS: { id: Route; label: string }[] = [
  // Satu bahasa untuk semua label UI (DESIGN-LAYOUT bagian 7).
  { id: "search", label: T.navCari },
  { id: "library", label: T.navLibrary },
  { id: "settings", label: T.navPengaturan },
];

/**
 * Sidebar kiri.
 *
 * Scroll-nya sendiri (DESIGN-LAYOUT bagian 1): header dan navigasi tetap di
 * tempat, hanya daftar library yang bergulir. Kalau seluruh sidebar ikut
 * scroll, tombol navigasi bisa hilang ke atas saat playlist banyak.
 */
export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav
      aria-label="Navigasi utama"
      style={{
        borderRight: "1px solid var(--line)",
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Kepala panel gaya sistem: nomor + judul, mono caps. */}
      <div
        style={{
          padding: "var(--s-4) var(--s-4) var(--s-2)",
          display: "flex",
          alignItems: "baseline",
          gap: "var(--s-2)",
          flex: "0 0 auto",
        }}
      >
        <span
          className="mono muted"
          style={{ fontSize: 11, letterSpacing: "0.14em" }}
          aria-hidden="true"
        >
          01 /
        </span>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {T.navLibrary}
        </span>
      </div>

      <div
        style={{
          padding: "0 var(--s-3) var(--s-3)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flex: "0 0 auto",
        }}
      >
        {ITEMS.map((it) => {
          const aktif = route === it.id;
          return (
            <button
              key={it.id}
              type="button"
              aria-current={aktif ? "page" : undefined}
              onClick={() => onNavigate(it.id)}
              style={{
                padding: "10px var(--s-3)",
                minHeight: 40,
                textAlign: "left",
                // Item aktif = blok kuning dengan teks hitam. JANGAN teks kuning
                // di atas latar terang — kontrasnya gagal (DESIGN-ENDFIELD §3).
                background: aktif ? "var(--accent)" : "transparent",
                color: aktif ? "var(--accent-ink)" : "var(--ink)",
                border: "none",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: aktif ? 600 : 400,
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      {/* Area daftar library nanti masuk di sini (langkah 3). Sementara hanya
          pemisah supaya struktur scroll-nya sudah benar. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          borderTop: "1px solid var(--line)",
          padding: "var(--s-3)",
        }}
      >
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Daftar playlist menyusul.
        </p>
      </div>
    </nav>
  );
}
