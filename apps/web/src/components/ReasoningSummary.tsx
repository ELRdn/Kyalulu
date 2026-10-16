import type { ChatMessage } from '../lib/api';

export default function ReasoningSummary({ message, cloud = false }: { message: ChatMessage; cloud?: boolean }) {
  if (message.role !== 'assistant' || !message.content || message.model_id === 'intro') return null;
  const status = message.reasoning_summary_status;
  const summary = status !== 'unsupported' && status !== 'not_provided' ? message.reasoning_summary?.trim() : null;
  if (!summary && !cloud) return null;
  return <details className="k-context-section" aria-label="この返事の公式推論要約">
    <summary>公式推論要約{summary ? '' : '（提供なし）'}</summary>
    {summary ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summary}</p>
      : <p>{status === 'unsupported' ? 'この経路では公式推論要約を要求していないか、取得が未実装です。' : 'この応答には提供元から公式推論要約が提供されていません。'}</p>}
    <small>提供元の公式要約のみを表示します。</small>
  </details>;
}
