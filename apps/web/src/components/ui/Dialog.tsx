import type { ReactNode } from "react";
import "./ui.css";

export default function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="k-dialog-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="k-dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
