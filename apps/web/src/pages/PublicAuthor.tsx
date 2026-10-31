import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCapabilities } from '../lib/capabilities';
import { blockAuthor, fetchPublicAuthor, fetchPublicWorks, followAuthor, type PublicWork } from '../lib/community';
import { WorkCards } from '../components/CommunityWorks';
import Button from '../components/ui/Button';
import { friendlyMessage } from '../lib/errors';
import { useConfirm } from '../components/ui/Dialog';
import { connectionScope } from '../lib/remoteStore';
import { useLanguage } from '../lib/appContext';

export default function PublicAuthor() {
  const language = useLanguage(), en = language === 'en';
  const { authorId = '' } = useParams();
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [author, setAuthor] = useState<{ id: string; name: string; followers: number } | null>(null);
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'relation-updated' | null>(null);
  const [dialog, confirm] = useConfirm();
  const scope = connectionScope();
  const sequence = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    const id = ++sequence.current;
    let active = true; setAuthor(null); setError(null); setWorks([]); setNotice(null); setBusy(false); busyRef.current = false;
    if (capabilities?.features.community) Promise.all([fetchPublicAuthor(authorId), fetchPublicWorks()])
      .then(([author, works]) => { if (active) { setAuthor(author); setWorks(works.filter(work => work.author_id === authorId)); } })
      .catch(error => { if (active) setError({ cause: error }); });
    return () => { active = false; if (sequence.current === id) ++sequence.current; };
  }, [authorId, capabilities, retry]);
  const relation = async (kind: 'follow' | 'block', active: boolean) => {
    if (busyRef.current || !capabilities?.features.community || scope !== connectionScope()) return;
    const id = sequence.current;
    const current = () => id === sequence.current && scope === connectionScope();
    busyRef.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (!await confirm({ title: kind === 'block' ? active ? (en ? 'Block this author?' : '作者をブロックしますか？') : (en ? 'Unblock this author?' : '作者のブロックを解除しますか？') : active ? (en ? 'Follow this author?' : '作者をフォローしますか？') : (en ? 'Unfollow this author?' : '作者のフォローを解除しますか？'), confirmLabel: en ? 'Apply change' : '変更する', cancelLabel: en ? 'Cancel' : 'キャンセル', danger: kind === 'block' && active }) || !current()) return;
      await (kind === 'block' ? blockAuthor(authorId, active) : followAuthor(authorId, active));
      if (current()) { setNotice('relation-updated'); setRetry(value => value + 1); }
    } catch (error) { if (current()) setError({ cause: error }); }
    finally { if (current()) { setBusy(false); busyRef.current = false; } }
  };
  return <div className="k-page">{dialog}<Link to="/discover">{en ? '← Discover' : '← ディスカバー'}</Link>
    {capabilityError ? <p role="alert">{friendlyMessage(capabilityError, language)}<Button onClick={reload}>{en ? 'Reload' : '再読込'}</Button></p> : !capabilities ? <p role="status">{en ? 'Checking feature availability…' : '対応状況を確認中…'}</p> : !capabilities.features.community ? <p>{en ? 'Public author pages are not available at this connection.' : 'この接続先では公開作者ページを提供していません。'}</p> : error ? <p role="alert">{friendlyMessage(error.cause, language)}<Button onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p> : !author ? <p role="status">{en ? 'Loading author…' : '作者を読み込んでいます…'}</p> : <>
      <h1>{author.name}</h1><p>{en ? 'Followers' : 'フォロワー'} {author.followers}</p><h2>{en ? 'Public works' : '公開作品'}</h2>{works.length ? <WorkCards works={works} /> : <p>{en ? 'No public works to display.' : '表示できる公開作品はありません。'}</p>}
      {!works.some(work => work.owned) && <div className="k-create-actions"><Button disabled={busy} onClick={() => void relation('follow', true)}>{en ? 'Follow' : 'フォロー'}</Button><Button disabled={busy} variant="ghost" onClick={() => void relation('follow', false)}>{en ? 'Unfollow' : 'フォロー解除'}</Button><Button disabled={busy} variant="danger" onClick={() => void relation('block', true)}>{en ? 'Block' : 'ブロック'}</Button><Button disabled={busy} variant="secondary" onClick={() => void relation('block', false)}>{en ? 'Unblock' : 'ブロック解除'}</Button></div>}
      {notice && <p role="status">{en ? 'Your relationship with this author was updated.' : '作者との関係を更新しました。'}</p>}
      <p className="k-page-sub">{en ? 'Showing works within the retrieved catalog.' : 'catalogの取得範囲にある作品を表示しています。'}</p>
    </>}
  </div>;
}
