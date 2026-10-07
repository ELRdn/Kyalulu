import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Button from "./Button";
import "./ui.css";

export default function Dialog({ open, onClose, children, labelledBy, label, wide = false, contentClassName, overlayClassName }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy?: string; label?: string; wide?: boolean; contentClassName?: string; overlayClassName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const focusable = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("button, [href], input, select, textarea");
    focusable?.focus();
    return () => {
      dialog.close();
      previous?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} className={overlayClassName ?? "k-dialog-overlay"} aria-modal="true" aria-labelledby={labelledBy} aria-label={label} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={contentClassName ?? `k-dialog ${wide ? "k-dialog--wide" : ""}`}>
        {children}
      </div>
    </dialog>
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
