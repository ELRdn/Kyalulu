import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCapabilities } from '../lib/capabilities';
import { blockAuthor, fetchPublicWork, followAuthor, reactToWork, reportWork, withdrawWork, workComments, type PublicWork as Work, type WorkComment } from '../lib/community';
import { saveLibraryItem } from '../lib/library';
import { connectionScope } from '../lib/remoteStore';
import { friendlyMessage } from '../lib/errors';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { useConfirm } from '../components/ui/Dialog';
import MessageContent from '../components/MessageContent';
import { useDocumentTitle } from '../lib/title';
import RelatedWorks from '../components/RelatedWorks';
import { useRuntimeAccess } from '../components/RuntimeGate';
import { isCloudGuest, loginPath } from '../lib/cloudGuest';

export default function PublicWork() {
  const guest = isCloudGuest(useRuntimeAccess());
  const { workId = '' } = useParams();
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [work, setWork] = useState<Work | null>(null);
  const [comments, setComments] = useState<WorkComment[]>([]);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [commentError, setCommentError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dialog, confirm] = useConfirm();
  const navigate = useNavigate();
  const sequence = useRef(0);
  const importRequest = useRef(crypto.randomUUID());
  const commentRequest = useRef<{ text: string; id: string } | null>(null);
  const busyRef = useRef(false);
  useDocumentTitle(work?.name ?? '公開作品');
  useEffect(() => {
    const id = ++sequence.current;
    setWork(null); setError(''); setNotice(''); setDraft(''); setReason(''); setComments([]); setCommentError(''); setBusy(false); busyRef.current = false;
    importRequest.current = crypto.randomUUID();
    commentRequest.current = null;
    if (capabilities?.features.community) {
      fetchPublicWork(workId).then(value => { if (id === sequence.current) setWork(value); }).catch(error => { if (id === sequence.current) setError(friendlyMessage(error)); });
      workComments(workId).then(value => { if (id === sequence.current) setComments(value); }).catch(error => { if (id === sequence.current) setCommentError(friendlyMessage(error)); });
    }
    return () => { ++sequence.current; };
  }, [workId, capabilities, retry]);
  const run = async (fn: () => Promise<void>) => {
    if (guest) { navigate(loginPath(`/works/${encodeURIComponent(workId)}`)); return; }
    if (busyRef.current || !work || !capabilities?.features.community) return;
    const id = sequence.current; const scope = connectionScope();
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (error) { if (id === sequence.current && scope === connectionScope()) setError(friendlyMessage(error)); }
    finally { if (id === sequence.current) { setBusy(false); busyRef.current = false; } }
  };
  const current = (id: number, scope: string) => id === sequence.current && scope === connectionScope();
  const toggleReaction = (kind: 'like' | 'save') => run(async () => {
    const id = sequence.current; const scope = connectionScope();
    const result = await reactToWork(work!.id, kind, !work!.reactions.includes(kind));
    if (current(id, scope)) setWork(result);
  });
  const start = () => run(async () => {
    const id = sequence.current; const scope = connectionScope();
    if (!await confirm({ title: 'この公開版をマイライブラリに保存しますか？', description: '自分の保存先へコピーしてから会話を始めます。Cloudでは保存のSFW検査にAPI費用が発生する場合があります。', confirmLabel: 'コピーを保存' }) || !current(id, scope)) return;
    const item = await saveLibraryItem(work!.document, undefined, importRequest.current);
    if (current(id, scope)) navigate(`/characters/${encodeURIComponent(item.id)}`);
  });
  return <div className="k-page" style={{ maxWidth: 900 }}>{dialog}<Link to="/discover">← ディスカバー</Link>
    {capabilityError ? <p role="alert">{capabilityError}<Button onClick={reload}>再読込</Button></p> : !capabilities ? <p role="status">対応状況を確認中…</p> : !capabilities.features.community ? <p>この接続先では公開作品・交流を提供していません。</p> : <>
      {error && <p role="alert">{error}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>再読込</Button></p>}
      {!work && !error && <p role="status">作品を読み込んでいます…</p>}
      {work && <>
        <h1>{work.name}</h1><p>固定版{work.revision} · <Link to={`/authors/${encodeURIComponent(work.author_id)}`}>{work.author_name}</Link></p>
        <p>{work.description}</p><p>{work.tags.map(tag => <Link key={tag} to={`/discover?q=${encodeURIComponent(tag)}`} style={{ marginRight: 8 }}>{tag}</Link>)}</p>
        {guest && <p>公開設定・コメントは閲覧できます。会話・保存・交流にはログインしてください。</p>}
        <div className="k-create-actions"><Button disabled={busy} onClick={() => void start()}>{guest ? 'ログインして会話へ' : '保存して会話へ'}</Button>
          <Button variant="secondary" disabled={busy} aria-pressed={work.reactions.includes('like')} onClick={() => void toggleReaction('like')}>いいね {work.likes}</Button>
          <Button variant="secondary" disabled={busy} aria-pressed={work.reactions.includes('save')} onClick={() => void toggleReaction('save')}>保存 {work.saves}</Button>
          {!work.owned && <Button variant="ghost" disabled={busy} aria-pressed={work.following} onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope(); const active = !work.following;
            await followAuthor(work.author_id, active); if (current(id, scope)) setWork({ ...work, following: active });
          })}>{work.following ? 'フォローを解除' : '作者をフォロー'}</Button>}
        </div>
        {typeof work.document.data.first_mes === 'string' && <section><h2>物語のはじまり</h2><MessageContent content={work.document.data.first_mes} /></section>}
        <details><summary>公開されている設定</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ data: work.document.data, speaking_style: work.document.speaking_style }, null, 2)}</pre></details>
        <RelatedWorks work={work} />
        <section><h2>コメント</h2>{commentError && <p role="alert">{commentError}</p>}
          {!commentError && comments.length === 0 && <p>コメントはまだありません。</p>}
          {comments.map(comment => <article key={comment.id}><Link to={`/authors/${encodeURIComponent(comment.author_id)}`}>{comment.author_name}</Link><p style={{ whiteSpace: 'pre-wrap' }}>{comment.text}</p></article>)}
          {guest ? <Button onClick={() => navigate(loginPath(`/works/${encodeURIComponent(workId)}`))}>ログインしてコメントする</Button> : <form onSubmit={event => { event.preventDefault(); void run(async () => {
            const id = sequence.current; const scope = connectionScope(); const text = draft.trim();
            if (!text || !await confirm({ title: 'コメントを公開しますか？', description: '表示名と本文を公開します。SFW検査のAPI費用が発生する場合があります。', confirmLabel: '検査を受けて投稿' }) || !current(id, scope)) return;
            if (commentRequest.current?.text !== text) commentRequest.current = { text, id: crypto.randomUUID() };
            const result = await workComments(work.id, text, commentRequest.current.id);
            if (current(id, scope)) {
              commentRequest.current = null;
              setComments(result); setDraft(''); setCommentError('');
              const updated = await fetchPublicWork(work.id); if (current(id, scope)) setWork(updated);
            }
          }); }}><label>公開コメント<Textarea rows={3} value={draft} maxLength={2000} disabled={busy} onChange={event => { commentRequest.current = null; setDraft(event.target.value); }} /></label><p>SFW検査のAPI費用が発生する場合があります。送信結果を確認できなかった場合、同じ本文の再送には同じ送信IDを使います。</p><Button disabled={busy || !draft.trim()} type="submit">内容を確認して投稿</Button></form>}
        </section>
        {!guest && <details><summary>通報・作者ブロック・公開取り下げ</summary>
          <label>通報理由<Textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><Button disabled={busy || !reason.trim()} variant="secondary" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope(); await reportWork(work.id, reason.trim()); if (current(id, scope)) { setReason(''); setNotice('通報を受け付けました。'); }
          })}>通報する</Button>
          {!work.owned && <Button disabled={busy} variant="danger" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope();
            if (!await confirm({ title: 'この作者をブロックしますか？', description: 'この作者の作品・コメントを表示しなくなり、フォローも解除します。', confirmLabel: 'ブロック', danger: true }) || !current(id, scope)) return;
            await blockAuthor(work.author_id, true); if (current(id, scope)) navigate(`/authors/${encodeURIComponent(work.author_id)}`);
          })}>作者をブロック</Button>}
          {work.owned && <Button disabled={busy} variant="danger" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope();
            if (!await confirm({ title: 'この版の公開を取り下げますか？', description: '共有catalogから作品と反応・コメントを削除します。マイライブラリの原本は残ります。', confirmLabel: '取り下げ', danger: true }) || !current(id, scope)) return;
            await withdrawWork(work.id); if (current(id, scope)) navigate('/discover');
          })}>公開を取り下げる</Button>}
        </details>}
      </>}{notice && <p role="status">{notice}</p>}
    </>}
  </div>;
}
