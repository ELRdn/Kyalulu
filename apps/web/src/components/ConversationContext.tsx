import { useEffect, useRef, useState } from 'react';
import { fetchChatContext, updateChatSummary } from '../lib/api';
import type { ChatContext } from '../../../../packages/schemas/src';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import { Textarea } from './ui/Input';

export default function ConversationContext({ sessionId, refreshKey, disabled }: { sessionId: string; refreshKey: number; disabled: boolean }) {
  const [context, setContext] = useState<ChatContext | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const id = ++sequence.current;
    const abort = new AbortController();
    fetchChatContext(sessionId, abort.signal).then(value => {
      if (id === sequence.current) { setContext(value); setError(''); }
    }).catch(error => { if (!abort.signal.aborted && id === sequence.current) setError(friendlyMessage(error)); });
    return () => { ++sequence.current; abort.abort(); };
  }, [sessionId, refreshKey, retry]);
  const save = async () => {
    const summary = context?.summaries.find(item => item.id === editing);
    if (!summary || busyRef.current || disabled || !draft.trim()) return;
    const id = sequence.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await updateChatSummary(sessionId, summary.id, draft, summary.revision);
      if (id === sequence.current) { setEditing(null); setRetry(value => value + 1); }
    } catch (error) { if (id === sequence.current) setError(friendlyMessage(error)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  return <details className="k-context-section">
    <summary className="k-context-section__title">会話の要約を確認・訂正</summary>
    <p className="k-context-note">20メッセージごとに章、10章ごとに長期要約を保存します。抜粋は内容を省略する場合があります。訂正した内容は次の会話の文脈に使われます。</p>
    {error && <p role="alert">{error} <Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>再読込</Button></p>}
    {!context && !error && <p role="status">要約を読み込んでいます…</p>}
    {context && !error && context.summaries.length === 0 && <p>まだ要約はありません。</p>}
    {context?.summaries.map(summary => <article key={summary.id} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      <strong>{summary.kind === 'chapter' ? '章の要約' : '長期要約'} · 版{summary.revision}</strong>
      <small>{summary.method === 'extractive' ? '発言の抜粋' : summary.method === 'user_edited' ? '手動訂正' : summary.method} · 出典メッセージ {summary.source_message_ids.join(', ')}</small>
      {editing === summary.id ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <Textarea aria-label="要約を訂正" rows={6} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy || disabled} />
        <Button size="sm" disabled={busy || disabled || !draft.trim()} type="submit">訂正を保存</Button>
        <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>キャンセル</Button>
      </form> : <><p style={{ whiteSpace: 'pre-wrap' }}>{summary.text}</p><Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => { setEditing(summary.id); setDraft(summary.text); }}>訂正</Button></>}
    </article>)}
  </details>;
}
