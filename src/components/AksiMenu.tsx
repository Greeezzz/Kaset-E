import { useEffect, useRef } from "react";

export interface AksiMenu {
  /** Label yang dibaca pengguna. */
  label: string;
  /** Dijalankan setelah menu ditutup. */
  onClick: () => void;
  /** Warna bahaya (merah) untuk aksi merusak seperti hapus. */
  bahaya?: boolean;
  /** Nonaktifkan tanpa menyembunyikan — mis. "Hapus" saat lagu bukan bagian playlist. */
  nonaktif?: boolean;
}

interface Props {
  aksi: AksiMenu[];
  onClose: () => void;
  /** Elemen pemicu, untuk menghitung posisi dan mengembalikan fokus. */
  anchor?: HTMLElement | null;
}

/**
 * Menu aksi bersama gaya Endfield (MVP.md Fase 1.5, DESIGN-LAYOUT §3.3).
 *
 * Sebelum ini ada empat implementasi menu yang hampir sama — di Sidebar,
 * TrackRow, PlaylistTable, dan PlaylistPage. Semuanya menduplikasi gaya,
 * penutupan-klik-luar, dan Escape, dan sudah mulai menyimpang satu sama lain
 * (padding 40px vs 44px, bayangan berbeda). Satu komponen berarti satu
 * tempat untuk memperbaiki, dan area sentuh 44px dijamin konsisten
 * (DESIGN-LAYOUT §8).
 *
 * Kenapa `position: fixed` dan bukan `absolute` di dalam induk: menu per baris
 * dirender di dalam wadah yang punya `overflow: hidden`/scroll, sehingga menu
 * terpotong di baris terakhir. Dengan `fixed` + posisi dihitung dari elemen
 * pemicu, menu selalu utuh di atas segalanya.
 */
export function AksiMenu({ aksi, onClose, anchor }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Tutup saat klik di luar, Escape, atau halaman di-scroll/di-resize —
  // menu fixed yang tertinggal di tempat lama terlihat seperti bug.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        anchor?.focus();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    // `capture: true` supaya scroll di kontainer mana pun ikut tertangkap.
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [onClose, anchor]);

  // Fokus pindah ke item pertama supaya keyboard langsung bisa dipakai.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  const kotak = anchor?.getBoundingClientRect();
  // Default: di bawah pemicu, rata kanan. Kalau tidak cukup ruang di bawah,
  // buka ke atas — lebih baik menutupi baris di atas daripada keluar layar.
  const ruangBawah = kotak ? window.innerHeight - kotak.bottom : 0;
  const bukaKeAtas = kotak ? ruangBawah < aksi.length * 44 + 16 : false;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Aksi"
      style={{
        position: "fixed",
        top: kotak ? (bukaKeAtas ? undefined : kotak.bottom + 2) : undefined,
        bottom: kotak && bukaKeAtas ? window.innerHeight - kotak.top + 2 : undefined,
        right: kotak ? Math.max(8, window.innerWidth - kotak.right) : undefined,
        zIndex: 60,
        minWidth: 200,
        padding: 4,
        background: "var(--panel)",
        border: "1px solid var(--line-strong)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
      }}
    >
      {aksi.map((a) => (
        <button
          key={a.label}
          type="button"
          role="menuitem"
          disabled={a.nonaktif}
          onClick={() => {
            onClose();
            a.onClick();
          }}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "10px 12px",
            // 44px: area sentuh minimum (DESIGN-LAYOUT §8).
            minHeight: 44,
            background: "transparent",
            border: "none",
            cursor: a.nonaktif ? "not-allowed" : "pointer",
            color: a.nonaktif ? "var(--ink-muted)" : a.bahaya ? "var(--danger)" : "var(--ink)",
            fontSize: 13,
            opacity: a.nonaktif ? 0.55 : 1,
          }}
          onMouseEnter={(e) => {
            if (!a.nonaktif) e.currentTarget.style.background = "var(--accent-dim)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
