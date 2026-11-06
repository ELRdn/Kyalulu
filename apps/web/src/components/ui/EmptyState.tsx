import type { ReactNode } from "react";
import "./ui.css";

const MASCOT_ART = { default: "pose-wave", wink: "face-smile", excited: "face-excited", shy: "face-shy", sleep: "face-sleep", cry: "pose-cry" } as const;
type Mascot = keyof typeof MASCOT_ART;

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
        <img className="k-empty__mascot" src={`${import.meta.env.BASE_URL}mascot/v2/${MASCOT_ART[mascot]}.webp`} alt="" width={120} height={120} decoding="async" />
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
