import { useCallback, useEffect, useRef, useState } from "react";
import {
  createMemory,
  deleteMemory,
  fetchSessionMemory,
  listMemories,
  setSessionMemory,
  updateMemory,
  type MemoryItem,
  type MemoryType
} from "../lib/api";
import Button from "./ui/Button";
import Icon from "./ui/Icon";
import IconButton from "./ui/IconButton";
import Switch from "./ui/Switch";
import { Textarea } from "./ui/Input";
import "./memory.css";

export const MEMORY_TYPE_LABEL: Record<MemoryType, string> = {
  semantic: "好み・事実",
  episodic: "出来事・約束",
  relationship: "関係"
};

const TYPES = Object.keys(MEMORY_TYPE_LABEL) as MemoryType[];

/** 会話パネルの「覚えていること」: 記憶の ON/OFF と、記憶の確認・訂正・削除・追加。 */
export default function MemoryPanel({ sessionId, refreshKey, scopeOverride }: { sessionId: string; refreshKey: number; scopeOverride?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<MemoryType>("semantic");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const s = await fetchSessionMemory(sessionId);
      s.scope = scopeOverride ?? s.scope;
      const loaded = await listMemories(s.scope);
      if (id !== sequence.current) return;
      setEnabled(s.enabled);
      setScope(s.scope);
      setItems(loaded);
      setError(null);
    } catch {
      if (id === sequence.current) setError("記憶を読み込めませんでした");
    }
  }, [sessionId, scopeOverride]);

  useEffect(() => {
    void load();
    return () => { sequence.current++; };
  }, [load, refreshKey]);

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await load();
    } catch {
      setError("記憶を更新できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (v: boolean) => run(() => setSessionMemory(sessionId, v));

  const save = (id: string | null) =>
    run(async () => {
      const text = draft.trim();
      if (!text || !scope) return;
      if (id) await updateMemory(id, { content: text });
      else await createMemory(scope, newType, text);
      setEditing(null);
      setAdding(false);
      setDraft("");
    });

  return (
    <div className="k-context-section">
      <div className="k-memory__head">
        <div className="k-context-section__title">✦ 覚えていること</div>
        <Switch checked={enabled} onChange={toggle} label="会話を覚える" disabled={busy || !scope} />
      </div>
      <div className="k-context-note">
        {enabled ? (scope?.startsWith("char:") ? "同じ相手・人物像との会話で、好みや約束を覚えて次の会話でも思い出します。" : "この会話で、好みや約束を覚えて思い出します。") : "オフの間は覚えず、思い出しもしません。"}
      </div>
      {error && <div className="k-context-note k-memory__error" role="alert">{error}</div>}
      {items.length > 0 && (
        <ul className="k-memory__list">
          {items.map((m) => (
            <li key={m.id} className="k-memory__item">
              <span className={`k-memory__type k-memory__type--${m.type}`}>{MEMORY_TYPE_LABEL[m.type]}</span>
              {editing === m.id ? (
                <form className="k-memory__form" onSubmit={(e) => { e.preventDefault(); void save(m.id); }}>
                  <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={200} aria-label="記憶を訂正" />
                  <div className="k-memory__actions">
                    <Button size="sm" type="submit" disabled={busy || !draft.trim()}>保存</Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(null)}>やめる</Button>
                  </div>
                </form>
              ) : (
                <>
                  <span className="k-memory__content">{m.content}{m.supported === false && m.origin === "model" && <small>（確認待ち・会話には未使用）</small>}</span>
                  <span className="k-memory__tools">
                    <IconButton label="訂正" size="sm" disabled={busy} onClick={() => { setEditing(m.id); setDraft(m.content); }}>
                      <Icon name="edit" size={13} />
                    </IconButton>
                    <IconButton label="忘れる" size="sm" disabled={busy} onClick={() => void run(() => deleteMemory(m.id))}>
                      <Icon name="trash" size={13} />
                    </IconButton>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length === 0 && enabled && <div className="k-context-note">まだ覚えていることはありません。</div>}
      {adding ? (
        <form className="k-memory__form" onSubmit={(e) => { e.preventDefault(); void save(null); }}>
          <div className="k-narration-style-grid" role="radiogroup" aria-label="記憶の種類">
            {TYPES.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={newType === t}
                className={`k-narration-style-chip ${newType === t ? "k-narration-style-chip--active" : ""}`} onClick={() => setNewType(t)}>
                {MEMORY_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={200} placeholder="例：辛いものが苦手" aria-label="覚えてほしいこと" />
          <div className="k-memory__actions">
            <Button size="sm" type="submit" disabled={busy || !draft.trim()}>覚えてもらう</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => { setAdding(false); setDraft(""); }}>やめる</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" style={{ justifySelf: "start" }} disabled={busy || !scope} onClick={() => { setAdding(true); setEditing(null); setDraft(""); }}>
          <Icon name="plus" size={12} /> 覚えてほしいことを追加
        </Button>
      )}
    </div>
  );
}
