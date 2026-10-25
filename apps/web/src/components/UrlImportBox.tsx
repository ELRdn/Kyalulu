import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import { Input } from './ui/Input';
import { previewUrl, RisuFormatSchema, type UrlImport } from '../lib/hubs';
import type { ImportPreview } from '../lib/library';
import { friendlyMessage } from '../lib/errors';
import '../pages/hubs.css';
import { useLanguage } from '../lib/appContext';

export default function UrlImportBox({ onPreview, disabled = false, onBusyChange }: { onPreview: (value: ImportPreview) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const language=useLanguage(),en=language==='en';
  const [url, setUrl] = useState(() => { try { return sessionStorage.getItem('kyalulu-hub-url') ?? ''; } catch { return ''; } });
  const [format, setFormat] = useState<UrlImport['format']>('png-v3');
  const [nonCommercial, setNonCommercial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error|string>('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const submit = async () => {
    if (disabled || busy) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    setBusy(true); onBusyChange?.(true); setError('');
    try { const result = await previewUrl({ url: url.trim(), format, non_commercial: nonCommercial }, controller.signal); if (!controller.signal.aborted) onPreview(result); }
    catch (e) { if (!controller.signal.aborted) setError(e instanceof Error?e:String(e)); }
    finally { if (active.current === controller) { setBusy(false); onBusyChange?.(false); } }
  };
  return <section className="k-url-import" aria-label={en?'URL import':'URL取り込み'}><h3 className="k-url-import__title">{en?'Import a public URL':'公開URLから取り込む'}</h3><p className="k-url-import__desc">{en?'Supports TavernCard, RisuRealm, GitHub and Hugging Face URLs.':'TavernCard・RisuRealm・GitHub・Hugging FaceのURLに対応しています。'}</p>
    <form className="k-url-import__form" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <Input type="url" aria-label={en?'Public URL to import':'取り込む公開URL'} maxLength={2048} placeholder="https://…" value={url} onChange={e => { setUrl(e.target.value); try { sessionStorage.setItem('kyalulu-hub-url', e.target.value); } catch { /* Input remains in memory if storage is full. */ } }} />
      {url.includes('realm.risuai.net') && <><label>{en?'RisuRealm download format':'RisuRealmの取得形式'}<select aria-label={en?'RisuRealm download format':'RisuRealmの取得形式'} value={format} onChange={e => setFormat(RisuFormatSchema.parse(e.target.value))}>{RisuFormatSchema.options.map(f => <option key={f}>{f}</option>)}</select></label><label><input type="checkbox" checked={nonCommercial} onChange={e => setNonCommercial(e.target.checked)} /> {en?'Retrieve for non-commercial use':'非商用利用として取得する'}</label><small>{en?'Custom Modules, custom presets and CHARX retrieval are not supported.':'独自Module・独自プリセット・CHARXの取得には対応していません。'}</small></>}
      <div className="k-hub-actions"><Button type="submit" disabled={busy || disabled || !url.trim()}>{busy ? (en?'Retrieving…':'取得中…') : (en?'Review URL content':'URLの内容を確認')}</Button>{busy && <Button variant="ghost" type="button" onClick={() => { active.current?.abort(); setBusy(false); onBusyChange?.(false); }}>{en?'Cancel retrieval':'取得をキャンセル'}</Button>}</div>
    </form>{error && <p className="k-inline-error" role="alert">{friendlyMessage(error,language)}</p>}
  </section>;
}
