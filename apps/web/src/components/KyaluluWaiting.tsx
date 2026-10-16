import type { GenerationProgress } from '../../../../packages/schemas/src';
import './kyaluluWaiting.css';

export const REPLY_WAIT_LABEL = '返事を待っています…';

const stageLabels: Record<GenerationProgress['stage'], string> = {
  queue: '順番を待っています',
  input_safety: '返事を準備しています',
  generation: '返事を生成しています',
  output_safety: '返事を準備しています',
  save: '返事を保存しています',
};

export default function KyaluluWaiting({ progress, researcher = false }: {
  progress: GenerationProgress | null;
  researcher?: boolean;
}) {
  return (
    <div className="k-reply-wait">
      <div className="k-reply-wait__art" aria-hidden="true">
        <img src={`${import.meta.env.BASE_URL}mascot/v1.2/face-curious.png`} alt="" width={40} height={40} />
        <span className="k-reply-wait__dots"><i /><i /><i /></span>
      </div>
      <div className="k-reply-wait__text">
        <span role="status" aria-live="polite" aria-atomic="true">{REPLY_WAIT_LABEL}</span>
        {researcher && progress && (
          <small className="k-reply-wait__diagnostic" aria-live="off">
            {stageLabels[progress.stage]}（{(progress.elapsed_ms / 1000).toFixed(1)}秒経過）
          </small>
        )}
      </div>
    </div>
  );
}
