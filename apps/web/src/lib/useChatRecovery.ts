import { connectionScope } from './remoteStore';
import { useEffect, useRef, useState } from "react";
import { cancelGeneration, fetchGeneration, fetchRecoveryHistory, type ChatMessage } from "./api";
import { ChatRecovery, RecoveryCheck, reconcileGeneration, generationOutcome, type ChatDraft } from "./chatRecovery";
import { useLanguage } from './appContext';
import { friendlyMessage } from './errors';
import type { ConfirmOptions } from '../components/ui/Dialog';

const notices = {
  ja: { pending: '前の送信は処理中です。結果を確認するまで送信・会話の変更を待ってね。',
    legacy: '旧アプリの未完了記録です。元のタブで保存結果を確認し、旧アプリのタブをすべて閉じた後、「停止して確認」から復旧できます。',
    failed: '前の生成は完了しませんでした。下書きを確認して、必要なら送信してね。',
    check: '送信結果を確認できません。自動再送はしません。', cancel: '停止を確認できません。送信結果の確認を続けます。' },
  en: { pending: 'The previous send is still processing. Wait for its result before sending again or changing the conversation.',
    legacy: 'This pending record came from an older app. Check its saved result in the original tab, close all older app tabs, then use Stop and check to recover.',
    failed: 'The previous generation did not finish. Review the draft and send it if needed.',
    check: 'The send result could not be verified. It will not be resent automatically.',
    cancel: 'Stopping could not be verified. Send-result checks will continue.' },
};
type RecoveryNotice = { kind: keyof typeof notices.ja; detail?: string };

export function useChatRecovery(sessionId: string, onHistory: (messages: (ChatMessage & { model_id?: string })[]) => void,
  confirm:(options:ConfirmOptions)=>Promise<boolean>) {
  const language = useLanguage();
  const identity=useRef(connectionScope()).current;
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
  const [notice, setNotice] = useState<RecoveryNotice | null>(null);
  const [checking, setChecking] = useState(false);
  const [checks] = useState(() => new RecoveryCheck());
  const alive = useRef(true);
  const historyCallback = useRef(onHistory);
  historyCallback.current = onHistory;
  const inputRef = useRef(value.draft);
  const dirtyDraft = useRef(false);
  const cancelling=useRef(false);
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
        (sid,status) => fetchRecoveryHistory(sid,status,AbortSignal.timeout(15000)), () => alive.current&&identity===connectionScope(), persistDirtyDraft);
      if (!resolved) return;
      const { outcome, history, value: next } = resolved;
      if (outcome === "pending") {
        setNotice({ kind: resolved.status?.legacy_recovery_revision===undefined?'pending':'legacy' });
        return;
      }
      historyCallback.current(history!);
      apply(next);
      dirtyDraft.current = false;
      setStorageError(null);
      setNotice(outcome === "failed" ? { kind: 'failed' } : null);
    } catch (e) {
      if (alive.current) setNotice({ kind: 'check', detail: String(e) });
    } finally { if (alive.current) setChecking(false); }
  });
  const rejected = (id: string) => {
    // Only explicit HTTP rejection before generation admission may resolve without GET.
    try {
      if (store.read().pending?.id !== id) return;
      persistDirtyDraft();
      const next = store.settle(id, false);
      if (alive.current) { apply(next); dirtyDraft.current = false; }
    } catch (e) { if (alive.current) setStorageError(String(e)); }
  };
  const cancel = async () => {
    if(cancelling.current)return;
    cancelling.current=true;
    try {
      const pending = store.read().pending;
      if (!pending) return;
      const status=await fetchGeneration(pending.id,sessionId);
      if(!alive.current||identity!==connectionScope()||store.read().pending?.id!==pending.id)return;
      generationOutcome(status,pending,sessionId);
      const revision=status.legacy_recovery_revision;
      if(revision!==undefined){
        const en=language==='en';
        if(!await confirm({title:en?'Recover older pending generation':'旧アプリの未完了生成を復旧',
          description:en?'Have you checked the saved result in the original tab and closed all older app tabs? This marks only the uncommitted generation as interrupted. Input, drafts and saved replies are retained. Nothing is sent automatically.'
            :'元のタブで保存結果を確認し、旧アプリのタブをすべて閉じましたか？ 未確定の生成だけを中断済みにします。入力・下書き・保存済み返信は保持し、自動送信はしません。',
          confirmLabel:en?'Tabs closed; recover':'タブを閉じたので復旧',cancelLabel:en?'Cancel':'キャンセル'}))return;
        if(!alive.current||identity!==connectionScope()||store.read().pending?.id!==pending.id)return;
      }
      await cancelGeneration(pending.id, sessionId,revision);
      if (alive.current&&identity===connectionScope()) await reconcile();
    } catch (e) {
      if (alive.current) setNotice({ kind: 'cancel', detail: String(e) });
    } finally {cancelling.current=false;}
  };
  const erase = () => {
    const next: ChatDraft = { version: 1, draft: '', pending: null };
    dirtyDraft.current = false; if (alive.current) apply(next);
    window.localStorage.removeItem(store.key);
    if (window.localStorage.getItem(store.key) !== null) throw Error('端末の送信下書きを消去できません。');
    if (alive.current) { setStorageError(null); setNotice(null); }
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
  return { input: value.draft, change, pending: value.pending,
    storageError: storageError ? `${language === 'en' ? 'Draft storage failed. Sending remains blocked. ' : '下書きの保存に失敗しました。送信を停止しています。'}${friendlyMessage(storageError, language)}` : null,
    notice: notice ? notices[language][notice.kind] + (notice.detail ? ` ${friendlyMessage(notice.detail, language)}` : '') : null, checking,
    unresolved: !!value.pending || !!storageError, blocked, begin, reconcile, rejected, cancel, erase,
    clearCommand: (text: string) => { if (inputRef.current.trim() === text) change(""); } };
}
