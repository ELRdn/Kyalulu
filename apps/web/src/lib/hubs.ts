import { HubItemSchema, HubResultsSchema, RemoteSourceSchema, type UrlImport } from '../../../../packages/schemas/src/hub';
import { ImportPreviewSchema, libraryRequest } from './library';
export * from '../../../../packages/schemas/src/hub';
export const hubItems = async (source: string, q: string, page: number, signal: AbortSignal) => HubResultsSchema.parse(await libraryRequest(`/api/hubs/${source}/items?${new URLSearchParams({ q, page: String(page) })}`, { signal }));
export const hubDetail = async (source: string, id: string, signal: AbortSignal) => HubItemSchema.parse(await libraryRequest(`/api/hubs/${source}/items/${encodeURIComponent(id)}`, { signal }));
export const fetchPreview = async (id: string, signal?: AbortSignal) => ImportPreviewSchema.parse(await libraryRequest(`/api/imports/${encodeURIComponent(id)}`, { signal }));

export async function previewUrl(body: UrlImport, signal: AbortSignal) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
  const remote = RemoteSourceSchema.parse(await libraryRequest('/api/imports/url/resolve', init));
  if (remote.transport === 'server') return ImportPreviewSchema.parse(await libraryRequest('/api/imports/url/preview', init));
  const url = new URL(remote.download_url);
  if (remote.source !== 'risurealm' || url.origin !== 'https://realm.risuai.net' || !/^\/api\/v1\/download\/(png-v3|json-v3|lorebook-v[23]|preset-st-chat)\/[a-f0-9-]+$/.test(url.pathname)) throw new Error('未対応のブラウザー取得先です。');
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  if (!response.ok) {
    const messages: Record<number, string> = { 403: '配布元がこの形式・利用条件での取得を許可していません。', 404: '公開コンテンツが見つかりません。', 429: '配布元の取得制限です。時間を置いて再試行してください。' };
    throw new Error(messages[response.status] ?? `配布元のエラー（HTTP ${response.status}）`);
  }
  const limit = 32 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('ファイルが32 MiBを超えています。'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('取得データがありません。');
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > limit) throw new Error('ファイルが32 MiBを超えています。');
      chunks.push(new Uint8Array(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const form = new FormData(); form.set('file', new File(chunks, remote.filename)); form.set('remote', JSON.stringify(body));
  return ImportPreviewSchema.parse(await libraryRequest('/api/imports/preview', { method: 'POST', body: form, signal }));
}
