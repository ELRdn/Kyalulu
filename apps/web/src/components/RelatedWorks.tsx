import { useEffect, useMemo, useState } from 'react';
import { fetchPublicWorks, type PublicWork } from '../lib/community';
import { relatedPublicWorks } from '../lib/relatedWorks';
import { friendlyMessage } from '../lib/errors';
import { WorkCards } from './CommunityWorks';
import Button from './ui/Button';
import { useLanguage } from '../lib/appContext';

export default function RelatedWorks({ work }: { work: PublicWork }) {
  const language = useLanguage(), en = language === 'en';
  const [candidates, setCandidates] = useState<PublicWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null); setCandidates([]);
    fetchPublicWorks('', '', abort.signal).then(value => { if (!abort.signal.aborted) setCandidates(value); })
      .catch(error => { if (!abort.signal.aborted) setError({ cause: error }); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [work.id, work.revision, retry]);
  const related = useMemo(() => relatedPublicWorks(work, candidates), [work, candidates]);
  return <section className="k-section"><h2>{en ? 'Related works' : '関連作品'}</h2>
    <p className="k-page-sub">{en ? 'Selected by matching tags and words in the titles and descriptions of retrieved public works.' : '取得できた公開作品のタグ・作品名・紹介文の語句一致で選んでいます。'}</p>
    {error ? <p role="alert">{friendlyMessage(error.cause, language)}<Button size="sm" onClick={() => setRetry(value => value + 1)}>{en ? 'Reload' : '再読込'}</Button></p> : loading ? <p role="status">{en ? 'Checking related works…' : '関連作品を確認しています…'}</p> : related.length ? <WorkCards works={related} /> : <p>{en ? 'No matching related works.' : '一致する関連作品はありません。'}</p>}
  </section>;
}
