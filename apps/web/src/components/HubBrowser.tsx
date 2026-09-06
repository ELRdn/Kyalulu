import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from './ui/Input';
import Button from './ui/Button';
import Card from './ui/Card';
import { hubItems, hubDetail, previewUrl, type HubItem, type HubResults } from '../lib/hubs';
import '../pages/hubs.css';

export default function HubBrowser({ source }: { source: 'taverncard' | 'sillytavern' }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<HubResults | null>(null);
  const [detail, setDetail] = useState<HubItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const submitted = useRef('');
  const work = async (operation: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); setError('');
    try { await operation(controller.signal); } catch (e) { if (!controller.signal.aborted) setError(String(e)); }
    finally { if (active.current === controller) setBusy(false); }
  };
  const search = (q: string, page = 1) => work(async signal => { const data = await hubItems(source, q, page, signal); if (!signal.aborted) { setResult(data); submitted.current = q; setDetail(null); } });
  useEffect(() => { void search(''); return () => active.current?.abort(); }, [source]);
  return <section className="k-hubs" aria-label="Hub検索">
    <p>公開SFWコンテンツ · {source === 'sillytavern' ? '内容を確認した固定版だけを掲載しています。' : '配布元でSFWと分類された項目を表示しています。'}</p>
    <form className="k-hub-actions" onSubmit={e => { e.preventDefault(); void search(query); }}><Input aria-label="Hubの検索語" value={query} maxLength={200} onChange={e => setQuery(e.target.value)} placeholder="名前や説明で探す" /><Button type="submit" disabled={busy}>検索</Button></form>
    {busy && <div role="status">取得中… <Button variant="ghost" onClick={() => { active.current?.abort(); setBusy(false); }}>取得をキャンセル</Button></div>}
    {error && <p role="alert">{error}</p>}
    {detail ? <Card><Button variant="ghost" disabled={busy} onClick={() => setDetail(null)}>一覧へ戻る</Button><h2>{detail.name}</h2>
      {detail.thumbnail_url && <img className="k-hub-portrait" src={detail.thumbnail_url} alt="" referrerPolicy="no-referrer" />}
      <p className="k-hub-description">{detail.description}</p><dl><dt>出典</dt><dd><a href={detail.source_url} target="_blank" rel="noopener noreferrer">{source === 'taverncard' ? 'TavernCard' : 'SillyTavern Content'}で開く</a></dd><dt>作者</dt><dd>{detail.author ?? '不明'}</dd><dt>ライセンス</dt><dd>{detail.license ?? '不明'}</dd><dt>形式</dt><dd>{detail.format}</dd></dl>
      {detail.imported_ids.map(id => <p key={id}><Link to={`/create?edit=${encodeURIComponent(id)}`}>取り込み済みの項目を開く</Link></p>)}
      <Button disabled={busy} onClick={() => void work(async signal => { const preview = await previewUrl({ url: detail.source_url, format: 'png-v3', non_commercial: false }, signal); if (!signal.aborted) navigate(`/create?preview=${preview.preview_id}`); })}>取り込み内容を確認</Button>
    </Card> : <><div className="k-hub-grid">{result?.items.map(item => <Card key={item.id}>
      {item.thumbnail_url && <img className="k-hub-thumb" src={item.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <h2>{item.name}</h2><p className="k-hub-excerpt">{item.description}</p><p>{item.author ?? '作者不明'} · {item.format}</p>{item.imported_ids.length > 0 && <p>取り込み済み</p>}
      <Button variant="secondary" disabled={busy} onClick={() => void work(async signal => { const data = await hubDetail(source, item.id, signal); if (!signal.aborted) setDetail(data); })}>詳細を見る</Button>
    </Card>)}</div>
    {!busy && result?.items.length === 0 && <p role="status">条件に合うSFWコンテンツがありません。検索語を変更するか、次のページを確認してください。</p>}
    {result && <div className="k-hub-actions"><Button variant="ghost" disabled={busy || result.page === 1} onClick={() => void search(submitted.current, result.page - 1)}>前のページ</Button><span>{result.page}ページ</span><Button variant="ghost" disabled={busy || !result.has_more} onClick={() => void search(submitted.current, result.page + 1)}>次のページ</Button></div>}</>}
  </section>;
}
