import type { MemoryProvenance } from '../lib/api';

export const memorySourceLabel = (kind?: MemoryProvenance['source_kind']) => ({
  user_statement: 'ユーザー発言', user_correction: 'ユーザー訂正', work_setting: '作品設定', story_event: 'AIの物語上の出来事',
}[kind ?? 'user_statement']);

export default function MemorySource({ memory }: { memory: MemoryProvenance }) {
  return <details style={{ overflowWrap: 'anywhere', fontSize: 12 }}><summary>出典：{memory.source_kind ? memorySourceLabel(memory.source_kind) : '旧記憶・出典区分なし'} · {memory.confirmation === 'user_confirmed' ? 'ユーザー確認済み' : '事実性は未確認'}</summary>
    {memory.source_kind === 'story_event' && <p>物語上の創作です。あなたの実際の過去や好みを証明する情報ではありません。</p>}
    {memory.source_quote ? <blockquote style={{ whiteSpace: 'pre-wrap' }}>{memory.source_quote}</blockquote> : <p>引用は保存されていません。</p>}
    {!!memory.source_message_ids?.length && <p>出典メッセージ：{memory.source_message_ids.join(', ')}</p>}
    {memory.source_revision && <p>出典の版：{memory.source_revision}</p>}
  </details>;
}
