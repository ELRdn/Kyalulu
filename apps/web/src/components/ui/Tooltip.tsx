import type { ReactNode } from "react";
import "./ui.css";

export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="k-tooltip-wrap">
      {children}
      <span className="k-tooltip" role="tooltip">
        {label}
      </span>
    </span>
  );
}
