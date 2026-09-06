import { LibraryItemSchema, ImportPreviewSchema, PortableAssetSchema } from '../../../../packages/schemas/src/portable';
import type { LibraryItem, ImportCommit, PortableDocument } from '../../../../packages/schemas/src/portable';
export * from '../../../../packages/schemas/src/portable';

export async function libraryRequest(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: 'no-store', ...init });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) || `HTTP ${r.status}`);
  return body;
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const fetchLibrary = async (nsfw = false): Promise<LibraryItem[]> => (await libraryRequest(`/api/library?include_nsfw=${nsfw}`)).items.map((item: unknown) => LibraryItemSchema.parse(item));
export const fetchLibraryItem = async (id: string, revision?: number) => LibraryItemSchema.parse(await libraryRequest(`/api/library/${encodeURIComponent(id)}${revision ? `?revision=${revision}` : ''}`));
export async function previewFile(file: File) {
  const body = new FormData(); body.set('file', file);
  return ImportPreviewSchema.parse(await libraryRequest('/api/imports/preview', { method: 'POST', body }));
}
export const previewText = async (text: string) => ImportPreviewSchema.parse(await libraryRequest('/api/imports/text/preview', json({ text })));
export async function commitImport(id: string, body: ImportCommit): Promise<{ items: LibraryItem[]; sessions: { session_id: string; name: string; character_id: string }[] }> {
  const result = await libraryRequest(`/api/imports/${encodeURIComponent(id)}/commit`, json(body));
  return { items: result.items.map((item: unknown) => LibraryItemSchema.parse(item)), sessions: result.sessions };
}
export const saveLibraryItem = async (document: PortableDocument, item?: LibraryItem) => LibraryItemSchema.parse(await libraryRequest(item ? `/api/library/${item.id}` : '/api/library', json(item ? { document, expected_revision: item.revision } : document, item ? 'PUT' : 'POST')));
export async function uploadAsset(file: File) {
  const body = new FormData(); body.set('file', file);
  return PortableAssetSchema.parse(await libraryRequest('/api/library/assets', { method: 'POST', body }));
}
export const assetUrl = (id?: string | null) => id ? `/api/library/assets/${id}` : undefined;
