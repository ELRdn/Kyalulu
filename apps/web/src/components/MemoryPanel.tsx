import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMemory,
  deleteMemory,
  fetchSessionMemory,
  listMemories,
  setSessionMemory,
  updateMemory,
  previewMemoryScope,
  migrateMemoryScope,
  clearSessionMemories,
  type MemoryScopePreview,
  type MemoryItem,
  type MemoryType
} from "../lib/api";
import Button from "./ui/Button";
import Icon from "./ui/Icon";
import IconButton from "./ui/IconButton";
import Switch from "./ui/Switch";
import { Textarea } from "./ui/Input";
import "./memory.css";
import MemorySource from './MemorySource';
import { useCapabilities } from '../lib/capabilities';
import { friendlyMessage } from '../lib/errors';
import { useConfirm } from './ui/Dialog';
import { connectionScope } from '../lib/remoteStore';
import { useLanguage } from '../lib/appContext';

export const MEMORY_TYPE_LABEL: Record<'ja' | 'en', Record<MemoryType, string>> = { ja: {
  semantic: "好み・事実",
  episodic: "出来事・約束",
  relationship: "関係"
}, en: { semantic: 'Preferences & facts', episodic: 'Events & promises', relationship: 'Relationships' } };

const TYPES = Object.keys(MEMORY_TYPE_LABEL.ja) as MemoryType[];

/** 会話パネルの「覚えていること」: 記憶の ON/OFF と、記憶の確認・訂正・削除・追加。 */
export default function MemoryPanel({ sessionId, refreshKey, scopeOverride,visible=true }: { sessionId: string; refreshKey: number; scopeOverride?: string;visible?:boolean }) {
  const language = useLanguage(), en = language === 'en', typeLabels = MEMORY_TYPE_LABEL[language];
  const { capabilities } = useCapabilities();
  const [confirmDialog, confirm] = useConfirm();
  const [preview, setPreview] = useState<MemoryScopePreview | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<MemoryType>("semantic");
  const [error, setError] = useState<{cause:unknown} | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const identity = useRef(connectionScope()).current;
  const active = () => mounted.current && identity === connectionScope();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true);
    try {
      const s = await fetchSessionMemory(sessionId);
      if (!active()) return;
      s.scope = scopeOverride ?? s.scope;
      const loaded = await listMemories(s.scope);
      if (id !== sequence.current || !active()) return;
      setEnabled(s.enabled);
      setScope(s.scope);
      setItems(loaded);
      setError(null);
    } catch (error) {
      if (id === sequence.current && active()) setError({cause:error});
    } finally {
      if (id === sequence.current && active()) setLoading(false);
    }
  }, [sessionId, scopeOverride]);

  useEffect(() => {
    if(!visible)return;
    void load();
    return () => { sequence.current++; };
  }, [load, refreshKey,visible]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy || !active()) return;
    setBusy(true);
    try {
      await fn();
      if (!active()) return;
      await load();
    } catch (error) {
      if (active()) setError({cause:error});
    } finally {
      if (active()) setBusy(false);
    }
  };

  const toggle = (v: boolean) => run(() => setSessionMemory(sessionId, v));

  const save = (id: string | null) =>
    run(async () => {
      const text = draft.trim();
      if (!text || !scope) return;
      if (id) await updateMemory(id, { content: text });
      else await createMemory(scope, newType, text,scopeOverride?undefined:sessionId);
      setEditing(null);
      setAdding(false);
      setDraft("");
    });

  return (
    <div className="k-context-section">
      {confirmDialog}
      <div className="k-memory__head">
        <div className="k-context-section__title">✦ {en ? 'Memories' : '覚えていること'}</div>
        <Switch checked={enabled} onChange={toggle} label={en ? 'Remember conversations' : '会話を覚える'} disabled={busy || !scope} />
      </div>
      <div className="k-context-note">
        {enabled ? (scope?.startsWith("work:") ? (en ? 'Memories stay within the same character, persona, world and settings revision.' : '同じキャラ・人物像・世界・設定版の範囲で覚えます。') : scope?.startsWith("char:") ? (en ? 'Memories are shared across worlds for the same character and persona. Legacy conversation sharing scopes are preserved.' : '同じ相手・人物像で世界をまたいで共有する記憶です。旧会話の共有範囲も保持しています。') : (en ? 'Memories stay within this conversation.' : 'この会話の範囲で覚えます。')) : (en ? 'When off, memories are neither saved nor recalled.' : 'オフの間は覚えず、思い出しもしません。')}
      </div>
      <p className="k-context-note">{en ? 'Matching words do not prove a fact. Check the source and correct anything inaccurate.' : '語句の一致は事実の証明ではありません。出典を確認し、違っていたら訂正できます。'}</p>
      {error && <div className="k-context-note k-memory__error" role="alert">{friendlyMessage(error.cause,language)}<Button size="sm" variant="ghost" onClick={() => void load()}>{en ? 'Reload' : '再読込'}</Button></div>}
      {loading && <p role="status">{en ? 'Loading memories…' : '記憶を読み込んでいます…'}</p>}
      {capabilities?.features.world_memory && !scopeOverride && <details>
        <summary>{en ? 'Change world separation and sharing scope' : '世界ごとの分離・共有範囲を変更'}</summary>
        <p className="k-context-note">{en ? 'Memories are copied to the destination. Originals remain, and other conversations are not migrated automatically.' : '移行先へ記憶をコピーします。元の記憶は残り、他の会話は自動移行しません。'}</p>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => setPreview(await previewMemoryScope(sessionId)))}>{en ? 'Preview migration' : '移行内容を確認'}</Button>
        {preview && <div><p>{en ? `Memories to copy: ${preview.memories.length}` : `対象：${preview.memories.length}件`}</p><ul>{preview.memories.map(memory => <li key={memory.id}>{memory.content}</li>)}</ul>
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { await migrateMemoryScope(sessionId, preview.preview_revision, false); setPreview(null); })}>{en ? 'Copy to this world and settings revision' : 'この世界・設定版の範囲へ移行'}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => {
            if (await confirm({ title: en ? 'Share memories across worlds?' : '世界をまたいで記憶を共有しますか？', description: en ? 'These memories will also be used in other worlds with the same character and persona. Copies are created; originals remain.' : '同じキャラ・人物像の別世界にもこの記憶を使います。移行先へコピーし、元の記憶は残します。', confirmLabel: en ? 'Copy to shared scope' : '共有へ移行', cancelLabel: en ? 'Cancel' : 'キャンセル' }) && active()) {
              await migrateMemoryScope(sessionId, preview.preview_revision, true); setPreview(null);
            }
          })}>{en ? 'Copy to shared scope across worlds' : '世界をまたぐ共有へ移行'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>{en ? 'Cancel' : 'やめる'}</Button>
        </div>}
      </details>}
      {items.length > 0 && (
        <ul className="k-memory__list">
          {items.map((m) => (
            <li key={m.id} className="k-memory__item">
              <span className={`k-memory__type k-memory__type--${m.type}`}>{typeLabels[m.type]}</span>
              {editing === m.id ? (
                <form className="k-memory__form" onSubmit={(e) => { e.preventDefault(); void save(m.id); }}>
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={200} aria-label={en ? 'Correct memory' : '記憶を訂正'} />
                  <div className="k-memory__actions">
                    <Button size="sm" type="submit" disabled={busy || !draft.trim()}>{en ? 'Save' : '保存'}</Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>{en ? 'Cancel' : 'やめる'}</Button>
                  </div>
                </form>
              ) : (
                <>
                  <span className="k-memory__content">{m.content}{m.supported === false && m.origin === "model" && <small>{en ? ' (Awaiting review; not used in conversation)' : '（確認待ち・会話には未使用）'}</small>}<MemorySource memory={m} /></span>
                  <span className="k-memory__tools">
                    <IconButton label={en ? 'Correct' : '訂正'} size="sm" disabled={busy} onClick={() => { setEditing(m.id); setDraft(m.content); }}>
                      <Icon name="edit" size={13} />
                    </IconButton>
                    <IconButton label={en ? 'Forget' : '忘れる'} size="sm" disabled={busy} onClick={() => void run(() => deleteMemory(m.id))}>
                      <Icon name="trash" size={13} />
                    </IconButton>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && enabled && !error && !loading && <div className="k-context-note">{en ? 'No memories yet.' : 'まだ覚えていることはありません。'}</div>}
      {adding ? (
        <form className="k-memory__form" onSubmit={(e) => { e.preventDefault(); void save(null); }}>
          <div className="k-narration-style-grid" role="radiogroup" aria-label={en ? 'Memory type' : '記憶の種類'}>
            {TYPES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={newType === t}
                className={`k-narration-style-chip ${newType === t ? "k-narration-style-chip--active" : ""}`} onClick={() => setNewType(t)}>
                {typeLabels[t]}
              </button>
            ))}
          </div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={200} placeholder={en ? 'Example: I dislike spicy food' : '例：辛いものが苦手'} aria-label={en ? 'What to remember' : '覚えてほしいこと'} />
          <div className="k-memory__actions">
            <Button size="sm" type="submit" disabled={busy || !draft.trim()}>{en ? 'Remember this' : '覚えてもらう'}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setAdding(false); setDraft(""); }}>{en ? 'Cancel' : 'やめる'}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" style={{ justifySelf: "start" }} disabled={busy || !scope} onClick={() => { setAdding(true); setEditing(null); setDraft(""); }}>
          <Icon name="plus" size={12} /> {en ? 'Add a memory' : '覚えてほしいことを追加'}
        </Button>
      )}
      {!scopeOverride && <Button variant="danger" size="sm" disabled={busy || !scope || !capabilities?.features.permanent_delete} onClick={() => void run(async () => {
        if (await confirm({ title: en ? 'Erase all memories in this scope?' : 'この範囲の記憶をすべて消去しますか？', description: en ? 'This deletes memories in the shared scope, affects other conversations and cannot be undone. It does not delete conversation text.' : '共有範囲にある記憶を削除します。他の会話にも影響し、元に戻せません。会話本文の削除とは別です。', confirmLabel: en ? 'Erase memories' : '記憶を消去', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }) && active()) await clearSessionMemories(sessionId);
      })}>{en ? 'Erase memories in this scope' : 'この範囲の記憶を消去'}</Button>}
    </div>
  );
}
