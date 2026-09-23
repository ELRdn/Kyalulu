import type { ReactNode } from "react";
import "./ui.css";

type Mascot = "default" | "wink" | "excited" | "shy" | "sleep";

export default function EmptyState({
  motif = "✦",
  mascot,
  title,
  description,
  action,
}: {
  motif?: string;
  /** マスコットの表情。指定時はモチーフ記号の代わりに表示する */
  mascot?: Mascot;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="k-empty">
      {mascot ? (
        <img className="k-empty__mascot" src={`/mascot/face-${mascot}.webp`} alt="" />
      ) : (
        <div className="k-empty__motif" aria-hidden="true">
          {motif}
        </div>
      )}
      <div className="k-empty__title">{title}</div>
      {description && <div className="k-empty__desc">{description}</div>}
      {action}
    </div>
  );
}
