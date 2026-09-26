import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Button from "./Button";
import "./ui.css";

export default function Dialog({ open, onClose, children, labelledBy, wide = false }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy?: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const focusable = ref.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], input, select, textarea");
    focusable?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="k-dialog-overlay" onClick={onClose}>
      <div ref={ref} className={`k-dialog ${wide ? "k-dialog--wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

type ConfirmOptions = { title: string; description?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean };

/** window.confirm の置き換え。`await confirm({...})` で利用者の選択を受け取る。 */
export function useConfirm(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })), []);
  const close = useCallback(
    (value: boolean) => {
      state?.resolve(value);
      setState(null);
    },
    [state],
  );
  const cancel = useCallback(() => close(false), [close]);
  const element = (
    <Dialog open={!!state} onClose={cancel} labelledBy="k-confirm-title">
      {state && (
        <div className="k-confirm">
          <h2 id="k-confirm-title" className="k-confirm__title">
            {state.title}
          </h2>
          {state.description && <div className="k-confirm__desc">{state.description}</div>}
          <div className="k-confirm__actions">
            <Button variant="ghost" onClick={cancel}>
              {state.cancelLabel ?? "キャンセル"}
            </Button>
            <Button variant={state.danger ? "danger-solid" : "primary"} onClick={() => close(true)} data-autofocus>
              {state.confirmLabel ?? "OK"}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
  return [element, ask];
}
