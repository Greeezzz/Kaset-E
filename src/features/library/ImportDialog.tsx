import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke, listen, runningInTauri } from "../../lib/tauri";
import { T } from "../../lib/strings";

/**
 * Dialog import playlist dari berkas pihak ketiga (Fase 5).
 *
 * Tiga tahap yang terlihat pengguna: pilih berkas → cocokkan (progress) →
 * review & simpan. Tahap review TIDAK dilewati: pencocokan otomatis bisa
 * salah memilih versi (live vs studio), dan pengguna harus bisa melihat
 * sebelum lagu masuk playlist.
 */

type Keputusan = "otomatis" | "review" | "tidakada";

interface Kandidat {
  videoId: string;
  judul: string;
  artis: string;
  durasiMs: number | null;
  coverKey: string;
}

interface BarisCocok {
  judulImpor: string;
  artisImpor: string;
  baris: number;
  kandidat: Kandidat | null;
  skor: number;
  keputusan: Keputusan;
  alasan: string[];
  pilih: boolean;
}

interface RingkasanCocok {
  total: number;
  otomatis: number;
  perluReview: number;
  tidakAda: number;
  batal: boolean;
  baris: BarisCocok[];
}

interface HasilSimpan {
  playlistId: number;
  ditambahkan: number;
  dilewati: number;
}

interface HasilTautan {
  playlistId: number;
  judul: string;
  ditambahkan: number;
  dobel: number;
  dilewati: number;
}

interface Progress {
  selesai: number;
  total: number;
  judul: string;
}

interface Props {
  onClose: () => void;
  /** Dipanggil setelah lagu tersimpan, supaya sidebar ikut segar. */
  onSelesai: (playlistId: number) => void;
}

export function ImportDialog({ onClose, onSelesai }: Props) {
  const [tahap, setTahap] = useState<"pilih" | "cocok" | "review" | "simpan">("pilih");
  const [ringkas, setRingkas] = useState<RingkasanCocok | null>(null);
  const [eksporPesan, setEksporPesan] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namaPlaylist, setNamaPlaylist] = useState("Hasil impor");
  const [hasil, setHasil] = useState<HasilSimpan | null>(null);
  const [filter, setFilter] = useState<"semua" | "review" | "tidakada">("semua");
  const [tautan, setTautan] = useState("");
  const [tautanSibuk, setTautanSibuk] = useState(false);
  const [tautanHasil, setTautanHasil] = useState<HasilTautan | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Progress datang lewat event dari Rust.
  useEffect(() => {
    // `listen` di lib/tauri.ts dibatasi ke EventMap; event impor belum
    // terdaftar di sana, jadi dilewatkan lewat cast yang sempit.
    const un = listen("import://progress" as never, ((p: Progress) => setProgress(p)) as never);
    return () => {
      void un.then((f) => f());
    };
  }, []);

  async function pilihBerkas(file: File) {
    setError(null);
    setTahap("cocok");
    setProgress(null);
    try {
      const isi = await file.text();
      const lagu = await invoke<unknown[]>("import_parse", { isi });
      if (!lagu.length) {
        setError(T.imporKosong);
        setTahap("pilih");
        return;
      }
      const r = await invoke<RingkasanCocok>("import_cocokkan", { lagu });
      setRingkas(r);
      setTahap("review");
    } catch (e) {
      setError(pesan(e, T.imporGagal));
      setTahap("pilih");
    }
  }

  /**
   * Impor playlist YouTube dari tautan.
   *
   * Beda dari impor berkas: tidak ada tahap pencocokan karena lagunya sudah
   * berasal dari YouTube. Satu panggilan ke Rust, satu transaksi database.
   */
  async function imporTautan() {
    const nilai = tautan.trim();
    if (!nilai || tautanSibuk) return;
    setError(null);
    setTautanHasil(null);
    setTautanSibuk(true);
    try {
      const r = await invoke<HasilTautan>("import_tautan", {
        permintaan: { tautan: nilai },
      });
      setTautanHasil(r);
      // Sidebar dan halaman playlist ikut segar; dialog tetap terbuka supaya
      // pengguna bisa membaca berapa lagu yang dobel/dilewati.
      onSelesai(r.playlistId);
    } catch (e) {
      setError(pesan(e, T.imporTautanGagal));
    } finally {
      setTautanSibuk(false);
    }
  }

  async function batalkan() {
    try {
      await invoke("import_batal");
    } catch {
      // Kalau batal gagal dikirim, job tetap selesai sendiri; tidak berbahaya.
    }
  }

  function ubahPilih(idx: number, nilai: boolean) {
    setRingkas((r) => {
      if (!r) return r;
      const baris = r.baris.map((b, i) => (i === idx ? { ...b, pilih: nilai } : b));
      return { ...r, baris };
    });
  }

  function pilihSemuaReview(nilai: boolean) {
    setRingkas((r) => {
      if (!r) return r;
      const baris = r.baris.map((b) =>
        b.keputusan === "review" && b.kandidat ? { ...b, pilih: nilai } : b,
      );
      return { ...r, baris };
    });
  }

  /**
   * Ekspor daftar lagu yang TIDAK masuk playlist ke CSV.
   *
   * Isinya: baris "tidak ditemukan" dan baris "perlu diperiksa" yang tidak
   * dicentang. Itu yang perlu ditindak lanjuti manual — lagu otomatis tidak
   * perlu dilihat lagi.
   *
   * Path dipilih lewat dialog simpan native, jadi pengguna tahu ke mana
   * berkasnya pergi. Di browser (tanpa Tauri) tombol ini tidak ditampilkan.
   */
  async function eksporTidakMasuk() {
    if (!ringkas) return;
    setEksporPesan(null);
    try {
      const path = await save({
        title: T.imporEksporJudul,
        defaultPath: `kaset-tidak-masuk-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return; // dibatalkan pengguna
      const jumlah = await invoke<number>("import_ekspor_tidak_masuk", {
        baris: ringkas.baris,
        path,
      });
      setEksporPesan(T.imporEksporBerhasil(jumlah, path));
    } catch (e) {
      setEksporPesan(T.imporEksporGagal(e instanceof Error ? e.message : String(e)));
    }
  }

  async function simpan() {
    if (!ringkas) return;
    const dipilih = ringkas.baris.filter((b) => b.pilih && b.kandidat);
    if (!dipilih.length) {
      setError(T.imporTidakAdaYangDipilih);
      return;
    }
    setTahap("simpan");
    setError(null);
    try {
      const r = await invoke<HasilSimpan>("import_simpan", {
        pilihan: {
          playlistId: null,
          namaPlaylist,
          lagu: dipilih.map((b) => ({
            videoId: b.kandidat!.videoId,
            judul: b.kandidat!.judul,
            artis: b.kandidat!.artis,
            album: null,
            durasiMs: b.kandidat!.durasiMs,
          })),
        },
      });
      setHasil(r);
      onSelesai(r.playlistId);
    } catch (e) {
      setError(pesan(e, T.imporGagal));
      setTahap("review");
    }
  }

  const terpilih = ringkas?.baris.filter((b) => b.pilih && b.kandidat).length ?? 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={T.imporJudul}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, calc(100vw - 32px))",
          maxHeight: "min(720px, calc(100vh - 32px))",
          display: "flex",
          flexDirection: "column",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--s-2)",
            padding: "var(--s-3)",
            borderBottom: "1px solid var(--line)",
            flex: "0 0 auto",
          }}
        >
          <span className="label">{T.imporJudul}</span>
          <span style={{ flex: 1, borderTop: "1px solid var(--line)" }} aria-hidden="true" />
          <button
            type="button"
            onClick={onClose}
            aria-label={T.tutup}
            style={{ width: 44, height: 44, color: "var(--ink-muted)" }}
          >
            ✕
          </button>
        </header>

        <div style={{ overflowY: "auto", flex: 1, minHeight: 0, padding: "var(--s-3)" }}>
          {/* Tahap 1: pilih berkas */}
          {tahap === "pilih" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>{T.imporHint}</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{
                  minHeight: 44,
                  padding: "0 var(--s-4)",
                  alignSelf: "flex-start",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.1em",
                  fontWeight: 600,
                }}
              >
                {T.imporPilihBerkas}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,.txt,text/csv,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void pilihBerkas(f);
                }}
              />

              {/* Jalur kedua: tautan playlist YouTube. Tidak butuh pencocokan,
                  jadi hasilnya langsung masuk playlist baru. */}
              {runningInTauri && (
                <>
                  <hr
                    style={{
                      width: "100%",
                      border: 0,
                      borderTop: "1px solid var(--line)",
                      margin: "var(--s-2) 0 0",
                    }}
                  />
                  <span className="label">{T.imporTautanJudul}</span>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>
                    {T.imporTautanHint}
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void imporTautan();
                    }}
                    style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}
                  >
                    <input
                      type="url"
                      className="k-input"
                      value={tautan}
                      onChange={(e) => setTautan(e.target.value)}
                      placeholder={T.imporTautanPlaceholder}
                      aria-label={T.imporTautanLabel}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={tautanSibuk}
                      style={{ flex: "1 1 260px", minWidth: 0 }}
                    />
                    <button
                      type="submit"
                      disabled={!tautan.trim() || tautanSibuk}
                      style={{
                        minHeight: 44,
                        padding: "0 var(--s-4)",
                        border: "1px solid var(--line-strong)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        letterSpacing: "0.1em",
                        fontWeight: 600,
                        opacity: !tautan.trim() || tautanSibuk ? 0.55 : 1,
                      }}
                    >
                      {tautanSibuk ? T.imporTautanSibuk : T.imporTautanTombol}
                    </button>
                  </form>
                  {tautanHasil && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mono"
                      style={{ margin: 0, fontSize: 12, color: "var(--ink)" }}
                    >
                      {T.imporTautanHasil(
                        tautanHasil.ditambahkan,
                        tautanHasil.dobel,
                        tautanHasil.dilewati,
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Tahap 2: progress */}
          {tahap === "cocok" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
              <p style={{ margin: 0 }} className="mono">
                {progress
                  ? `${T.imporMencocokkan} ${progress.selesai}/${progress.total}`
                  : T.imporMembaca}
              </p>
              {progress && (
                <div
                  role="progressbar"
                  aria-valuenow={progress.selesai}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  style={{ height: 6, background: "var(--panel-2)", overflow: "hidden" }}
                >
                  <div
                    style={{
                      width: `${(progress.selesai / Math.max(1, progress.total)) * 100}%`,
                      height: "100%",
                      background: "var(--accent)",
                      transition: "width 200ms linear",
                    }}
                  />
                </div>
              )}
              <p className="mono muted" style={{ margin: 0, fontSize: 11 }}>
                {progress?.judul ?? ""}
              </p>
              <button
                type="button"
                onClick={() => void batalkan()}
                style={{
                  minHeight: 44,
                  padding: "0 var(--s-4)",
                  alignSelf: "flex-start",
                  border: "1px solid var(--line-strong)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  letterSpacing: "0.1em",
                }}
              >
                {T.imporBatalkan}
              </button>
            </div>
          )}

          {/* Tahap 3: review */}
          {tahap === "review" && ringkas && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
              <div style={{ display: "flex", gap: "var(--s-3)", flexWrap: "wrap", fontSize: 12 }}>
                <span className="mono">
                  {T.imporTotal}: <b>{ringkas.total}</b>
                </span>
                <span className="mono" style={{ color: "var(--accent-ink)" }}>
                  {T.imporOtomatis}: <b>{ringkas.otomatis}</b>
                </span>
                <span className="mono">
                  {T.imporReview}: <b>{ringkas.perluReview}</b>
                </span>
                <span className="mono muted">
                  {T.imporTidakAda}: <b>{ringkas.tidakAda}</b>
                </span>
              </div>

              {ringkas.batal && (
                <p className="mono" style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>
                  {T.imporDibatalkan}
                </p>
              )}

              <div style={{ display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
                {(["semua", "review", "tidakada"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    style={{
                      minHeight: 32,
                      padding: "0 var(--s-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      background: filter === f ? "var(--accent)" : "transparent",
                      color: filter === f ? "var(--accent-ink)" : "var(--ink)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {f === "semua"
                      ? T.imporSemua
                      : f === "review"
                        ? T.imporReview
                        : T.imporTidakAda}
                  </button>
                ))}
                {ringkas.perluReview > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => pilihSemuaReview(true)}
                      style={{
                        minHeight: 32,
                        padding: "0 var(--s-2)",
                        fontSize: 11,
                        border: "1px solid var(--line)",
                      }}
                    >
                      {T.imporPilihSemuaReview}
                    </button>
                    <button
                      type="button"
                      onClick={() => pilihSemuaReview(false)}
                      style={{
                        minHeight: 32,
                        padding: "0 var(--s-2)",
                        fontSize: 11,
                        border: "1px solid var(--line)",
                      }}
                    >
                      {T.imporBatalPilihReview}
                    </button>
                  </>
                )}
                {runningInTauri && (ringkas.tidakAda > 0 || ringkas.perluReview > 0) && (
                  <button
                    type="button"
                    onClick={() => void eksporTidakMasuk()}
                    style={{
                      minHeight: 32,
                      padding: "0 var(--s-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.06em",
                      border: "1px solid var(--line-strong)",
                      background: "transparent",
                    }}
                  >
                    {T.imporEkspor}
                  </button>
                )}
              </div>

              {eksporPesan && (
                <p
                  role="status"
                  className="mono"
                  style={{ margin: 0, fontSize: 11, color: "var(--ok)" }}
                >
                  {eksporPesan}
                </p>
              )}

              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {ringkas.baris.map((b, i) => {
                  if (filter === "review" && b.keputusan !== "review") return null;
                  if (filter === "tidakada" && b.keputusan !== "tidakada") return null;
                  return (
                    <li
                      key={`${b.baris}-${b.judulImpor}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--s-2)",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--line)",
                        opacity: b.kandidat ? 1 : 0.55,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={b.pilih}
                        disabled={!b.kandidat}
                        onChange={(e) => ubahPilih(i, e.target.checked)}
                        aria-label={`${T.imporPilih}: ${b.judulImpor}`}
                        style={{ width: 20, height: 20, flex: "0 0 auto" }}
                      />
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
                          {b.kandidat ? b.kandidat.judul : b.judulImpor}
                        </span>
                        <span className="mono muted" style={{ display: "block", fontSize: 11 }}>
                          {b.kandidat
                            ? `${b.kandidat.artis} · ${b.alasan.join(", ")}`
                            : `${b.artisImpor} · ${T.imporTidakKetemu}`}
                        </span>
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          flex: "0 0 auto",
                          color:
                            b.keputusan === "otomatis"
                              ? "var(--ink)"
                              : b.keputusan === "review"
                                ? "var(--ink-muted)"
                                : "var(--danger)",
                        }}
                      >
                        {b.skor.toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Tahap 4: hasil */}
          {tahap === "simpan" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
              {hasil ? (
                <>
                  <p style={{ margin: 0 }} className="mono">
                    {T.imporHasilSimpan(hasil.ditambahkan, hasil.dilewati)}
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      minHeight: 44,
                      padding: "0 var(--s-4)",
                      alignSelf: "flex-start",
                      background: "var(--accent)",
                      color: "var(--accent-ink)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      letterSpacing: "0.1em",
                      fontWeight: 600,
                    }}
                  >
                    {T.selesai}
                  </button>
                </>
              ) : (
                <p style={{ margin: 0 }} className="mono">
                  {T.imporMenyimpan}
                </p>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              style={{
                marginTop: "var(--s-2)",
                padding: "8px 10px",
                borderLeft: "3px solid var(--danger)",
                background: "var(--panel-2)",
                fontSize: 12,
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* Footer: nama playlist + tombol simpan, hanya di tahap review */}
        {tahap === "review" && ringkas && (
          <footer
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--s-2)",
              padding: "var(--s-3)",
              borderTop: "1px solid var(--line)",
              flex: "0 0 auto",
              flexWrap: "wrap",
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--s-2)",
                flex: 1,
                minWidth: 200,
              }}
            >
              <span className="label">{T.imporNamaPlaylist}</span>
              <input
                value={namaPlaylist}
                onChange={(e) => setNamaPlaylist(e.target.value)}
                maxLength={80}
                style={{
                  flex: 1,
                  minHeight: 36,
                  padding: "0 var(--s-2)",
                  background: "var(--panel-2)",
                  border: "1px solid var(--line)",
                  color: "var(--ink)",
                  fontSize: 13,
                }}
              />
            </label>
            <button
              type="button"
              onClick={onClose}
              style={{
                minHeight: 44,
                padding: "0 var(--s-4)",
                border: "1px solid var(--line-strong)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.1em",
              }}
            >
              {T.batal}
            </button>
            <button
              type="button"
              onClick={() => void simpan()}
              disabled={terpilih === 0 || !namaPlaylist.trim()}
              style={{
                minHeight: 44,
                padding: "0 var(--s-4)",
                background: terpilih ? "var(--accent)" : "var(--panel-2)",
                color: terpilih ? "var(--accent-ink)" : "var(--ink-muted)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                letterSpacing: "0.1em",
                fontWeight: 600,
                cursor: terpilih ? "pointer" : "not-allowed",
              }}
            >
              {T.imporSimpanKePlaylist(terpilih)}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

function pesan(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
