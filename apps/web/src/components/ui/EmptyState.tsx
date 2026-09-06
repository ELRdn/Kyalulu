import type { ReactNode } from "react";
import "./ui.css";

export default function EmptyState({
  motif = "✦",
  title,
  description,
  action,
}: {
  motif?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="k-empty">
      <div className="k-empty__motif" aria-hidden="true">
        {motif}
      </div>
      <div className="k-empty__title">{title}</div>
      {description && <div className="k-empty__desc">{description}</div>}
      {action}
    </div>
  );
}
