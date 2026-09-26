import { useEffect, useState } from "react";

export type ContextPanelMode = "always" | "collapsible";
const LS_MODE = "kyalulu-context-panel-mode";
const LS_OPEN = "kyalulu-context-panel-open";

export function useContextPanelPref() {
  const [mode, setModeState] = useState<ContextPanelMode>(() => (localStorage.getItem(LS_MODE) as ContextPanelMode) || "collapsible");
  // 狭い画面ではパネルが会話を覆うオーバーレイになるため、前回の開閉状態を復元しない
  const [open, setOpenState] = useState<boolean>(() => localStorage.getItem(LS_OPEN) === "1" && window.matchMedia("(min-width: 1024px)").matches);

  useEffect(() => {
    localStorage.setItem(LS_MODE, mode);
  }, [mode]);
  useEffect(() => {
    localStorage.setItem(LS_OPEN, open ? "1" : "0");
  }, [open]);

  return {
    mode,
    setMode: setModeState,
    open: mode === "always" ? true : open,
    setOpen: setOpenState,
  };
}
