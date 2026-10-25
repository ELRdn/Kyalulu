import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Input } from './ui/Input';
import Button from './ui/Button';
import Card from './ui/Card';
import { hubItems, hubDetail, previewUrl, type HubItem, type HubResults } from '../lib/hubs';
import '../pages/hubs.css';
import { useLanguage } from '../lib/appContext';
import { friendlyMessage } from '../lib/errors';

export default function HubBrowser({ source }: { source: 'taverncard' | 'sillytavern' }) {
  const language = useLanguage(), en = language === 'en';
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<HubResults | null>(null);
  const [detail, setDetail] = useState<HubItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);
  const active = useRef<AbortController | null>(null);
  const submitted = useRef('');
  const work = async (operation: (signal: AbortSignal) => Promise<void>) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try { await operation(controller.signal); } catch (e) { if (!controller.signal.aborted) setError({ cause: e }); }
    finally { if (active.current === controller) setBusy(false); }
  };
  const search = (q: string, page = 1) => work(async signal => { const data = await hubItems(source, q, page, signal); if (!signal.aborted) { setResult(data); submitted.current = q; setDetail(null); } });
  useEffect(() => { void search(''); return () => active.current?.abort(); }, [source]);
  return <section className="k-hubs" aria-label={en ? 'Hub search' : 'Hub検索'}>
    <p>{en ? 'Public SFW content' : '公開SFWコンテンツ'} · {source === 'sillytavern' ? (en ? 'Only reviewed, pinned versions are listed.' : '内容を確認した固定版だけを掲載しています。') : (en ? 'Items are classified as SFW by the source.' : '配布元でSFWと分類された項目を表示しています。')}</p>
    <form className="k-hub-actions" onSubmit={e => { e.preventDefault(); void search(query); }}><Input aria-label={en ? 'Hub search query' : 'Hubの検索語'} value={query} maxLength={200} onChange={e => setQuery(e.target.value)} placeholder={en ? 'Search names and descriptions' : '名前や説明で探す'} /><Button type="submit" disabled={busy}>{en ? 'Search' : '検索'}</Button></form>
    {busy && <div role="status">{en ? 'Loading…' : '取得中…'} <Button variant="ghost" onClick={() => { active.current?.abort(); setBusy(false); }}>{en ? 'Cancel download' : '取得をキャンセル'}</Button></div>}
    {error && <p role="alert">{friendlyMessage(error.cause, language)}</p>}
    {detail ? <Card><Button variant="ghost" disabled={busy} onClick={() => setDetail(null)}>{en ? 'Back to results' : '一覧へ戻る'}</Button><h2>{detail.name}</h2>
      {detail.thumbnail_url && <img className="k-hub-portrait" src={detail.thumbnail_url} alt="" referrerPolicy="no-referrer" />}
      <p className="k-hub-description">{detail.description}</p><dl><dt>{en ? 'Source' : '出典'}</dt><dd><a href={detail.source_url} target="_blank" rel="noopener noreferrer">{en && 'Open in '}{source === 'taverncard' ? 'TavernCard' : 'SillyTavern Content'}{!en && 'で開く'}</a></dd><dt>{en ? 'Author' : '作者'}</dt><dd>{detail.author ?? (en ? 'Unknown' : '不明')}</dd><dt>{en ? 'License' : 'ライセンス'}</dt><dd>{detail.license ?? (en ? 'Unknown' : '不明')}</dd><dt>{en ? 'Format' : '形式'}</dt><dd>{detail.format}</dd></dl>
      {detail.imported_ids.map(id => <p key={id}><Link to={`/create?edit=${encodeURIComponent(id)}`}>{en ? 'Open imported item' : '取り込み済みの項目を開く'}</Link></p>)}
      <Button disabled={busy} onClick={() => void work(async signal => { const preview = await previewUrl({ url: detail.source_url, format: 'png-v3', non_commercial: false }, signal); if (!signal.aborted) navigate(`/create?preview=${preview.preview_id}`); })}>{en ? 'Review import' : '取り込み内容を確認'}</Button>
    </Card> : <><div className="k-hub-grid">{result?.items.map(item => <Card key={item.id}>
      {item.thumbnail_url && <img className="k-hub-thumb" src={item.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      <h2>{item.name}</h2><p className="k-hub-excerpt">{item.description}</p><p>{item.author ?? (en ? 'Unknown author' : '作者不明')} · {item.format}</p>{item.imported_ids.length > 0 && <p>{en ? 'Imported' : '取り込み済み'}</p>}
      <Button variant="secondary" disabled={busy} onClick={() => void work(async signal => { const data = await hubDetail(source, item.id, signal); if (!signal.aborted) setDetail(data); })}>{en ? 'View details' : '詳細を見る'}</Button>
    </Card>)}</div>
    {!busy && result?.items.length === 0 && <p role="status">{en ? 'No matching SFW content. Try another query or check the next page.' : '条件に合うSFWコンテンツがありません。検索語を変更するか、次のページを確認してください。'}</p>}
    {result && <div className="k-hub-actions"><Button variant="ghost" disabled={busy || result.page === 1} onClick={() => void search(submitted.current, result.page - 1)}>{en ? 'Previous page' : '前のページ'}</Button><span>{en ? `Page ${result.page}` : `${result.page}ページ`}</span><Button variant="ghost" disabled={busy || !result.has_more} onClick={() => void search(submitted.current, result.page + 1)}>{en ? 'Next page' : '次のページ'}</Button></div>}</>}
  </section>;
}
