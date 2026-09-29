import { useEffect, useState, type ImgHTMLAttributes, type AnchorHTMLAttributes } from 'react';
import { apiFetch } from '../lib/transport';
import { activeRemote } from '../lib/remoteStore';

/** Runtime-owned images must go through the same encrypted transport as chat. */
export function RuntimeImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const remote = !!activeRemote();
  const privateImage = typeof src === 'string' && src.startsWith('/api/');
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  useEffect(() => {
    if (!remote || !privateImage || !src) return;
    const abort = new AbortController(); let url: string | undefined;
    void apiFetch(src, { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('image_unavailable');
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp|gif|apng|avif)$/.test(blob.type)) throw new Error('invalid_image_type');
      if (abort.signal.aborted) return;
      url = URL.createObjectURL(blob); setImage({ source: src, url });
    }).catch(() => { if (!abort.signal.aborted) setImage(null); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [src, remote, privateImage]);
  // Remote character metadata cannot cause unsolicited requests to third-party hosts.
  const safe = !remote || (typeof src === 'string' && /^\/(?:mascot\/[a-z0-9-]+\.webp|icons\/[a-z0-9-]+\.png|apple-touch-icon\.png)$/.test(src));
  const resolved = remote && privateImage ? (image?.source === src ? image.url : undefined) : safe ? src : undefined;
  return resolved ? <img {...props} src={resolved} srcSet={remote ? undefined : props.srcSet} /> : <span className={props.className} role="img" aria-label={props.alt || '画像未取得'} />;
}

export function RuntimeDownload({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <><a {...props} href={activeRemote() ? undefined : href} role="button" tabIndex={0}
    aria-disabled={busy} onClick={async event => {
      if (!activeRemote()) return;
      event.preventDefault(); if (busy || !href?.startsWith('/api/')) return;
      setBusy(true); setError('');
      try {
        const response = await apiFetch(href, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error('書き出しを取得できませんでした。');
        const url = URL.createObjectURL(await response.blob());
        const a = document.createElement('a'); a.href = url;
        a.download = typeof props.download === 'string' ? props.download : 'kyalulu-export';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (e) { setError(e instanceof Error ? e.message : '書き出しに失敗しました。'); }
      finally { setBusy(false); }
    }}>{busy ? '取得中…' : children}</a>{error && <span role="alert">{error}</span>}</>;
}
