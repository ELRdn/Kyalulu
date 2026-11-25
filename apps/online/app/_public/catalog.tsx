import { cache } from 'react';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Screen } from '../_runtime/Screen';
import type { ScreenPath } from '../_runtime/views';
import { initialLanguage } from '../language';
import { publicOrigin } from './origin';

async function anonymousRead<T>(path: string): Promise<T | null> {
  // The viewer may have blocked an author or have different rating permissions.
  // Authenticated browser reads go through the existing scoped transport.
  if ((await cookies()).has('__Host-kyalulu_cloud')) return null;
  const response = await fetch(new URL(path, publicOrigin()), {
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) notFound();
  if (!response.ok) return null;
  return response.json();
}

type Entry = { id: string; name: string; description?: string };
const detailRoutes = {
  published: { api: null, path: '/published/:publicationId', ja: '公開作品', en: 'Published work' },
  works: { api: '/api/community/works/', path: '/works/:workId', ja: '作品', en: 'Work' },
  authors: { api: '/api/community/authors/', path: '/authors/:authorId', ja: '作者', en: 'Author' },
} as const;
type Kind = keyof typeof detailRoutes;

const detail = cache(async (kind: Kind, id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) notFound();
  const api = detailRoutes[kind].api;
  // Unified publications require the browser's eligibility receipt even for general-audience works.
  if (!api) return null;
  const result = await anonymousRead<Entry>(api + encodeURIComponent(id));
  if (!result) return null;
  return { name: result.name, description: result.description || '' };
});

export async function detailMetadata(kind: Kind, id: string): Promise<Metadata> {
  const value = await detail(kind, id);
  const label = detailRoutes[kind][await initialLanguage()];
  const title = (value?.name || label) + ' | Kyalulu';
  const url = new URL('/' + kind + '/' + encodeURIComponent(id), publicOrigin());
  return { title, description: value?.description, alternates: { canonical: url },
    openGraph: { title, url, description: value?.description, images: [new URL('/apple-touch-icon.png', url)] } };
}

export async function DetailPage({ kind, id }: { kind: Kind; id: string }) {
  const value = await detail(kind, id);
  return <Screen path={detailRoutes[kind].path} preview={value && <main className="online-character">
    <h1>{value.name}</h1><p>{value.description}</p>
  </main>} />;
}

type Query = Record<string, string | string[] | undefined>;
export async function BrowsePage({ path, query }: { path: Extract<ScreenPath, '/discover' | '/published'>; query: Query }) {
  const english = await initialLanguage() === 'en';
  const names = path === '/discover' ? [english ? 'Explore' : 'さがす', '/characters/'] : [english ? 'Approved works' : '承認済みの作品', '/published/'];
  let entries: { id: string; name: string }[] = [];
  if (path === '/discover' && Object.keys(query).length === 0) {
    const data = await anonymousRead<{ characters: { id: string; display_name: string }[] }>('/api/characters');
    entries = (data?.characters || []).map(item => ({ id: item.id, name: item.display_name }));
  }
  return <Screen path={path} preview={<main className="online-character">
    <h1>{names[0]}</h1>
    <ul>{entries.map(entry => <li key={entry.id}><a href={names[1] + encodeURIComponent(entry.id)}>{entry.name}</a></li>)}</ul>
  </main>} />;
}
