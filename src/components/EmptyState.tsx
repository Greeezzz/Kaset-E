import type { ReactNode } from "react";

interface Props {
  kode?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ kode, title, hint, action }: Props) {
  return (
    <div
      className="bracketed page-enter"
      style={{
        display: "grid",
        placeItems: "center",
        gap: "var(--s-2)",
        padding: "var(--s-12) var(--s-6)",
        textAlign: "center",
        border: "1px dashed var(--line)",
        maxWidth: 440,
        margin: "0 auto",
      }}
    >
      {kode && (
        <span className="label" aria-hidden="true" style={{ letterSpacing: "0.1em" }}>
          {kode}
        </span>
      )}
      <h3 style={{ fontSize: 16 }}>{title}</h3>
      {hint && (
        <p className="muted" style={{ margin: 0, maxWidth: 320 }}>
          {hint}
        </p>
      )}
      {action}
    </div>
  );
}
