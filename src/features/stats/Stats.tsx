import { useEffect, useMemo, useState } from "react";
import { invoke, runningInTauri } from "../../lib/tauri";
import { T } from "../../lib/strings";

/**
 * Layar Stats — Fase 4b.
 *
 * Semua angka dihitung di Rust dari tabel `listen_events`; layar ini hanya
 * menampilkan. Offset zona waktu dikirim dari sini karena browser tahu zona
 * pengguna dan Rust tidak — tanpa itu, mendengar jam 23:00 WIB akan muncul di
 * kolom jam 16:00 dan streak harian salah hari.
 */

type Rentang = "hari" | "minggu" | "bulan" | "tahun" | "semua";

interface LaguTeratas {
  videoId: string;
  judul: string;
  artis: string;
  totalMs: number;
  putaran: number;
}

interface ArtisTeratas {
  artis: string;
  totalMs: number;
  putaran: number;
  jumlahLagu: number;
}

interface Statistik {
  totalMs: number;
  totalPutaran: number;
  totalLaguUnik: number;
  totalArtisUnik: number;
  streakHari: number;
  laguTeratas: LaguTeratas[];
  artisTeratas: ArtisTeratas[];
  perJam: { jam: number; totalMs: number }[];
  perHari: { tanggal: string; totalMs: number }[];
}

/**
 * Durasi dalam bentuk yang enak dibaca.
 *
 * Kalau di bawah satu jam, tampilkan menit — "0,3 jam" tidak membantu siapa pun.
 */
function durasi(ms: number): string {
  if (ms <= 0) return "0 mnt";
  const menit = Math.round(ms / 60_000);
  if (menit < 60) return `${menit} mnt`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${jam} jam` : `${jam} jam ${sisa} mnt`;
}

const RENTANG: { id: Rentang; label: string }[] = [
  { id: "hari", label: "24 JAM" },
  { id: "minggu", label: "MINGGU" },
  { id: "bulan", label: "BULAN" },
  { id: "tahun", label: "TAHUN" },
  { id: "semua", label: "SEMUA" },
];

export function Stats() {
  const [rentang, setRentang] = useState<Rentang>("minggu");
  const [data, setData] = useState<Statistik | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(true);

  // `getTimezoneOffset()` mengembalikan menit ke BARAT UTC (WIB = -420), jadi
  // tandanya dibalik agar sesuai yang diharapkan backend.
  const tzOffsetMin = -new Date().getTimezoneOffset();

  useEffect(() => {
    let batal = false;
    setMemuat(true);
    setError(null);
    if (!runningInTauri) {
      setMemuat(false);
      setData(null);
      return;
    }
    invoke<Statistik>("listen_stats", { rentang, tzOffsetMin, limit: 15 })
      .then((r) => {
        if (!batal) setData(r);
      })
      .catch((e: unknown) => {
        if (!batal) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!batal) setMemuat(false);
      });
    return () => {
      batal = true;
    };
  }, [rentang, tzOffsetMin]);

  const jamMaks = useMemo(
    () => Math.max(1, ...(data?.perJam.map((j) => j.totalMs) ?? [1])),
    [data],
  );

  return (
    <section style={{ padding: "var(--s-6) var(--s-6) var(--s-8)", maxWidth: 860 }}>
      <header style={{ marginBottom: "var(--s-5)" }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 34,
            letterSpacing: "0.02em",
            margin: 0,
          }}
        >
          {T.statsJudul}
        </h1>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {T.statsSubjudul}
        </p>
      </header>

      <div style={{ display: "flex", gap: 4, marginBottom: "var(--s-5)" }}>
        {RENTANG.map((r) => {
          const aktif = rentang === r.id;
          return (
            <button
              key={r.id}
              onClick={() => setRentang(r.id)}
              className="mono"
              style={{
                padding: "6px 12px",
                fontSize: 11,
                letterSpacing: "0.08em",
                border: "1px solid var(--line-strong)",
                background: aktif ? "var(--accent)" : "transparent",
                color: aktif ? "var(--accent-ink)" : "var(--ink)",
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {error && <p style={{ color: "var(--danger)", fontSize: 13 }}>{T.statsGagal(error)}</p>}

      {memuat && <p className="muted">{T.memuat}</p>}

      {!memuat && !error && !runningInTauri && <p className="muted">{T.statsHanyaDesktop}</p>}

      {!memuat && !error && data && data.totalMs === 0 && (
        <div
          style={{
            border: "1px solid var(--line)",
            padding: "var(--s-5)",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>{T.statsKosong}</p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {T.statsKosongHint}
          </p>
        </div>
      )}

      {!memuat && !error && data && data.totalMs > 0 && (
        <>
          {/* Ringkasan angka besar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 1,
              background: "var(--line)",
              border: "1px solid var(--line)",
              marginBottom: "var(--s-6)",
            }}
          >
            <Kotak label={T.statsTotalWaktu} nilai={durasi(data.totalMs)} />
            <Kotak label={T.statsPutaran} nilai={String(data.totalPutaran)} />
            <Kotak label={T.statsLaguUnik} nilai={String(data.totalLaguUnik)} />
            <Kotak label={T.statsArtisUnik} nilai={String(data.totalArtisUnik)} />
            <Kotak
              label={T.statsStreak}
              nilai={data.streakHari > 0 ? `${data.streakHari} hari` : "—"}
            />
          </div>

          {/* Heatmap jam */}
          <Bagian judul={T.statsPerJam}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
              {data.perJam.map((j) => {
                const tinggi = Math.max(2, Math.round((j.totalMs / jamMaks) * 84));
                return (
                  <div
                    key={j.jam}
                    title={`${String(j.jam).padStart(2, "0")}:00 — ${durasi(j.totalMs)}`}
                    style={{
                      flex: 1,
                      height: tinggi,
                      background: j.totalMs > 0 ? "var(--accent)" : "var(--panel-2)",
                      alignSelf: "flex-end",
                    }}
                  />
                );
              })}
            </div>
            <div
              className="mono muted"
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 9,
                marginTop: 4,
              }}
            >
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </Bagian>

          {/* Lagu teratas */}
          <Bagian judul={T.statsLaguTeratas}>
            <Daftar
              baris={data.laguTeratas.map((l) => ({
                kunci: l.videoId,
                utama: l.judul,
                kedua: l.artis,
                kanan: durasi(l.totalMs),
                tambahan: l.putaran > 0 ? `${l.putaran}x` : "",
              }))}
              kosong={T.statsTidakAdaData}
            />
          </Bagian>

          {/* Artis teratas */}
          <Bagian judul={T.statsArtisTeratas}>
            <Daftar
              baris={data.artisTeratas.map((a) => ({
                kunci: a.artis,
                utama: a.artis,
                kedua: `${a.jumlahLagu} lagu`,
                kanan: durasi(a.totalMs),
                tambahan: a.putaran > 0 ? `${a.putaran}x` : "",
              }))}
              kosong={T.statsTidakAdaData}
            />
          </Bagian>

          <p className="muted" style={{ fontSize: 11, marginTop: "var(--s-5)" }}>
            {T.statsCatatanData}
          </p>
        </>
      )}
    </section>
  );
}

function Kotak({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div style={{ background: "var(--panel)", padding: "var(--s-4)" }}>
      <div className="mono muted" style={{ fontSize: 9, letterSpacing: "0.1em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, lineHeight: 1.1 }}>
        {nilai}
      </div>
    </div>
  );
}

function Bagian({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "var(--s-6)" }}>
      <h2
        className="mono"
        style={{ fontSize: 10, letterSpacing: "0.12em", margin: "0 0 var(--s-3)" }}
      >
        {judul}
      </h2>
      {children}
    </div>
  );
}

function Daftar({
  baris,
  kosong,
}: {
  baris: { kunci: string; utama: string; kedua: string; kanan: string; tambahan: string }[];
  kosong: string;
}) {
  if (baris.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 13 }}>
        {kosong}
      </p>
    );
  }
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {baris.map((b, i) => (
        <li
          key={b.kunci}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "7px 0",
            borderTop: i === 0 ? "none" : "1px solid var(--line)",
          }}
        >
          <span
            className="mono muted"
            style={{ fontSize: 10, width: 18, textAlign: "right", flexShrink: 0 }}
          >
            {i + 1}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span
              style={{
                display: "block",
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {b.utama}
            </span>
            <span
              className="muted"
              style={{
                display: "block",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {b.kedua}
            </span>
          </span>
          {b.tambahan && (
            <span className="mono muted" style={{ fontSize: 10, flexShrink: 0 }}>
              {b.tambahan}
            </span>
          )}
          <span
            className="mono"
            style={{ fontSize: 11, flexShrink: 0, width: 72, textAlign: "right" }}
          >
            {b.kanan}
          </span>
        </li>
      ))}
    </ol>
  );
}
