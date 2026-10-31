import { useEffect, useRef, useState, type ImgHTMLAttributes, type AnchorHTMLAttributes } from 'react';
import { apiFetch } from '../lib/transport';
import { activeRemote, connectionScope } from '../lib/remoteStore';
import { useDeviceOwner, useExecutionTarget, useLanguage } from '../lib/appContext';
import { cloudEpoch } from '../lib/cloudMode';
import { runtimeDownload } from '../lib/runtimeDownload';

/** Runtime-owned images must go through the same encrypted transport as chat. */
export function RuntimeImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const target = useExecutionTarget(), owner = useDeviceOwner();
  const remote = !!activeRemote() || target === 'device';
  const scope = typeof window === 'undefined' ? '' : connectionScope();
  const privateImage = typeof src === 'string' && src.startsWith('/api/');
  const [image, setImage] = useState<{ source: string; scope: string; url: string } | null>(null);
  useEffect(() => {
    if (!remote || !privateImage || !src) return;
    const abort = new AbortController(), epoch = cloudEpoch(); let url: string | undefined;
    void apiFetch(src, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('image_unavailable');
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp|gif|apng|avif)$/.test(blob.type)) throw new Error('invalid_image_type');
      if (abort.signal.aborted || connectionScope() !== scope || cloudEpoch() !== epoch) return;
      url = URL.createObjectURL(blob); setImage({ source: src, scope, url });
    }).catch(() => { if (!abort.signal.aborted) setImage(null); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, remote, privateImage, scope, owner]);
  // Private Runtime metadata cannot cause unsolicited requests to third-party hosts.
  const safe = !remote || (typeof src === 'string' && /^\/(?:mascot\/[a-z0-9-]+\.webp|icons\/[a-z0-9-]+\.png|apple-touch-icon\.png)$/.test(src));
  const resolved = remote && privateImage ? (image?.source === src && image.scope === scope ? image.url : undefined) : safe ? src : undefined;
  return resolved ? <img {...props} src={resolved} srcSet={remote ? undefined : props.srcSet} /> : <span className={props.className} role="img" aria-label={props.alt || '画像未取得'} />;
}

export function RuntimeDownload({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const en = useLanguage() === 'en';
  const runtime = href?.startsWith('/api/');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const flight = useRef<AbortController | null>(null);
  useEffect(() => () => { flight.current?.abort(); }, []);
  return <><a {...props} href={runtime ? undefined : href} role={runtime ? 'button' : props.role} tabIndex={props.tabIndex ?? 0}
    aria-disabled={busy} onKeyDown={event => {
      props.onKeyDown?.(event);
      if (runtime && !event.defaultPrevented && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.currentTarget.click(); }
    }} onClick={async event => {
      props.onClick?.(event);
      if (!runtime || event.defaultPrevented) return;
      event.preventDefault(); if (flight.current) return;
      const abort = new AbortController();
      flight.current = abort;
      setBusy(true); setError('');
      try {
        await runtimeDownload(href!, typeof props.download === 'string' ? props.download : undefined, en, abort.signal);
      } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : en ? 'Export failed.' : '書き出しに失敗しました。'); }
      finally { flight.current = null; if (!abort.signal.aborted) setBusy(false); }
    }}>{busy ? en ? 'Downloading…' : '取得中…' : children}</a>{error && <span role="alert">{error}</span>}</>;
}
