import { initialLanguage } from './language';

export default async function NotFound() {
  const en = await initialLanguage() === 'en';
  return <main className="online-character">
    <h1>{en ? 'Page not found' : 'ページが見つかりません'}</h1>
    <a href="/discover">{en ? 'Explore characters' : 'キャラクターをさがす'}</a>
  </main>;
}
