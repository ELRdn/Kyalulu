import { useId } from 'react';
import './ui/ui.css';
import '../pages/hubs.css';
import { useLanguage } from '../lib/appContext';

const hubs = [
  { name: 'TavernCard', url: 'https://www.taverncard.com' },
  { name: 'RisuRealm', url: 'https://realm.risuai.net' },
  { name: 'SillyTavern Content', url: 'https://github.com/SillyTavern/SillyTavern-Content' },
  { name: 'Tavernary', url: 'https://tavernary.org' },
  { name: 'GitHub', url: 'https://github.com' },
  { name: 'Hugging Face', url: 'https://huggingface.co' },
  { name: 'Character.AI', url: 'https://character.ai', note: '手動移行' },
];

export default function HubLinks() {
  const en = useLanguage() === 'en';
  const titleId = useId();
  return (
    <section className="k-hub-links" aria-labelledby={titleId}>
      <h2 id={titleId}>{en ? 'Open external Hubs' : '外部Hubを開く'}</h2>
      <p>{en ? 'Opens in a new tab. These sites may include content outside Kyalulu’s SFW listings.' : '新しいタブで開きます。各サイトの公開範囲はKyaluluのSFW一覧と異なります。'}</p>
      <nav className="k-hub-links__buttons" aria-label={en ? 'External Hub links' : '外部Hubへのリンク'}>
        {hubs.map(hub => (
          <a key={hub.name} href={hub.url} target="_blank" rel="noopener noreferrer"
            className="k-btn k-btn--secondary k-btn--md k-hub-links__link"
            aria-label={en ? `Open ${hub.name} (new tab${hub.note ? '; manual migration' : ''})` : `${hub.name}を開く（新しいタブ${hub.note ? `・${hub.note}` : ''}）`}>
            <span>{hub.name}{hub.note && <small> · {en ? 'Manual migration' : hub.note}</small>}</span>
            <span aria-hidden="true">↗</span>
          </a>
        ))}
      </nav>
    </section>
  );
}
