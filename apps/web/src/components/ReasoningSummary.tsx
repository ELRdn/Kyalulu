import type { ChatMessage } from '../lib/api';
import { useLanguage } from '../lib/appContext';

export default function ReasoningSummary({ message, cloud = false }: { message: ChatMessage; cloud?: boolean }) {
  const en = useLanguage() === 'en';
  if (message.role !== 'assistant' || !message.content || message.model_id === 'intro') return null;
  const status = message.reasoning_summary_status;
  const summary = status !== 'unsupported' && status !== 'not_provided' ? message.reasoning_summary?.trim() : null;
  if (!summary && !cloud) return null;
  return <details className="k-context-section" aria-label={en ? 'Official reasoning summary for this reply' : 'この返事の公式推論要約'}>
    <summary>{en ? 'Official reasoning summary' : '公式推論要約'}{summary ? '' : (en ? ' (not provided)' : '（提供なし）')}</summary>
    {summary ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summary}</p>
      : <p>{status === 'unsupported' ? (en ? 'This route does not request an official reasoning summary, or retrieval is not implemented.' : 'この経路では公式推論要約を要求していないか、取得が未実装です。') : (en ? 'The provider did not supply an official reasoning summary for this response.' : 'この応答には提供元から公式推論要約が提供されていません。')}</p>}
    <small>{en ? 'Only the official summary supplied by the provider is shown.' : '提供元の公式要約のみを表示します。'}</small>
  </details>;
}
