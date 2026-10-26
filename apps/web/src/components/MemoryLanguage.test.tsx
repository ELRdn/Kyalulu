import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import MemoryPanel from './MemoryPanel';
import MemoryInspector from './MemoryInspector';
import MemorySource from './MemorySource';
import ConversationContext from './ConversationContext';
import { clearSessionMemories, migrateMemoryScope, updateChatSummary } from '../lib/api';

const fixture = vi.hoisted(() => ({ language: 'en', states: [] as unknown[], next: 0, confirm: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: () => {}, useRef: (initial: unknown) => ({ current: initial }), useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => [fixture.states[fixture.next++] ?? initial, vi.fn()],
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/remoteStore', () => ({ connectionScope: () => 'fixture-owner' }));
vi.mock('../lib/capabilities', () => ({ useCapabilities: () => ({ capabilities: { features: { world_memory: true, permanent_delete: true } } }) }));
vi.mock('./ui/Dialog', () => ({ useConfirm: () => [null, fixture.confirm] }));
vi.mock('../lib/api', () => ({ clearSessionMemories: vi.fn(), migrateMemoryScope: vi.fn(), updateChatSummary: vi.fn() }));

function find(tree: ReactNode, match: (element: ReactElement<any>) => boolean): ReactElement<any> {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(node)) continue;
    if (match(node)) return node;
    try { return find(node.props.children, match); } catch { /* Continue with siblings. */ }
  }
  throw Error('Missing action');
}
const button = (tree: ReactNode, label: string) => find(tree, node => node.props.children === label);
beforeEach(() => { fixture.next = 0; fixture.states = []; vi.clearAllMocks(); fixture.confirm.mockResolvedValue(false); });

it.each(['ja', 'en'])('preserves sharing and erasure warnings and cancellation in %s', async language => {
  fixture.language = language;
  fixture.states = [{ preview_revision: 'revision-fixture', memories: [] }, true, 'char:fixture', [], null, '', false, 'semantic', null, false, false];
  const tree = MemoryPanel({ sessionId: 'fixture-chat', refreshKey: 0 }), html = renderToStaticMarkup(tree);
  expect(html).toContain(language === 'en' ? 'Legacy conversation sharing scopes are preserved.' : '旧会話の共有範囲も保持');
  expect(html).toContain(language === 'en' ? 'Originals remain' : '元の記憶は残り');
  if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  await button(tree, language === 'en' ? 'Copy to shared scope across worlds' : '世界をまたぐ共有へ移行').props.onClick();
  expect(fixture.confirm.mock.calls[0][0].description).toContain(language === 'en' ? 'other worlds' : '別世界');
  expect(migrateMemoryScope).not.toHaveBeenCalled();
  await button(tree, language === 'en' ? 'Erase memories in this scope' : 'この範囲の記憶を消去').props.onClick();
  const warning = fixture.confirm.mock.calls[1][0];
  expect(warning.danger).toBe(true);
  expect(warning.cancelLabel).toBe(language === 'en' ? 'Cancel' : 'キャンセル');
  expect(warning.description).toContain(language === 'en' ? 'affects other conversations and cannot be undone' : '他の会話にも影響し、元に戻せません');
  expect(warning.description).toContain(language === 'en' ? 'does not delete conversation text' : '会話本文の削除とは別');
  expect(clearSessionMemories).not.toHaveBeenCalled();
});

it.each(['ja', 'en'])('keeps fictional sources and word-match uncertainty explicit in %s', language => {
  fixture.language = language;
  const html = renderToStaticMarkup(<><MemorySource memory={{ source_kind: 'story_event', confirmation: 'proposed', source_message_ids: [4], source_revision: '2' }} /><MemoryInspector trace={{ enabled: true, scope: 'fixture', query: '', candidates: [
    { id: 'm', type: 'episodic', content: 'Fictional event', score: 1, decision: 'unverified', origin: 'model', version: 2, source_kind: 'story_event', source_session_id: 'fixture', source_turn: 4 },
  ], injected: [], injected_tokens: 0, stored_count: 1, retrieval_ms: 1, evidenced: ['m'], decisions: [{ type: 'semantic', content: 'Fixture', action: 'skip', reason: 'duplicate' }, { type: 'relationship', content: 'Fixture', action: 'store', supported: false }] }} /></>);
  expect(html).toContain(language === 'en' ? 'It does not establish your real history or preferences.' : 'あなたの実際の過去や好みを証明');
  expect(html).toContain(language === 'en' ? 'does not prove factuality or source accuracy' : '事実性や出典の正しさの証明ではありません');
  expect(html).toContain(language === 'en' ? 'Events &amp; promises' : '出来事・約束');
  if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
});

it.each(['ja', 'en'])('keeps summary edits tied to the displayed revision in %s', async language => {
  fixture.language = language;
  fixture.states = [{ summaries: [{ id: 'summary-fixture', revision: 7, kind: 'chapter', method: 'extractive', source_message_ids: [1, 2], text: 'Original' }] }, '', 'summary-fixture', 'Corrected', false, 0];
  const tree = ConversationContext({ sessionId: 'fixture-chat', refreshKey: 0, disabled: false });
  const html = renderToStaticMarkup(tree);
  expect(html).toContain(language === 'en' ? 'Extracts may omit details.' : '抜粋は内容を省略する場合');
  expect(html).toContain(language === 'en' ? 'Correct summary' : '要約を訂正');
  if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  expect(updateChatSummary).toHaveBeenCalledWith('fixture-chat', 'summary-fixture', 'Corrected', 7);
});
