import type { MemoryProvenance } from '../lib/api';
import { useLanguage, type Language } from '../lib/appContext';

export const memorySourceLabel = (kind?: MemoryProvenance['source_kind'], language: Language = 'ja') => (language === 'en' ? {
  user_statement: 'User statement', user_correction: 'User correction', work_setting: 'Work settings', story_event: 'AI story event',
} : {
  user_statement: 'ユーザー発言', user_correction: 'ユーザー訂正', work_setting: '作品設定', story_event: 'AIの物語上の出来事',
})[kind ?? 'user_statement'];

export default function MemorySource({ memory }: { memory: MemoryProvenance }) {
  const language = useLanguage(), en = language === 'en';
  return <details style={{ overflowWrap: 'anywhere', fontSize: 12 }}><summary>{en ? 'Source: ' : '出典：'}{memory.source_kind ? memorySourceLabel(memory.source_kind, language) : en ? 'Legacy memory; source type unknown' : '旧記憶・出典区分なし'} · {memory.confirmation === 'user_confirmed' ? (en ? 'Confirmed by user' : 'ユーザー確認済み') : (en ? 'Factuality unverified' : '事実性は未確認')}</summary>
    {memory.source_kind === 'story_event' && <p>{en ? 'This is fictional story content. It does not establish your real history or preferences.' : '物語上の創作です。あなたの実際の過去や好みを証明する情報ではありません。'}</p>}
    {memory.source_quote ? <blockquote style={{ whiteSpace: 'pre-wrap' }}>{memory.source_quote}</blockquote> : <p>{en ? 'No quotation was saved.' : '引用は保存されていません。'}</p>}
    {!!memory.source_message_ids?.length && <p>{en ? 'Source messages: ' : '出典メッセージ：'}{memory.source_message_ids.join(', ')}</p>}
    {memory.source_revision && <p>{en ? 'Source revision: ' : '出典の版：'}{memory.source_revision}</p>}
  </details>;
}
