import { Screen } from './_runtime/Screen';
import { initialLanguage } from './language';

export const metadata = { title: 'Kyalulu' };
export default async function Home() {
  const en = await initialLanguage() === 'en';
  return <Screen path="/" preview={<main className="online-character">
    <h1>Kyalulu</h1><a href="/discover">{en ? 'Explore characters' : 'キャラクターをさがす'}</a>
  </main>} />;
}
