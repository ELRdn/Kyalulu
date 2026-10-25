import { useEffect, useState } from 'react';
import type { PortableAsset } from '../lib/library';
import { playableAsset } from '../lib/media';
import { apiFetch } from '../lib/transport';
import { activeRemote, connectionScope } from '../lib/remoteStore';
import { executionTarget, useDeviceOwner, useExecutionTarget, useLanguage } from '../lib/appContext';
import { cloudEpoch } from '../lib/cloudMode';
import { RuntimeImage } from './RuntimeMedia';
import Button from './ui/Button';

function MediaPlayer({ asset, transport, scope }: { asset: PortableAsset; transport:boolean; scope:string }) {
  const playable = playableAsset(asset);
  const en = useLanguage() === 'en';
  const [requested, setRequested] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!transport || !requested || !playable || playable.kind === 'image') return;
    const abort = new AbortController(), epoch=cloudEpoch(), target=executionTarget(); let url: string | undefined;
    setObjectUrl(null); setError('');
    apiFetch(playable.src, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw Error(en ? 'Could not retrieve media.' : '媒体を取得できませんでした。');
      const blob = await response.blob();
      if (blob.size > 32 * 1024 * 1024 || !blob.type.startsWith(`${playable.kind}/`)) throw Error(en ? 'Unsupported media type or size.' : '再生できる形式・サイズではありません。');
      if (!abort.signal.aborted && connectionScope()===scope && cloudEpoch()===epoch && executionTarget()===target) { url = URL.createObjectURL(blob); setObjectUrl(url); }
    }).catch(error => { if (!abort.signal.aborted) setError(String(error)); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [asset.asset_id, asset.media_type, requested, transport, scope, retry, en]);
  if (!playable) return <p>{asset.name}：{en ? 'No supported media stored at this connection. External URLs are not fetched automatically.' : 'この接続先に保存された対応媒体がありません。外部URLは自動取得しません。'}</p>;
  if (playable.kind === 'image') return <figure><RuntimeImage src={playable.src} alt={asset.name} loading="lazy" style={{ maxWidth: '100%' }} /><figcaption>{asset.name}</figcaption></figure>;
  const src = transport ? objectUrl ?? undefined : playable.src;
  return <div><p>{asset.name}</p>{transport && !src && <Button size="sm" disabled={requested && !error} onClick={() => { setError(''); setRequested(true); setRetry(value => value + 1); }}>{en ? 'Load for playback' : '再生用に取得'}</Button>}
    {playable.kind === 'video' ? <video src={src} controls autoPlay={false} preload="none" aria-label={asset.name} onError={() => setError(en ? 'This browser cannot decode this video. Check its codec and format.' : 'このブラウザーで動画を再生できません。ファイルのcodec・形式を確認してください。')} style={{ maxWidth: '100%' }} /> : <audio src={src} controls autoPlay={false} preload="none" aria-label={asset.name} onError={() => setError(en ? 'This browser cannot decode this audio. Check its format.' : 'このブラウザーで音声を再生できません。ファイルの形式を確認してください。')} style={{ maxWidth: '100%' }} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}
export default function PortableMedia({ assets }: { assets: PortableAsset[] }) {
  const target=useExecutionTarget(),owner=useDeviceOwner(),en=useLanguage()==='en';
  const scope=typeof window==='undefined'?'':connectionScope(),epoch=cloudEpoch(),transport=!!activeRemote()||target==='device';
  if (!assets.length) return null;
  return <details className="k-context-section"><summary>{en ? 'Work images, audio, video and music' : '作品の画像・音声・動画・音楽'}</summary>
    <p className="k-context-note">{en ? 'Media never autoplays. External generation is available only on supported connections.' : '自動再生はしません。外部生成は接続先が対応したときに利用できます。'}</p>
    {assets.map((asset, index) => <MediaPlayer key={`${scope}:${epoch}:${target}:${owner}:${asset.asset_id ?? asset.uri}:${asset.media_type}:${index}`} asset={asset} transport={transport} scope={scope} />)}
  </details>;
}
