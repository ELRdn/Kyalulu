import { useEffect, useMemo, useState } from 'react';
import { fetchPublicWorks, type PublicWork } from '../lib/community';
import { relatedPublicWorks } from '../lib/relatedWorks';
import { friendlyMessage } from '../lib/errors';
import { WorkCards } from './CommunityWorks';
import Button from './ui/Button';

export default function RelatedWorks({ work }: { work: PublicWork }) {
  const [candidates, setCandidates] = useState<PublicWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(''); setCandidates([]);
    fetchPublicWorks('', '', abort.signal).then(value => { if (!abort.signal.aborted) setCandidates(value); })
      .catch(error => { if (!abort.signal.aborted) setError(friendlyMessage(error)); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [work.id, work.revision, retry]);
  const related = useMemo(() => relatedPublicWorks(work, candidates), [work, candidates]);
  return <section className="k-section"><h2>関連作品</h2>
    <p className="k-page-sub">取得できた公開作品のタグ・作品名・紹介文の語句一致で選んでいます。</p>
    {error ? <p role="alert">{error}<Button size="sm" onClick={() => setRetry(value => value + 1)}>再読込</Button></p> : loading ? <p role="status">関連作品を確認しています…</p> : related.length ? <WorkCards works={related} /> : <p>一致する関連作品はありません。</p>}
  </section>;
}
