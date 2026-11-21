import type { ItemSaran } from "./useSearchSuggestions";

interface Props {
  items: ItemSaran[];
  /** Indeks yang sedang disorot keyboard; -1 = tidak ada. */
  sorot: number;
  memuat: boolean;
  onPilih: (query: string) => void;
  onHapus: (query: string) => void;
  onKosongkan: () => void;
  onSorot: (index: number) => void;
}

/**
 * Panel saran di bawah kotak pencarian.
 *
 * Dua bagian yang sengaja dibedakan: riwayat (milik user, bisa dihapus) dan
 * saran katalog (dari YouTube, tidak bisa dihapus). Membedakannya penting
 * supaya user tahu mana yang akan tetap ada besok.
 */
export function SuggestionPanel({
  items,
  sorot,
  memuat,
  onPilih,
  onHapus,
  onKosongkan,
  onSorot,
}: Props) {
  const adaRiwayat = items.some((i) => i.jenis === "riwayat");

  if (items.length === 0 && !memuat) return null;

  return (
    <ul
      role="listbox"
      aria-label="Saran pencarian"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        zIndex: 20,
        margin: 0,
        padding: 4,
        listStyle: "none",
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        maxHeight: 320,
        overflowY: "auto",
      }}
    >
      {items.map((item, i) => {
        const disorot = i === sorot;
        return (
          <li
            key={`${item.jenis}:${item.query}`}
            role="option"
            aria-selected={disorot}
            onMouseEnter={() => onSorot(i)}
            onMouseDown={(e) => {
              // Jangan biarkan input kehilangan fokus sebelum klik diproses.
              e.preventDefault();
              onPilih(item.query);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--s-2)",
              padding: "8px 10px",
              cursor: "pointer",
              background: disorot ? "var(--accent-dim)" : "transparent",
              borderLeft: disorot ? "2px solid var(--accent)" : "2px solid transparent",
            }}
          >
            <span
              aria-hidden="true"
              className="mono muted"
              style={{ fontSize: 11, minWidth: 16, opacity: 0.7 }}
            >
              {item.jenis === "riwayat" ? "↺" : "⌕"}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.query}
            </span>
            {item.jenis === "riwayat" && item.hits && item.hits > 1 ? (
              <span className="mono muted" style={{ fontSize: 11 }} title="Berapa kali dicari">
                ×{item.hits}
              </span>
            ) : null}
            {item.jenis === "riwayat" ? (
              <button
                type="button"
                aria-label={`Hapus riwayat ${item.query}`}
                title="Hapus dari riwayat"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onHapus(item.query);
                }}
                style={{
                  minWidth: 24,
                  minHeight: 24,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid transparent",
                  background: "transparent",
                  color: "var(--ink-muted)",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            ) : null}
          </li>
        );
      })}

      {memuat ? (
        <li aria-hidden="true" className="muted" style={{ padding: "6px 10px", fontSize: 12 }}>
          mencari saran…
        </li>
      ) : null}

      {adaRiwayat ? (
        <li style={{ borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4 }}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onKosongkan();
            }}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "6px 10px",
              background: "transparent",
              border: "none",
              color: "var(--ink-muted)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Hapus semua riwayat
          </button>
        </li>
      ) : null}
    </ul>
  );
}
