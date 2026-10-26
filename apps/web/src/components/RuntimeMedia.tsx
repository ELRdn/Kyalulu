import { useEffect, useRef, useState, type ImgHTMLAttributes, type AnchorHTMLAttributes } from 'react';
import { apiFetch } from '../lib/transport';
import { activeRemote, connectionScope } from '../lib/remoteStore';
import { executionTarget, useDeviceOwner, useExecutionTarget, useLanguage } from '../lib/appContext';
import { cloudEpoch } from '../lib/cloudMode';

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
  const flight = useRef(false);
  return <><a {...props} href={runtime ? undefined : href} role={runtime ? 'button' : props.role} tabIndex={props.tabIndex ?? 0}
    aria-disabled={busy} onKeyDown={event => {
      props.onKeyDown?.(event);
      if (runtime && !event.defaultPrevented && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.currentTarget.click(); }
    }} onClick={async event => {
      props.onClick?.(event);
      if (!runtime || event.defaultPrevented) return;
      event.preventDefault(); if (flight.current) return;
      flight.current = true;
      setBusy(true); setError('');
      const scope = connectionScope(), epoch = cloudEpoch(), target = executionTarget();
      try {
        const response = await apiFetch(href!, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(en ? 'Could not retrieve the export.' : '書き出しを取得できませんでした。');
        const blob = await response.blob();
        if (connectionScope() !== scope || cloudEpoch() !== epoch || executionTarget() !== target) throw new Error(en ? 'Account or execution target changed. Export again.' : 'アカウントまたは実行先が変わりました。書き出し直してください。');
        const disposition = response.headers.get('Content-Disposition') ?? '';
        const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        let name = disposition.match(/filename="([^"]+)"/i)?.[1] ?? (blob.type.includes('json') ? 'kyalulu-export.json' : 'kyalulu-export');
        if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* Keep a usable fallback for a malformed header. */ } }
        name = (typeof props.download === 'string' ? props.download : name).split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, '') || 'kyalulu-export';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = name;
        try { document.body.appendChild(a); a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      } catch (e) { setError(e instanceof Error ? e.message : en ? 'Export failed.' : '書き出しに失敗しました。'); }
      finally { flight.current = false; setBusy(false); }
    }}>{busy ? en ? 'Downloading…' : '取得中…' : children}</a>{error && <span role="alert">{error}</span>}</>;
}
