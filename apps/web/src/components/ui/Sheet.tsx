import type { ReactNode } from "react";
import "./ui.css";

/** 右/下から出るシート。side: "right"(デスクトップContextPanel等) | "bottom"(モバイル) */
export default function Sheet({
  open,
  onClose,
  side = "right",
  width = "min(420px, 92vw)",
  children,
  topOffset = 0,
}: {
  open: boolean;
  onClose: () => void;
  side?: "right" | "bottom";
  width?: string;
  children: ReactNode;
  topOffset?: number;
}) {
  const style =
    side === "right"
      ? {
          top: topOffset,
          right: 0,
          bottom: 0,
          width,
          transform: open ? "translateX(0)" : "translateX(100%)",
          boxShadow: open ? "var(--overlay-shadow)" : "none",
        }
      : {
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "88vh",
          borderTopLeftRadius: "var(--radius-panel)",
          borderTopRightRadius: "var(--radius-panel)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          boxShadow: open ? "var(--overlay-shadow)" : "none",
        };
  return (
    <>
      {open && <div className="k-sheet-overlay" onClick={onClose} style={{ top: topOffset }} />}
      <div className="k-sheet" role="dialog" aria-modal={open || undefined} aria-hidden={!open} style={{ ...style, visibility: open ? "visible" : "hidden" }}>
        {children}
      </div>
    </>
  );
}
