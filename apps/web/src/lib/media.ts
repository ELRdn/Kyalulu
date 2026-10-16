import type { PortableAsset } from './library';

export type PlayableAsset = { src: string; kind: 'image' | 'audio' | 'video' };
/** Only owned Runtime assets are fetched automatically; imported URLs remain inert. */
export function playableAsset(asset: PortableAsset): PlayableAsset | null {
  if (!asset.asset_id || !/^[a-zA-Z0-9_-]+$/.test(asset.asset_id)) return null;
  const mime = asset.media_type.toLowerCase();
  const kind = /^image\/(png|jpeg|webp|gif|apng|avif)$/.test(mime) ? 'image'
    : /^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|mp4|aac|flac)$/.test(mime) ? 'audio'
    : /^video\/(mp4|webm|ogg)$/.test(mime) ? 'video' : null;
  return kind ? { src: `/api/library/assets/${asset.asset_id}`, kind } : null;
}
