import { useEffect, useRef, type ReactNode } from "react";
import "./ui.css";

/** 右/下から出るシート。side: "right"(デスクトップContextPanel等) | "bottom"(モバイル) */
export default function Sheet({
  open,
  onClose,
  side = "right",
  width = "min(420px, 92vw)",
  children,
  topOffset = 0,
  label = '設定パネル',
}: {
  open: boolean;
  onClose: () => void;
  side?: "right" | "bottom";
  width?: string;
  children: ReactNode;
  topOffset?: number;
  label?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !panel.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current;
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'))
      .filter(node => node.getClientRects().length && !node.closest('[inert]'));
    (focusable()[0] ?? element).focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      const panels = document.querySelectorAll('.k-sheet[aria-modal="true"]');
      if (panels[panels.length - 1] !== element) return;
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open]);
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
      {open && <div className="k-sheet-overlay" aria-hidden="true" onClick={onClose} style={{ top: topOffset }} />}
      <div ref={panel} tabIndex={-1} className="k-sheet" role="dialog" aria-label={label} aria-modal={open || undefined} aria-hidden={!open} inert={!open} style={{ ...style, visibility: open ? "visible" : "hidden" }}>
        {children}
      </div>
    </>
  );
}
