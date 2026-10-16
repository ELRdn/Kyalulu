import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPublicWorks, type PublicWork } from '../lib/community';
import { useCapabilities } from '../lib/capabilities';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import { Input } from './ui/Input';

export function WorkCards({ works }: { works: PublicWork[] }) {
  return <div className="k-grid k-grid--characters">{works.map(work => <article key={work.id} className="k-card" style={{ padding: 16 }}>
    <h3><Link to={`/works/${encodeURIComponent(work.id)}`}>{work.name}</Link></h3>
    <Link to={`/authors/${encodeURIComponent(work.author_id)}`}>{work.author_name}</Link>
    <p>{work.description}</p><p>{work.tags.join(' · ')}</p>
    <small>版{work.revision} · いいね {work.likes} · 保存 {work.saves} · コメント {work.comments}</small>
  </article>)}</div>;
}

export default function CommunityWorks({ query = '' }: { query?: string }) {
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!capabilities?.features.community) return;
    const abort = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      fetchPublicWorks(query, tag, abort.signal).then(value => { if (!abort.signal.aborted) setWorks(value); })
        .catch(error => { if (!abort.signal.aborted) setError(friendlyMessage(error)); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [capabilities, query, tag, retry]);
  return <section className="k-section"><h2 className="k-section__title">公開作品</h2>
    {capabilityError ? <p role="alert">{capabilityError}<Button size="sm" onClick={reload}>再読込</Button></p> : !capabilities ? <p role="status">公開作品の対応状況を確認中…</p> : !capabilities.features.community ? <p>この接続先では公開作品・交流の提供を開始していません。マイライブラリの作品は公開されません。</p> : <>
      <label>タグで絞り込む<Input value={tag} onChange={event => setTag(event.target.value)} placeholder="例：ファンタジー" /></label>
      {error ? <p role="alert">{error}<Button size="sm" onClick={() => setRetry(value => value + 1)}>再読込</Button></p> : loading ? <p role="status">作品を読み込んでいます…</p> : works.length ? <WorkCards works={works} /> : <p>この条件の公開作品はありません。</p>}
    </>}
  </section>;
}
