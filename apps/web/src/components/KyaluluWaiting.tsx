import type { GenerationProgress } from '../../../../packages/schemas/src';
import './kyaluluWaiting.css';
import type { Language } from '../lib/appContext';

export const REPLY_WAIT_LABEL = '返事を待っています…';

const stageLabels: Record<GenerationProgress['stage'], string> = {
  queue: '順番を待っています',
  input_safety: '返事を準備しています',
  generation: '返事を生成しています',
  output_safety: '返事を準備しています',
  save: '返事を保存しています',
};
const englishStages: Record<GenerationProgress['stage'], string> = {
  queue: 'Waiting in queue', input_safety: 'Preparing reply', generation: 'Generating reply',
  output_safety: 'Preparing reply', save: 'Saving reply',
};

export default function KyaluluWaiting({ progress, researcher = false, language = 'ja' }: {
  progress: GenerationProgress | null;
  researcher?: boolean;
  language?: Language;
}) {
  return (
    <div className="k-reply-wait">
      <div className="k-reply-wait__art" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}mascot/v1.2/face-curious.png`} alt="" width={40} height={40} />
        <span className="k-reply-wait__dots"><i /><i /><i /></span>
      </div>
      <div className="k-reply-wait__text">
        <span role="status" aria-live="polite" aria-atomic="true">{language === 'en' ? 'Waiting for a reply…' : REPLY_WAIT_LABEL}</span>
        {researcher && progress && (
          <small className="k-reply-wait__diagnostic" aria-live="off">
            {language === 'en' ? `${englishStages[progress.stage]} (${(progress.elapsed_ms / 1000).toFixed(1)}s elapsed)` : `${stageLabels[progress.stage]}（${(progress.elapsed_ms / 1000).toFixed(1)}秒経過）`}
          </small>
        )}
      </div>
    </div>
  );
}
