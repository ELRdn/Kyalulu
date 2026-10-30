import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Studio from './Studio';
import Switch from '../components/ui/Switch';
import Button from '../components/ui/Button';
import { fetchModels, fetchProvidersHealth, type ModelInfo, type ProviderHealth } from '../lib/api';
import { useDocumentTitle } from '../lib/title';

const fixture = vi.hoisted(() => ({ language: 'ja', states: [] as unknown[], next: 0,
  refs: [] as { current: unknown }[], refNext: 0,
  callbacks: [] as { callback: unknown; deps: readonly unknown[] }[], callbackNext: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[], effectNext: 0, pending: [] as (() => void)[] }));
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.next++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [fixture.states[index], (value: unknown) => { fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value; }];
  },
  useRef: (initial: unknown) => fixture.refs[fixture.refNext++] ??= { current: initial },
  useCallback: (callback: unknown, deps: readonly unknown[]) => {
    const index = fixture.callbackNext++, previous = fixture.callbacks[index];
    if (!previous || !same(previous.deps, deps)) fixture.callbacks[index] = { callback, deps };
    return fixture.callbacks[index].callback;
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = fixture.effectNext++, previous = fixture.effects[index];
    if (!previous || !same(previous.deps, deps)) fixture.pending.push(() => {
      previous?.cleanup?.(); const cleanup = effect();
      fixture.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    });
  },
}));
vi.mock('react-router-dom', () => ({ Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../lib/api', () => ({ fetchModels: vi.fn(), fetchProvidersHealth: vi.fn() }));
vi.mock('../lib/remoteStore', () => ({ scopedKey: (key: string) => key }));
vi.mock('../components/RuntimeGate', () => ({ useAdministrative: () => true, useRuntimeAccess: () => ({ cloud_mode: false }) }));

function view() {
  fixture.next = 0; fixture.refNext = 0; fixture.callbackNext = 0; fixture.effectNext = 0;
  const tree = Studio(), html = renderToStaticMarkup(tree);
  fixture.pending.splice(0).forEach(effect => effect());
  return { tree, html };
}
function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? []
    : [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
const radios = (tree: ReactNode) => nodes(tree, node => node.props.role === 'radio');
const switchButton = (tree: ReactNode) => Switch(nodes(tree, node => node.type === Switch)[0].props);
const models: ModelInfo[] = [
  { id: 'le/原モデル', display_name: '原名のモデル', provider_type: 'le', provider_model: 'raw-le', quantization: 'Q4_K_M' },
  { id: 'ollama/missing', display_name: '未準備の原名', provider_type: 'ollama', provider_model: 'missing', quantization: '', unavailable_reason: '配信元の原診断：missing model' },
  { id: 'lm-studio/offline', display_name: '未接続の原名', provider_type: 'lm_studio', provider_model: 'local', quantization: '' },
  { id: 'mock/echo', display_name: 'Echo original', provider_type: 'mock', provider_model: 'echo', quantization: '' },
  { id: 'api/raw', display_name: 'API original', provider_type: 'openai_compatible', provider_model: 'remote', quantization: '' },
  { id: 'responses/raw', display_name: 'Responses original', provider_type: 'responses', provider_model: 'remote', quantization: '' },
  { id: 'custom/raw', display_name: 'Custom original', provider_type: '独自提供元', provider_model: 'original', quantization: '' },
];
const health: ProviderHealth[] = [
  { id: 'le', provider: 'le', status: 'ok', models: ['raw-le'] },
  { id: 'ollama', provider: 'ollama', status: 'ok', models: ['installed'] },
  { id: 'lm_studio', provider: 'lm_studio', status: 'offline', error: 'HTTP 503：提供元の原診断', base_url: 'http://127.0.0.1:1234/v1' },
  ...['mock', 'openai_compatible', 'responses', '独自提供元'].map(id => ({ id, provider: id, status: 'ok' })),
];

beforeEach(() => {
  fixture.language = 'ja'; fixture.states = []; fixture.refs = []; fixture.callbacks = []; fixture.effects = []; fixture.pending = [];
  const storage = new Map([['my-zeta-model', models[0].id], ['kyalulu-explicit-model', models[0].id], ['my-zeta-researcher', '1']]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: vi.fn((key: string, value: string) => storage.set(key, value)) });
  vi.stubGlobal('window', new EventTarget());
  vi.mocked(fetchModels).mockReset().mockResolvedValue(models);
  vi.mocked(fetchProvidersHealth).mockReset().mockResolvedValue(health);
  vi.mocked(useDocumentTitle).mockClear();
});
afterEach(() => { fixture.effects.forEach(effect => effect.cleanup?.()); vi.unstubAllGlobals(); });
async function loaded() { await vi.waitFor(() => expect(fixture.states[6]).toBe(false)); return view(); }

it('localizes the full page while retaining actual model and researcher state without writes or management requests on language changes', async () => {
  const original = JSON.stringify({ models, health });
  view(); await loaded();
  for (const language of ['ja', 'en', 'ja', 'en']) {
    fixture.language = language;
    const { tree, html } = view();
    expect(useDocumentTitle).toHaveBeenLastCalledWith(language === 'en' ? 'Studio' : 'スタジオ');
    expect(nodes(tree, node => node.props.role === 'radiogroup')[0].props['aria-label']).toBe(language === 'en' ? 'Conversation engine' : '会話エンジン');
    expect(radios(tree).map(node => node.props['aria-checked'])).toEqual([true, false, false, false, false, false, false]);
    expect(radios(tree).map(node => node.props.disabled)).toEqual([false, true, true, false, false, false, false]);
    expect(switchButton(tree).props['aria-checked']).toBe(true);
    expect(switchButton(tree).props['aria-label']).toBe(language === 'en' ? 'Researcher mode' : 'Researcherモード');
    for (const model of models) expect(html).toContain(model.display_name);
    expect(html).toContain('Q4_K_M'); expect(html).toContain('独自提供元');
    for (const label of language === 'en'
      ? ['Advanced', 'Tools for creation and testing', 'Conversation engine', 'Recheck connection', 'an available engine is selected automatically.',
        'Test (echo)', 'Ollama (local)', 'LM Studio (local)', 'LE (local)', 'OpenAI-compatible API', 'Responses API', 'Model not ready', 'Offline',
        'Researcher mode', 'advanced settings (gear)', 'Ctrl+Shift+D', 'Personas &amp; worlds', 'Create and save personas and settings', 'Comparison experiments',
        'Memory comparisons · 30/50/100 turns', 'Try in chat', 'Check settings in a conversation', 'A/B/C comparisons and leaderboard', 'Provider status', 'Import, edit and export']
      : ['上級者向け', 'スタジオ', '制作と検証のための機能', '接続を再確認', 'つながるものへ自動で切り替わります', 'テスト用（オウム返し）',
        'Ollama（ローカル）', 'LM Studio（ローカル）', 'LE（ローカル）', 'OpenAI互換API', 'モデル未準備', 'オフライン', 'Researcherモード',
        '詳細設定（歯車）', 'ペルソナ・世界観', '人物像と舞台の作成・保存', '比較実験', '記憶の比較・30/50/100ターン', 'チャットで試す',
        '設定を会話で確認', 'A/B/C比較・リーダーボード', 'プロバイダの稼働状況', 'クリエイト', '取り込み・編集・書き出し']) expect(html).toContain(label);
    for (const href of ['/create/settings', '/research/benchmarks', '/chats', '/research', '/status', '/create']) expect(html).toContain(`href="${href}"`);
    if (language === 'en') expect(models.reduce((text, model) => text.replaceAll(model.display_name, ''), html).replaceAll('独自提供元', '')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(localStorage.getItem('my-zeta-model')).toBe(models[0].id); expect(localStorage.getItem('my-zeta-researcher')).toBe('1');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(fetchModels).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
  }
  expect(fixture.states[1]).toBe(models); expect(fixture.states[2]).toBe(health);
  expect(JSON.stringify({ models, health })).toBe(original);
});

it('changes the selected model, researcher flag and catalog only through explicit controls', async () => {
  view(); let { tree } = await loaded();
  radios(tree)[3].props.onClick();
  expect(localStorage.getItem('my-zeta-model')).toBe('mock/echo'); expect(localStorage.getItem('kyalulu-explicit-model')).toBe('mock/echo');
  switchButton(tree).props.onClick(); expect(localStorage.getItem('my-zeta-researcher')).toBe('0');
  const writes = vi.mocked(localStorage.setItem).mock.calls.length;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; tree = view().tree;
    expect(radios(tree)[3].props['aria-checked']).toBe(true); expect(switchButton(tree).props['aria-checked']).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledTimes(writes);
    expect(fetchModels).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
  }
  switchButton(tree).props.onClick(); expect(localStorage.getItem('my-zeta-researcher')).toBe('1');
  nodes(view().tree, node => node.type === Button)[0].props.onClick(); await loaded();
  expect(fetchModels).toHaveBeenCalledTimes(2); expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
  fixture.language = 'ja'; tree = view().tree;
  expect(radios(tree)[3].props['aria-checked']).toBe(true); expect(switchButton(tree).props['aria-checked']).toBe(true);
  expect(fetchModels).toHaveBeenCalledTimes(2); expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
});

it('localizes checking, skeleton and failure views without rewriting diagnostic evidence or changing selection', async () => {
  view(); await loaded();
  fixture.states[2] = null;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { tree, html } = view();
    expect(html).toContain(language === 'en' ? 'Checking…' : '確認中…');
    expect(radios(tree).every(node => !node.props.disabled)).toBe(true);
    expect(radios(tree)[0].props['aria-checked']).toBe(true);
  }
  fixture.states[1] = [];
  expect(view().html.match(/class="k-skeleton-row"/g)).toHaveLength(3);
  fixture.states[5] = true;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { html } = view();
    expect(html).toContain(language === 'en' ? 'Could not connect to the server. Check that the app (runtime) is running.' : 'サーバーに接続できませんでした。アプリ（ランタイム）が起動しているか確認してください。');
    if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  }
  expect(health[2].error).toBe('HTTP 503：提供元の原診断'); expect(models[1].unavailable_reason).toBe('配信元の原診断：missing model');
  expect(localStorage.setItem).not.toHaveBeenCalled(); expect(localStorage.getItem('my-zeta-model')).toBe(models[0].id);
  expect(fetchModels).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
});
