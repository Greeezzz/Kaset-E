import { CoverArt } from "./CoverArt";

interface Props {
  /** Kunci cover lagu-lagu pertama playlist; maksimal 4 dipakai. */
  coverKeys: string[];
  title: string;
  size?: number;
}

/**
 * Cover playlist dari mosaik 4 lagu pertamanya.
 *
 * Kenapa mosaik dan bukan cover khusus: cover kustom butuh storage gambar di
 * Rust, migrasi kolom, dan pembersihan berkas yatim — semuanya belum ada.
 * Mosaik tidak butuh apa pun: keempat cover lagu sudah tersimpan di cache
 * `covers` dari fitur yang sudah jalan, jadi tinggal digabung saat render.
 *
 * Kalau playlist belum punya lagu, tampilkan satu placeholder generatif —
 * bukan kotak kosong, dan bukan empat kotak kosong yang berisik.
 */
export function PlaylistCover({ coverKeys, title, size = 44 }: Props) {
  const kunci = coverKeys.slice(0, 4);

  if (kunci.length === 0) {
    return <CoverArt coverKey={null} title={title} size={size} radius={0} />;
  }

  if (kunci.length < 4) {
    // Satu atau dua lagu: mosaik penuh akan penuh kotak kosong. Satu cover
    // besar lebih jujur daripada grid yang bolong.
    return <CoverArt coverKey={kunci[0]} title={title} size={size} radius={0} />;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 1,
        background: "var(--line)",
        overflow: "hidden",
      }}
    >
      {kunci.map((k, i) => (
        <div key={`${k}-${i}`} style={{ overflow: "hidden" }}>
          <CoverArt coverKey={k} title={title} size={size / 2} radius={0} />
        </div>
      ))}
    </div>
  );
}
