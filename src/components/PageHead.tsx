import type { ReactNode } from "react";

interface Props {
  no?: string;
  title: string;
  meta?: ReactNode;
}

/**
 * Kepala halaman bernomor (POLISH-UI §2.1):
 * Format: 02 / JUDUL ———— meta
 * Nomor aria-hidden agar ramah pembaca layar.
 * Konvensi penomoran panel: sidebar = 01, halaman tengah = 02, panel kanan = 03.
 */
export function PageHead({ no = "02", title, meta }: Props) {
  return (
    <header className="page-head">
      <span className="label" aria-hidden="true">
        {no} /
      </span>
      <h1 className="page-head-title">{title}</h1>
      <span className="page-head-rule" aria-hidden="true" />
      {meta && <span className="label">{meta}</span>}
    </header>
  );
}
