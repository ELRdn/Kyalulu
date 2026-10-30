/** Disposable memory UI against real device storage; no model or external API. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MemoryPanel from './MemoryPanel';
import MemoryInspector from './MemoryInspector';
import ConversationContext from './ConversationContext';
import { preferences, savePreferences, rememberOwner } from '../lib/appContext';
import { entity, allEntities, newEntity, saveEntity, getMeta, memoryEventsKey } from '../lib/appStore';
import { deviceFetch } from '../lib/deviceApi';
import { receiveSyncPage, setSyncConsent } from '../lib/appSync';
import { RuntimeStateSchema } from '../../../../packages/schemas/src';
import type { MemoryTrace } from '../lib/api';
import ModelSelector from './ModelSelector';
import CloudQuoteConfirmation, { useQuoteConfirmation } from './CloudQuoteConfirmation';
import { useLanguage } from '../lib/appContext';
import Button from './ui/Button';
import '../index.css';
import '../pages/activeChat.css';

const sessionId = 'memory-language-fixture';
function ModelPreview() {
  const en = useLanguage() === 'en', { quote, consent } = useQuoteConfirmation();
  return <section className="k-context-section"><ModelSelector models={[{ id: 'fixture', display_name: 'Fixture model', provider_type: 'fixture',
    provider_model: 'fixture', quantization: '', retains_prompts: true, training: true, available: true }]} value="fixture" onChange={() => {}} />
    <Button disabled={!!quote} onClick={() => { void consent.request({ quote_id: 'fixture', max_credits: 12500,
      route: { display_name: 'Baidu fixture', provider: 'fixture', model: 'fixture', retains_prompts: true, training: true, training_consent_required: true } }, new AbortController().signal, false); }}>{en ? 'Review model quote' : 'モデルの見積を確認'}</Button>
    {quote && <CloudQuoteConfirmation quote={quote} onAccept={() => consent.accept()} onCancel={() => consent.cancel()}
      onProviderTrainingConsentChange={value => consent.acknowledgeProviderTraining(quote.quote_id, value)} />}</section>;
}
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
  root.render(<StrictMode><main style={{ maxWidth: 900, padding: 16, margin: 'auto' }}><ModelPreview /><MemoryPanel sessionId={sessionId} refreshKey={0} /><ConversationContext sessionId={sessionId} refreshKey={0} disabled={false} /><MemoryInspector trace={trace} /></main></StrictMode>);
  return () => root.unmount();
}
export const saved = () => entity(sessionId);
export const owner = (value:string) => rememberOwner(value);
export async function api(path:string,method='GET',body?:unknown) {
  const response=await deviceFetch(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
}
export const events=()=>getMeta(memoryEventsKey('memory-language-fixture',sessionId));
export async function rejectEventWrite(memoryId:string) {
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey) {
    if(this.name==='meta'&&String(key).startsWith('memory-events:'))throw new DOMException('Fictional metadata write rejection','QuotaExceededError');
    return put.call(this,value,key!);
  };
  try{return await api('/api/memory/'+memoryId,'PATCH',{content:'MUST NOT COMMIT'});}
  finally{IDBObjectStore.prototype.put=put;}
}
export async function remoteDeletionWithUnsentMemory() {
  const owner='memory-language-fixture',original=(await entity(sessionId,owner))!;
  await saveEntity({...original,payload:{...original.payload,storage_policy:'sync',draft:'UNSENT MEMORY DRAFT',state:RuntimeStateSchema.parse({session_id:sessionId}),
    messages:[{id:1,uuid:'fictional-source-message',role:'user',content:'Fictional unsent source'}]}},original.revision);
  await setSyncConsent(owner,true);
  await receiveSyncPage(owner,[{id:sessionId,kind:'conversation',revision:2,deleted:true,payload:{}}],1);
  const recovery=(await allEntities(owner)).find(e=>e.payload.recovery_from===sessionId)!;
  return {source:await entity(sessionId,owner),recovery,events:await getMeta(memoryEventsKey(owner,recovery.id)),source_events:await events()};
}
