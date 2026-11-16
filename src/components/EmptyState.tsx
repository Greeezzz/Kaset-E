import type { ReactNode } from "react";

interface Props {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: Props) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        gap: "var(--s-2)",
        padding: "var(--s-12) var(--s-4)",
        textAlign: "center",
      }}
    >
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
