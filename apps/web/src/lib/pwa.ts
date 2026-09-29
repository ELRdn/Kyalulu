/// <reference types="vite/client" />
import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type PwaState = {
  enabled: boolean;
  online: boolean;
  installed: boolean;
  installable: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  busy: boolean;
  error: string | null;
};

export function canUsePwa(protocol: string, secure: boolean, electron: boolean) {
  return (protocol === "https:" || protocol === "http:") && secure && !electron;
}

const enabled = typeof window !== "undefined" && canUsePwa(location.protocol, window.isSecureContext, "electronAPI" in window || /Electron\//.test(navigator.userAgent));
let state: PwaState = {
  enabled, online: typeof navigator === "undefined" || navigator.onLine,
  installed: false, installable: false, offlineReady: false,
  updateAvailable: false, busy: false, error: null,
};
const listeners = new Set<() => void>();
const publish = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const usePwa = () => useSyncExternalStore(subscribe, () => state, () => state);
let deferredPrompt: InstallPrompt | null = null;
let registration: ServiceWorkerRegistration | undefined;
let requestedUpdate = false;
let updateTimeout: ReturnType<typeof setTimeout> | undefined;
let started = false;

// Capture beforeinstallprompt when the shell module loads, including StrictMode.
if (enabled) {
  const standalone = window.matchMedia("(display-mode: standalone)");
  state.installed = standalone.matches;
  standalone.addEventListener("change", () => publish({ installed: standalone.matches }));
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPrompt;
    publish({ installable: true });
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    publish({ installed: true, installable: false });
  });
  window.addEventListener("online", () => publish({ online: true }));
  window.addEventListener("offline", () => publish({ online: false }));
}

export async function startPwa() {
  if (started || !enabled || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  started = true;
  const sw = navigator.serviceWorker;
  sw.addEventListener("controllerchange", () => {
    // First install or another tab must never reload an active conversation.
    if (requestedUpdate) { clearTimeout(updateTimeout); window.location.reload(); }
  });
  sw.addEventListener("message", (event) => {
    if (event.data?.type === "UPDATE_BLOCKED") {
      requestedUpdate = false;
      clearTimeout(updateTimeout);
      publish({ busy: false, error: "ほかのKyaluluタブやウィンドウを閉じてから更新してください。" });
    }
  });
  try {
    const base = new URL(import.meta.env.BASE_URL, document.baseURI);
    registration = await sw.register(new URL("sw.js", base).href, { scope: base.pathname, updateViaCache: "none" });
    const refresh = () => publish({ offlineReady: Boolean(registration?.active), updateAvailable: Boolean(registration?.waiting) });
    const watch = () => {
      const worker = registration?.installing;
      worker?.addEventListener("statechange", () => {
        refresh();
        if (worker.state === "redundant") publish({ error: "アプリの保存・更新に失敗しました。接続を確認して再度お試しください。" });
      });
    };
    registration.addEventListener("updatefound", watch);
    watch();
    refresh();
    // Check on return, not during background generation; no automatic activation.
    let lastCheck = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && navigator.onLine && Date.now() - lastCheck > 60_000) {
        lastCheck = Date.now();
        void registration?.update().catch(() => {});
      }
    });
  } catch {
    started = false;
    publish({ error: "オフライン用の準備ができませんでした。オンラインで引き続き利用できます。" });
  }
}

export async function installPwa() {
  const prompt = deferredPrompt;
  if (!prompt || state.busy) return;
  deferredPrompt = null;
  publish({ busy: true, installable: false, error: null });
  try {
    await prompt.prompt();
    await prompt.userChoice; // appinstalled is the authoritative success signal.
  } catch { publish({ error: "インストールできませんでした。ブラウザのメニューから再度お試しください。" }); }
  finally { publish({ busy: false }); }
}

export function applyPwaUpdate() {
  if (!registration?.waiting || state.busy || !state.online) return;
  // Explicit confirmation also protects drafts outside the conversation page.
  if (!window.confirm("アプリを更新して再読み込みします。生成中の応答や未保存の入力が失われる場合があります。保存・停止してから更新してください。")) return;
  requestedUpdate = true;
  publish({ busy: true, error: null });
  registration.waiting.postMessage({ type: "APPLY_UPDATE" });
  updateTimeout = setTimeout(() => {
    requestedUpdate = false;
    publish({ busy: false, error: "更新を完了できませんでした。接続を確認し、もう一度お試しください。" });
  }, 15_000);
}

export async function checkPwaUpdate() {
  if (state.busy || !state.online) return;
  publish({ busy: true, error: null });
  try { if (registration) await registration.update(); else await startPwa(); }
  catch { publish({ error: "更新を確認できませんでした。接続を確認してください。" }); }
  finally { publish({ busy: false }); }
}
