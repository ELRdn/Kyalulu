import { useEffect, useState } from 'react';
import type { ChatMessage } from '../lib/api';
import type { PortableAsset } from '../lib/library';
import { useLanguage } from '../lib/appContext';
import { playableAsset } from '../lib/media';
import { RuntimeImage } from './RuntimeMedia';
import MessageContent from './MessageContent';
import ReasoningSummary from './ReasoningSummary';
import Button from './ui/Button';

export default function VisualNovelScene({ messages, name, assets, streaming, cloud = false }: { messages: ChatMessage[]; name: string; assets: PortableAsset[]; streaming: boolean; cloud?: boolean }) {
  const en = useLanguage() === 'en';
  const scenes = messages.filter(message => message.role === 'assistant' && message.content.trim());
  const [index, setIndex] = useState(Math.max(0, scenes.length - 1));
  useEffect(() => setIndex(Math.max(0, scenes.length - 1)), [scenes.length]);
  const scene = scenes[Math.min(index, scenes.length - 1)];
  const background = assets.find(asset => asset.type === 'background');
  const portrait = assets.find(asset => asset.type === 'emotion') ?? assets.find(asset => asset.type === 'icon');
  const backgroundMedia = background && playableAsset(background);
  const portraitMedia = portrait && playableAsset(portrait);
  return <section aria-label={en ? 'Visual novel' : 'ビジュアルノベル表示'} className="k-vn-scene">
    <div className="k-vn-scene__stage">
      {backgroundMedia?.kind === 'image' && <RuntimeImage className="k-vn-scene__background" src={backgroundMedia.src} alt="" />}
      {portraitMedia?.kind === 'image' && <RuntimeImage className="k-vn-scene__portrait" src={portraitMedia.src} alt={portrait?.name ?? name} />}
      <div className="k-vn-scene__dialogue"><strong>{en ? `Story with ${name}` : `${name}との物語`}</strong>
        {scene && !(streaming && index === scenes.length - 1) && <ReasoningSummary key={index} message={scene} cloud={cloud || scene.model_id?.startsWith('cloud-')} />}
        {scene ? <MessageContent content={scene.content} isStreaming={streaming && index === scenes.length - 1} /> : <p>{en ? 'Scenes appear here after the first reply.' : '最初の返事が届くと、ここにシーンを表示します。'}</p>}
      </div>
    </div>
    <div className="k-memory__actions"><Button size="sm" variant="secondary" disabled={index <= 0} onClick={() => setIndex(value => value - 1)}>{en ? 'Previous scene' : '前のシーン'}</Button>
      <span aria-live="polite">{scenes.length ? index + 1 : 0} / {scenes.length}</span>
      <Button size="sm" variant="secondary" disabled={index >= scenes.length - 1} onClick={() => setIndex(value => value + 1)}>{en ? 'Next scene' : '次のシーン'}</Button>
    </div>
  </section>;
}
