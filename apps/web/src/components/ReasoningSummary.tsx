import type { ChatMessage } from '../lib/api';
import { useLanguage } from '../lib/appContext';

export default function ReasoningSummary({ message }: { message: ChatMessage }) {
  const en = useLanguage() === 'en';
  if (message.role !== 'assistant' || !message.content || message.model_id === 'intro') return null;
  const status = message.reasoning_summary_status;
  const summary = status !== 'unsupported' && status !== 'not_provided' ? message.reasoning_summary?.trim() : null;
  if (!summary) return null;
  return <details className="k-context-section" aria-label={en ? 'Official reasoning summary for this reply' : 'この返事の公式推論要約'}>
    <summary>{en ? 'Official reasoning summary' : '公式推論要約'}</summary>
    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{summary}</p>
    <small>{en ? 'Only the official summary supplied by the provider is shown.' : '提供元の公式要約のみを表示します。'}</small>
  </details>;
}
