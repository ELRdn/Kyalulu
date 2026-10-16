import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCapabilities } from '../lib/capabilities';
import { blockAuthor, fetchPublicAuthor, fetchPublicWorks, followAuthor, type PublicWork } from '../lib/community';
import { WorkCards } from '../components/CommunityWorks';
import Button from '../components/ui/Button';
import { friendlyMessage } from '../lib/errors';
import { useConfirm } from '../components/ui/Dialog';
import { connectionScope } from '../lib/remoteStore';

export default function PublicAuthor() {
  const { authorId = '' } = useParams();
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [author, setAuthor] = useState<{ id: string; name: string; followers: number } | null>(null);
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [dialog, confirm] = useConfirm();
  const scope = connectionScope();
  const sequence = useRef(0);
  const busyRef = useRef(false);
  useEffect(() => {
    const id = ++sequence.current;
    let active = true; setAuthor(null); setError(''); setWorks([]); setNotice(''); setBusy(false); busyRef.current = false;
    if (capabilities?.features.community) Promise.all([fetchPublicAuthor(authorId), fetchPublicWorks()])
      .then(([author, works]) => { if (active) { setAuthor(author); setWorks(works.filter(work => work.author_id === authorId)); } })
      .catch(error => { if (active) setError(friendlyMessage(error)); });
    return () => { active = false; if (sequence.current === id) ++sequence.current; };
  }, [authorId, capabilities, retry]);
  const relation = async (kind: 'follow' | 'block', active: boolean) => {
    if (busyRef.current || !capabilities?.features.community || scope !== connectionScope()) return;
    const id = sequence.current;
    const current = () => id === sequence.current && scope === connectionScope();
    busyRef.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!await confirm({ title: kind === 'block' ? active ? '作者をブロックしますか？' : '作者のブロックを解除しますか？' : active ? '作者をフォローしますか？' : '作者のフォローを解除しますか？', confirmLabel: '変更する', danger: kind === 'block' && active }) || !current()) return;
      await (kind === 'block' ? blockAuthor(authorId, active) : followAuthor(authorId, active));
      if (current()) { setNotice('作者との関係を更新しました。'); setRetry(value => value + 1); }
    } catch (error) { if (current()) setError(friendlyMessage(error)); }
    finally { if (current()) { setBusy(false); busyRef.current = false; } }
  };
  return <div className="k-page">{dialog}<Link to="/discover">← ディスカバー</Link>
    {capabilityError ? <p role="alert">{capabilityError}<Button onClick={reload}>再読込</Button></p> : !capabilities ? <p role="status">対応状況を確認中…</p> : !capabilities.features.community ? <p>この接続先では公開作者ページを提供していません。</p> : error ? <p role="alert">{error}<Button onClick={() => setRetry(value => value + 1)}>再読込</Button></p> : !author ? <p role="status">作者を読み込んでいます…</p> : <>
      <h1>{author.name}</h1><p>フォロワー {author.followers}</p><h2>公開作品</h2>{works.length ? <WorkCards works={works} /> : <p>表示できる公開作品はありません。</p>}
      {!works.some(work => work.owned) && <div className="k-create-actions"><Button disabled={busy} onClick={() => void relation('follow', true)}>フォロー</Button><Button disabled={busy} variant="ghost" onClick={() => void relation('follow', false)}>フォロー解除</Button><Button disabled={busy} variant="danger" onClick={() => void relation('block', true)}>ブロック</Button><Button disabled={busy} variant="secondary" onClick={() => void relation('block', false)}>ブロック解除</Button></div>}
      {notice && <p role="status">{notice}</p>}
      <p className="k-page-sub">catalogの取得範囲にある作品を表示しています。</p>
    </>}
  </div>;
}
