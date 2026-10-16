import { useEffect, useState } from 'react';
import type { PortableAsset } from '../lib/library';
import { playableAsset } from '../lib/media';
import { apiFetch } from '../lib/transport';
import { activeRemote } from '../lib/remoteStore';
import { RuntimeImage } from './RuntimeMedia';
import Button from './ui/Button';

function MediaPlayer({ asset }: { asset: PortableAsset }) {
  const playable = playableAsset(asset);
  const remote = !!activeRemote();
  const [requested, setRequested] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!remote || !requested || !playable || playable.kind === 'image') return;
    const abort = new AbortController(); let url: string | undefined;
    setObjectUrl(null); setError('');
    apiFetch(playable.src, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw Error('媒体を取得できませんでした。');
      const blob = await response.blob();
      if (blob.size > 32 * 1024 * 1024 || !blob.type.startsWith(`${playable.kind}/`)) throw Error('再生できる形式・サイズではありません。');
      if (!abort.signal.aborted) { url = URL.createObjectURL(blob); setObjectUrl(url); }
    }).catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [asset.asset_id, requested, remote, retry]);
  if (!playable) return <p>{asset.name}：この接続先に保存された対応媒体がありません。外部URLは自動取得しません。</p>;
  if (playable.kind === 'image') return <figure><RuntimeImage src={playable.src} alt={asset.name} loading="lazy" style={{ maxWidth: '100%' }} /><figcaption>{asset.name}</figcaption></figure>;
  const src = remote ? objectUrl ?? undefined : playable.src;
  return <div><p>{asset.name}</p>{remote && !src && <Button size="sm" disabled={requested && !error} onClick={() => { setError(''); setRequested(true); setRetry(value => value + 1); }}>再生用に取得</Button>}
    {playable.kind === 'video' ? <video src={src} controls autoPlay={false} preload="none" aria-label={asset.name} onError={() => setError('このブラウザーで動画を再生できません。ファイルのcodec・形式を確認してください。')} style={{ maxWidth: '100%' }} /> : <audio src={src} controls autoPlay={false} preload="none" aria-label={asset.name} onError={() => setError('このブラウザーで音声を再生できません。ファイルの形式を確認してください。')} style={{ maxWidth: '100%' }} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
export default function PortableMedia({ assets }: { assets: PortableAsset[] }) {
  if (!assets.length) return null;
  return <details className="k-context-section"><summary>作品の画像・音声・動画・音楽</summary>
    <p className="k-context-note">自動再生はしません。外部生成は接続先が対応したときに利用できます。</p>
    {assets.map((asset, index) => <MediaPlayer key={`${asset.asset_id ?? asset.uri}:${index}`} asset={asset} />)}
  </details>;
}
