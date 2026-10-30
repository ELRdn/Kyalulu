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
import { useLanguage } from '../lib/appContext';

export default function PublicWork() {
  const language = useLanguage(), en = language === 'en';
  const guest = isCloudGuest(useRuntimeAccess());
  const { workId = '' } = useParams();
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [work, setWork] = useState<Work | null>(null);
  const [comments, setComments] = useState<WorkComment[]>([]);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [commentError, setCommentError] = useState<{ cause: unknown } | null>(null);
  const [notice, setNotice] = useState<'reported' | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [dialog, confirm] = useConfirm();
  const navigate = useNavigate();
  const sequence = useRef(0);
  const importRequest = useRef(crypto.randomUUID());
  const commentRequest = useRef<{ text: string; id: string } | null>(null);
  const busyRef = useRef(false);
  useDocumentTitle(work?.name ?? (en ? 'Public work' : '公開作品'));
  useEffect(() => {
    const id = ++sequence.current;
    setWork(null); setError(null); setNotice(null); setDraft(''); setReason(''); setComments([]); setCommentError(null); setBusy(false); busyRef.current = false;
    importRequest.current = crypto.randomUUID();
    commentRequest.current = null;
    if (capabilities?.features.community) {
      fetchPublicWork(workId).then(value => { if (id === sequence.current) setWork(value); }).catch(error => { if (id === sequence.current) setError({ cause: error }); });
      workComments(workId).then(value => { if (id === sequence.current) setComments(value); }).catch(error => { if (id === sequence.current) setCommentError({ cause: error }); });
    }
    return () => { ++sequence.current; };
  }, [workId, capabilities, retry]);
  const run = async (fn: () => Promise<void>) => {
    if (guest) { navigate(loginPath(`/works/${encodeURIComponent(workId)}`)); return; }
    if (busyRef.current || !work || !capabilities?.features.community) return;
    const id = sequence.current; const scope = connectionScope();
    busyRef.current = true; setBusy(true); setError(null); setNotice(null);
    try { await fn(); } catch (error) { if (id === sequence.current && scope === connectionScope()) setError({ cause: error }); }
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
    if (!await confirm({ title: en ? 'Save this public version to My Library?' : 'この公開版をマイライブラリに保存しますか？', description: en ? 'Copy it to your own storage before starting a conversation. On Cloud, SFW screening for saving may incur API costs.' : '自分の保存先へコピーしてから会話を始めます。Cloudでは保存のSFW検査にAPI費用が発生する場合があります。', confirmLabel: en ? 'Save copy' : 'コピーを保存', cancelLabel: en ? 'Cancel' : 'キャンセル' }) || !current(id, scope)) return;
    const item = await saveLibraryItem(work!.document, undefined, importRequest.current);
    if (current(id, scope)) navigate(`/characters/${encodeURIComponent(item.id)}`);
  });
  return <div className="k-page" style={{ maxWidth: 900 }}>{dialog}<Link to="/discover">{en ? '← Discover' : '← ディスカバー'}</Link>
    {capabilityError ? <p role="alert">{friendlyMessage(capabilityError, language)}<Button onClick={reload}>{en ? 'Reload' : '再読込'}</Button></p> : !capabilities ? <p role="status">{en ? 'Checking feature availability…' : '対応状況を確認中…'}</p> : !capabilities.features.community ? <p>{en ? 'Public works and community features are not available at this connection.' : 'この接続先では公開作品・交流を提供していません。'}</p> : <>
      {error && <p role="alert">{friendlyMessage(error.cause, language)}<Button size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p>}
      {!work && !error && <p role="status">{en ? 'Loading work…' : '作品を読み込んでいます…'}</p>}
      {work && <>
        <h1>{work.name}</h1><p>{en ? 'Fixed version ' : '固定版'}{work.revision} · <Link to={`/authors/${encodeURIComponent(work.author_id)}`}>{work.author_name}</Link></p>
        <p>{work.description}</p><p>{work.tags.map(tag => <Link key={tag} to={`/discover?q=${encodeURIComponent(tag)}`} style={{ marginRight: 8 }}>{tag}</Link>)}</p>
        {guest && <p>{en ? 'You can view public settings and comments. Sign in to chat, save or interact.' : '公開設定・コメントは閲覧できます。会話・保存・交流にはログインしてください。'}</p>}
        <div className="k-create-actions"><Button disabled={busy} onClick={() => void start()}>{guest ? (en ? 'Sign in to chat' : 'ログインして会話へ') : (en ? 'Save and chat' : '保存して会話へ')}</Button>
          <Button variant="secondary" disabled={busy} aria-pressed={work.reactions.includes('like')} onClick={() => void toggleReaction('like')}>{en ? 'Like' : 'いいね'} {work.likes}</Button>
          <Button variant="secondary" disabled={busy} aria-pressed={work.reactions.includes('save')} onClick={() => void toggleReaction('save')}>{en ? 'Save' : '保存'} {work.saves}</Button>
          {!work.owned && <Button variant="ghost" disabled={busy} aria-pressed={work.following} onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope(); const active = !work.following;
            await followAuthor(work.author_id, active); if (current(id, scope)) setWork({ ...work, following: active });
          })}>{work.following ? (en ? 'Unfollow author' : 'フォローを解除') : (en ? 'Follow author' : '作者をフォロー')}</Button>}
        </div>
        {typeof work.document.data.first_mes === 'string' && <section><h2>{en ? 'Story opening' : '物語のはじまり'}</h2><MessageContent content={work.document.data.first_mes} /></section>}
        <details><summary>{en ? 'Public settings' : '公開されている設定'}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ data: work.document.data, speaking_style: work.document.speaking_style }, null, 2)}</pre></details>
        <RelatedWorks work={work} />
        <section><h2>{en ? 'Comments' : 'コメント'}</h2>{commentError && <p role="alert">{friendlyMessage(commentError.cause, language)}</p>}
          {!commentError && comments.length === 0 && <p>{en ? 'No comments yet.' : 'コメントはまだありません。'}</p>}
          {comments.map(comment => <article key={comment.id}><Link to={`/authors/${encodeURIComponent(comment.author_id)}`}>{comment.author_name}</Link><p style={{ whiteSpace: 'pre-wrap' }}>{comment.text}</p></article>)}
          {guest ? <Button onClick={() => navigate(loginPath(`/works/${encodeURIComponent(workId)}`))}>{en ? 'Sign in to comment' : 'ログインしてコメントする'}</Button> : <form onSubmit={event => { event.preventDefault(); void run(async () => {
            const id = sequence.current; const scope = connectionScope(); const text = draft.trim();
            if (!text || !await confirm({ title: en ? 'Publish this comment?' : 'コメントを公開しますか？', description: en ? 'Your display name and comment will be public. SFW screening may incur API costs.' : '表示名と本文を公開します。SFW検査のAPI費用が発生する場合があります。', confirmLabel: en ? 'Screen and post' : '検査を受けて投稿', cancelLabel: en ? 'Cancel' : 'キャンセル' }) || !current(id, scope)) return;
            if (commentRequest.current?.text !== text) commentRequest.current = { text, id: crypto.randomUUID() };
            const result = await workComments(work.id, text, commentRequest.current.id);
            if (current(id, scope)) {
              commentRequest.current = null;
              setComments(result); setDraft(''); setCommentError(null);
              const updated = await fetchPublicWork(work.id); if (current(id, scope)) setWork(updated);
            }
          }); }}><label>{en ? 'Public comment' : '公開コメント'}<Textarea rows={3} value={draft} maxLength={2000} disabled={busy} onChange={event => { commentRequest.current = null; setDraft(event.target.value); }} /></label><p>{en ? 'SFW screening may incur API costs. If the send result could not be verified, resending the same text uses the same request ID.' : 'SFW検査のAPI費用が発生する場合があります。送信結果を確認できなかった場合、同じ本文の再送には同じ送信IDを使います。'}</p><Button disabled={busy || !draft.trim()} type="submit">{en ? 'Review and post' : '内容を確認して投稿'}</Button></form>}
        </section>
        {!guest && <details><summary>{en ? 'Report, block author or withdraw publication' : '通報・作者ブロック・公開取り下げ'}</summary>
          <label>{en ? 'Report reason' : '通報理由'}<Textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label><Button disabled={busy || !reason.trim()} variant="secondary" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope(); await reportWork(work.id, reason.trim()); if (current(id, scope)) { setReason(''); setNotice('reported'); }
          })}>{en ? 'Report' : '通報する'}</Button>
          {!work.owned && <Button disabled={busy} variant="danger" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope();
            if (!await confirm({ title: en ? 'Block this author?' : 'この作者をブロックしますか？', description: en ? 'Their works and comments will be hidden, and you will unfollow them.' : 'この作者の作品・コメントを表示しなくなり、フォローも解除します。', confirmLabel: en ? 'Block' : 'ブロック', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }) || !current(id, scope)) return;
            await blockAuthor(work.author_id, true); if (current(id, scope)) navigate(`/authors/${encodeURIComponent(work.author_id)}`);
          })}>{en ? 'Block author' : '作者をブロック'}</Button>}
          {work.owned && <Button disabled={busy} variant="danger" onClick={() => void run(async () => {
            const id = sequence.current; const scope = connectionScope();
            if (!await confirm({ title: en ? 'Withdraw this published version?' : 'この版の公開を取り下げますか？', description: en ? 'The work, reactions and comments will be removed from the shared catalog. The original in My Library will remain.' : '共有catalogから作品と反応・コメントを削除します。マイライブラリの原本は残ります。', confirmLabel: en ? 'Withdraw' : '取り下げ', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: true }) || !current(id, scope)) return;
            await withdrawWork(work.id); if (current(id, scope)) navigate('/discover');
          })}>{en ? 'Withdraw publication' : '公開を取り下げる'}</Button>}
        </details>}
      </>}{notice && <p role="status">{en ? 'Your report was received.' : '通報を受け付けました。'}</p>}
    </>}
  </div>;
}
