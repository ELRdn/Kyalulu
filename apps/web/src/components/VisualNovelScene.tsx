import { useEffect, useState } from 'react';
import type { ChatMessage } from '../lib/api';
import type { PortableAsset } from '../lib/library';
import { useLanguage } from '../lib/appContext';
import { playableAsset } from '../lib/media';
import { RuntimeImage } from './RuntimeMedia';
import MessageContent from './MessageContent';
import ReasoningSummary from './ReasoningSummary';
import Icon from './ui/Icon';

// Design 14: the character fills the screen and the latest line sits in a card at the bottom.
export default function VisualNovelScene({ messages, name, assets, streaming, portrait, onExit, onBack }: {
  messages: ChatMessage[]; name: string; assets: PortableAsset[]; streaming: boolean; portrait?: string | null; onExit?: () => void; onBack?: () => void;
}) {
  const en = useLanguage() === 'en';
  const scenes = messages.filter(message => message.role === 'assistant' && message.content.trim());
  const [index, setIndex] = useState(Math.max(0, scenes.length - 1));
  useEffect(() => setIndex(Math.max(0, scenes.length - 1)), [scenes.length]);
  const scene = scenes[Math.min(index, scenes.length - 1)];
  const background = assets.find(asset => asset.type === 'background');
  const figure = assets.find(asset => asset.type === 'emotion') ?? assets.find(asset => asset.type === 'icon');
  const backgroundMedia = background && playableAsset(background);
  const portraitMedia = figure && playableAsset(figure);
  const live = streaming && index === scenes.length - 1;
  return <section aria-label={en ? 'Visual novel' : 'ビジュアルノベル表示'} className="k-vn-scene">
    {backgroundMedia?.kind === 'image' && <RuntimeImage className="k-vn-scene__background" src={backgroundMedia.src} alt="" />}
    {portraitMedia?.kind === 'image' ? <RuntimeImage className="k-vn-scene__portrait" src={portraitMedia.src} alt={figure?.name ?? name} />
      : portrait && <img className="k-vn-scene__portrait" src={portrait} alt={name} />}
    <div className="k-vn-scene__top">
      {onBack && <button type="button" className="k-vn-scene__round" aria-label={en ? 'Back to chats' : 'チャット一覧へ戻る'} onClick={onBack}><Icon name="back" size={20} /></button>}
      {onExit && <button type="button" className="k-vn-scene__pill" onClick={onExit}><Icon name="chat" size={16} />{en ? 'Show chat history' : '会話履歴を表示'}</button>}
    </div>
    <div className="k-vn-scene__dialogue">
      <span className="k-vn-scene__name">{name}</span>
      {scene && !live && <ReasoningSummary key={index} message={scene} />}
      {scene ? <MessageContent content={scene.content} isStreaming={live} /> : <p>{en ? 'Scenes appear here after the first reply.' : '最初の返事が届くと、ここにシーンを表示します。'}</p>}
      <div className="k-vn-scene__nav">
        <button type="button" aria-label={en ? 'Previous scene' : '前のシーン'} disabled={index <= 0} onClick={() => setIndex(value => value - 1)}><Icon name="back" size={16} /></button>
        <span aria-live="polite">{scenes.length ? index + 1 : 0} / {scenes.length}</span>
        <button type="button" aria-label={en ? 'Next scene' : '次のシーン'} disabled={index >= scenes.length - 1} onClick={() => setIndex(value => value + 1)}><Icon name="chevron" size={18} /></button>
      </div>
    </div>
  </section>;
}
