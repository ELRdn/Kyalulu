import { connectionScope } from './remoteStore';
import { useEffect, useRef, useState } from "react";
import { cancelGeneration, fetchGeneration, fetchHistory, type ChatMessage } from "./api";
import { ChatRecovery, RecoveryCheck, reconcileGeneration, type ChatDraft } from "./chatRecovery";

export function useChatRecovery(sessionId: string, onHistory: (messages: (ChatMessage & { model_id?: string })[]) => void) {
  // Access localStorage inside guarded operations: the getter itself may throw.
  const [store] = useState(() => new ChatRecovery({
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  }, connectionScope(), sessionId));
  const [initial] = useState(() => {
    try { return { value: store.read(), error: null }; }
    catch (e) { return { value: { version: 1, draft: "", pending: null } as ChatDraft, error: String(e) }; }
  });
  const [value, setValue] = useState(initial.value);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checks] = useState(() => new RecoveryCheck());
  const alive = useRef(true);
  const historyCallback = useRef(onHistory);
  historyCallback.current = onHistory;
  const inputRef = useRef(value.draft);
  const dirtyDraft = useRef(false);
  const apply = (next: ChatDraft) => { inputRef.current = next.draft; setValue(next); };

  const change = (draft: string) => {
    inputRef.current = draft;
    setValue(prev => ({ ...prev, draft }));
    try { apply(store.draft(draft)); dirtyDraft.current = false; setStorageError(null); }
    catch (e) { dirtyDraft.current = true; setStorageError(String(e)); }
  };
  const blocked = () => {
    try { return !!store.read().pending || !!storageError; }
    catch { return true; }
  };
  const begin = (id: string, regenerate: boolean, submittedDraft: string) => {
    // Persist the latest edit even if a prior quota/access failure was transient.
    try {
      store.draft(inputRef.current);
      apply(store.begin(id, regenerate, submittedDraft));
      dirtyDraft.current = false;
      setNotice(null);
    } catch (e) { setStorageError(String(e)); throw e; }
  };
  const persistDirtyDraft = () => { if (dirtyDraft.current) store.draft(inputRef.current); };
  const reconcile = () => checks.run(async () => {
    if (!alive.current) return;
    setChecking(true);
    try {
      const resolved = await reconcileGeneration(store, fetchGeneration,
        sid => fetchHistory(sid, AbortSignal.timeout(15000)), () => alive.current, persistDirtyDraft);
      if (!resolved) return;
      const { outcome, history, value: next } = resolved;
      if (outcome === "pending") {
        setNotice("前の送信は処理中です。結果を確認するまで送信・会話の変更を待ってね。");
        return;
      }
      historyCallback.current(history!);
      apply(next);
      dirtyDraft.current = false;
      setStorageError(null);
      setNotice(outcome === "failed" ? "前の生成は完了しませんでした。下書きを確認して、必要なら送信してね。" : null);
    } catch (e) {
      if (alive.current) setNotice(`送信結果を確認できません。自動再送はしません。${String(e)}`);
    } finally { if (alive.current) setChecking(false); }
  });
  const rejected = (id: string) => {
    // Only explicit HTTP rejection before reservation may resolve without GET.
    try {
      if (store.read().pending?.id !== id) return;
      persistDirtyDraft();
      const next = store.settle(id, false);
      if (alive.current) { apply(next); dirtyDraft.current = false; }
    } catch (e) { if (alive.current) setStorageError(String(e)); }
  };
  const cancel = async () => {
    try {
      const pending = store.read().pending;
      if (!pending) return;
      await cancelGeneration(pending.id, sessionId);
      if (alive.current) await reconcile();
    } catch (e) {
      if (alive.current) setNotice(`停止を確認できません。送信結果の確認を続けます。${String(e)}`);
    }
  };
  const reconcileRef = useRef(reconcile);
  reconcileRef.current = reconcile;
  useEffect(() => {
    alive.current = true;
    const resume = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void reconcileRef.current();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== store.key && event.key !== null) return;
      try {
        const next = store.read();
        if (dirtyDraft.current) setValue(prev => ({ ...next, draft: prev.draft }));
        else apply(next);
      } catch (e) { setStorageError(String(e)); }
      resume();
    };
    resume();
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("storage", storage);
    const timer = window.setInterval(resume, 4000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("storage", storage);
    };
  }, [store]);
  return { input: value.draft, change, pending: value.pending, storageError, notice, checking,
    unresolved: !!value.pending || !!storageError, blocked, begin, reconcile, rejected, cancel,
    clearCommand: (text: string) => { if (inputRef.current.trim() === text) change(""); } };
}
