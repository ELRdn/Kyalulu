import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import mochaPortrait from '../../../../web/public/icons/mocha-1.png';
import type { CharacterOpening } from '../../../../web/src/lib/characterHandoff';
import CharacterComposer from './CharacterComposer';
import { initialLanguage } from '../../language';
import { publicOrigin } from '../../_public/origin';
import { Screen } from '../../_runtime/Screen';
import { runtimeScriptPaths } from '../../_runtime/runtimeScriptPaths';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ characterId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
type Card = { id: string; display_name: string; description: string; portrait_url: string | null; opening?: CharacterOpening };

const readCard = cache(async (id: string): Promise<Card | null> => {
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) notFound();
  const url = new URL('/api/cloud/public/characters/' + id + '?opening=true', publicOrigin());
  const response = await fetch(url, {
    cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Character catalog returned HTTP ' + response.status);
  return response.json();
});

function portrait(card: Card) {
  return card.portrait_url && /^\/icons\/[\w.-]+$/.test(card.portrait_url)
    ? card.portrait_url : '/apple-touch-icon.png';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = await readCard((await params).characterId);
  if (!card) return { title: 'Kyalulu' };
  const url = new URL('/characters/' + card.id, publicOrigin());
  const title = card.display_name + ' | Kyalulu';
  return { title, description: card.description, alternates: { canonical: url },
    openGraph: { title, description: card.description, url, images: [new URL(portrait(card), url)] } };
}

export default async function CharacterPage({ params, searchParams }: Props) {
  const [{ characterId }, query] = await Promise.all([params, searchParams]);
  const card = await readCard(characterId);
  if (!card || query.view === 'profile' || query.start || query.login_error) {
    return <Screen path="/characters/:characterId" opening={query.start ? card?.opening : undefined} />;
  }
  const language = await initialLanguage();
  return <main className="online-character">
    <nav><a href="/discover">{language === 'en' ? 'Explore' : 'さがす'}</a></nav>
    <article>
      <h1>{card.display_name}</h1>
      {portrait(card) === '/icons/mocha-1.png'
        ? <Image src={mochaPortrait} alt={card.display_name} sizes="(max-width: 424px) 90vw, 384px" preload />
        : <img src={portrait(card)} alt={card.display_name} width="384" height="384" />}
      <p>{card.description}</p>
      <CharacterComposer key={card.id} character={card.id} opening={card.opening} initialLanguage={language}
        runtimeScripts={card.opening ? runtimeScriptPaths() : []} />
    </article>
  </main>;
}
