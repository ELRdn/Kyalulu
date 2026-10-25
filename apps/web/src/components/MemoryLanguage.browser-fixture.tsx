/** Disposable memory UI against real device storage; no model or external API. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MemoryPanel from './MemoryPanel';
import MemoryInspector from './MemoryInspector';
import ConversationContext from './ConversationContext';
import { preferences, savePreferences, rememberOwner } from '../lib/appContext';
import { entity, newEntity, saveEntity } from '../lib/appStore';
import type { MemoryTrace } from '../lib/api';
import '../index.css';
import '../pages/activeChat.css';

const sessionId = 'memory-language-fixture';
export async function mount(node: HTMLElement, language: 'ja' | 'en', theme: 'light' | 'dark') {
  localStorage.setItem('kyalulu-execution-target', 'device'); rememberOwner('memory-language-fixture');
  savePreferences({ ...preferences(), language }); document.documentElement.dataset.theme = theme;
  const memory = { id: 'memory-fixture', type: 'episodic' as const, content: 'A fictional promise', status: 'active', origin: 'model', supported: false,
    version: 1, source_kind: 'story_event' as const, confirmation: 'proposed', source_quote: 'Fictional dialogue', source_message_ids: [1], source_revision: '1' };
  await saveEntity(newEntity('conversation', sessionId, { storage_policy: 'local', rating: 'general', settings: { session_id: sessionId }, messages: [],
    memory_enabled: true, memories: [memory], summaries: [{ id: 'summary-fixture', kind: 'chapter', revision: 1, text: 'Fixture summary', method: 'extractive', source_message_ids: [1] }] }));
  const trace: MemoryTrace = { enabled: true, scope: sessionId, query: '', stored_count: 1, injected: [], injected_tokens: 0, retrieval_ms: 0,
    candidates: [{ ...memory, score: 1, decision: 'unverified' }], decisions: [{ type: 'episodic', content: 'Fixture proposal', action: 'skip', reason: 'duplicate' }] };
  const root = createRoot(node);
  root.render(<StrictMode><main style={{ maxWidth: 900, padding: 16, margin: 'auto' }}><MemoryPanel sessionId={sessionId} refreshKey={0} /><ConversationContext sessionId={sessionId} refreshKey={0} disabled={false} /><MemoryInspector trace={trace} /></main></StrictMode>);
  return () => root.unmount();
}
export const saved = () => entity(sessionId);
