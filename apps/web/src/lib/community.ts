import { PublicWorkSchema, CommentSchema, type PublicWork, type WorkComment, PublicAuthorSchema } from '../../../../packages/schemas/src/community';
export type { PublicWork, WorkComment } from '../../../../packages/schemas/src/community';
import { libraryRequest } from './library';
const path = (id: string) => `/api/community/works/${encodeURIComponent(id)}`;
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchPublicWorks(q = '', tag = '', signal?: AbortSignal): Promise<PublicWork[]> {
  const data = await libraryRequest(`/api/community/works?${new URLSearchParams({ q, tag })}`, { signal });
  return data.works.map((work: unknown) => PublicWorkSchema.parse(work));
}
export const fetchPublicWork = async (id: string) => PublicWorkSchema.parse(await libraryRequest(path(id)));
export const publishWork = async (item_id: string, revision: number) => PublicWorkSchema.parse(await libraryRequest('/api/community/works', json({ item_id, revision })));
export const withdrawWork = (id: string) => libraryRequest(path(id), { method: 'DELETE' });
export const reactToWork = async (id: string, kind: 'like' | 'save', active: boolean) => PublicWorkSchema.parse(await libraryRequest(`${path(id)}/reaction`, json({ kind, active }, 'PUT')));
export async function workComments(id: string, text?: string, request_id?: string): Promise<WorkComment[]> {
  const data = await libraryRequest(`${path(id)}/comments`, text === undefined ? undefined : json({ text, request_id }));
  return data.comments.map((comment: unknown) => CommentSchema.parse(comment));
}
export const followAuthor = (id: string, active: boolean) => libraryRequest(`/api/community/authors/${encodeURIComponent(id)}/follow`, json({ active }, 'PUT'));
export const blockAuthor = (id: string, active: boolean) => libraryRequest(`/api/community/authors/${encodeURIComponent(id)}/block`, json({ active }, 'PUT'));
export const reportWork = (work_id: string, reason: string) => libraryRequest('/api/community/reports', json({ work_id, reason }));
export async function fetchPublicAuthor(id: string) {
  return PublicAuthorSchema.parse(await libraryRequest(`/api/community/authors/${encodeURIComponent(id)}`));
}
