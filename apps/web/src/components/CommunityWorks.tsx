import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPublicWorks, type PublicWork } from '../lib/community';
import { useCapabilities } from '../lib/capabilities';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import { Input } from './ui/Input';
import { fetchPublishedWorks, publicationError, usePublicationScope, type PublishedWork } from '../lib/publications';
import { useLanguage, usePreferences } from '../lib/appContext';
import { recommend } from '../lib/recommendations';
import PublishedCards from './PublishedCards';

export function WorkCards({ works }: { works: PublicWork[] }) {
  const en=useLanguage()==='en';
  return <div className="k-grid k-grid--characters">{works.map(work => <article key={work.id} className="k-card" style={{ padding: 16 }}>
    <h3><Link to={`/works/${encodeURIComponent(work.id)}`}>{work.name}</Link></h3>
    <Link to={`/authors/${encodeURIComponent(work.author_id)}`}>{work.author_name}</Link>
    <p>{work.description}</p><p>{work.tags.join(' · ')}</p>
    <small>{en?'Version':'版'} {work.revision} · {en?'Likes':'いいね'} {work.likes} · {en?'Saves':'保存'} {work.saves} · {en?'Comments':'コメント'} {work.comments}</small>
  </article>)}</div>;
}

export default function CommunityWorks({ query = '' }: { query?: string }) {
  const scope=usePublicationScope();return <Catalog key={scope} query={query}/>;
}
function Catalog({query}:{query:string}) {
  const en=useLanguage()==='en',prefs=usePreferences();
  const { capabilities, error: capabilityError, reload } = useCapabilities();
  const [works, setWorks] = useState<PublicWork[]>([]);
  const [approved, setApproved] = useState<PublishedWork[]>([]);
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setWorks([]);setApproved([]);
    if (!capabilities?.features.community&&!capabilities?.features.publications) return;
    const abort = new AbortController();
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      (capabilities.features.publications?fetchPublishedWorks(query,tag,'general','',abort.signal).then(value=>{if(!abort.signal.aborted)setApproved(value);}):fetchPublicWorks(query, tag, abort.signal).then(value => { if (!abort.signal.aborted) setWorks(value); }))
        .catch(error => { if (!abort.signal.aborted) setError(capabilities.features.publications?publicationError(error,en):friendlyMessage(error)); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [capabilities, query, tag, retry,en]);
  const featured=recommend(approved,prefs);
  return <section className="k-section"><h2 className="k-section__title">{en?'Public works':'公開作品'}</h2>
    {capabilityError ? <p role="alert">{capabilityError}<Button size="sm" onClick={reload}>{en?'Reload':'再読込'}</Button></p> : !capabilities ? <p role="status">{en?'Checking publication access…':'公開作品の対応状況を確認中…'}</p> : !capabilities.features.community&&!capabilities.features.publications ? <p>{en?'Public works are not available at this connection. Your private Library stays private.':'この接続先では公開作品・交流の提供を開始していません。マイライブラリの作品は公開されません。'}</p> : <>
      <label>{en?'Filter by tag':'タグで絞り込む'}<Input value={tag} maxLength={capabilities.features.publications?80:100} onChange={event => setTag(event.target.value)} placeholder={en?'e.g. fantasy':'例：ファンタジー'} /></label>
      {error ? <p role="alert">{error}<Button size="sm" onClick={() => setRetry(value => value + 1)}>{en?'Reload':'再読込'}</Button></p> : loading ? <p role="status">{en?'Loading works…':'作品を読み込んでいます…'}</p> : capabilities.features.publications ? <><Link to="/published">{en?'Browse approved works':'承認済み作品をさがす'}</Link><PublishedCards works={featured}/>{!featured.length&&<p>{en?'No public works match these filters.':'この条件の公開作品はありません。'}</p>}</> : works.length ? <WorkCards works={works} /> : <p>{en?'No public works match these filters.':'この条件の公開作品はありません。'}</p>}
    </>}
  </section>;
}
