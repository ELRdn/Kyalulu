import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Studio from './Studio';
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
vi.mock('../lib/api', () => ({ fetchModels: vi.fn(), fetchProvidersHealth: vi.fn(), fetchPersonas: vi.fn(async () => []), fetchWorlds: vi.fn(async () => []), fetchExperiments: vi.fn(async () => []) }));
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
async function loaded() { await vi.waitFor(() => expect(fixture.states[5]).toBe(false)); return view(); }

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
    for (const model of models) expect(html).toContain(model.display_name);
    expect(html).toContain('Q4_K_M'); expect(html).toContain('独自提供元');
    for (const label of language === 'en'
      ? ['Advanced', 'Review conversation engines', 'Conversation engine', 'Recheck connection', 'Model not ready', 'Offline', 'Personas &amp; worlds', 'Comparison experiments', 'Latest run', 'Provider status', 'View in Research']
      : ['上級者向け', 'Studio', '会話エンジンと設定を', '接続を再確認', 'モデル未準備', '未接続', 'ペルソナ・世界観', '比較実験', '最後の実験', 'プロバイダの稼働状況', 'Researchで見る']) expect(html).toContain(label);
    for (const href of ['/create/settings', '/research/benchmarks', '/research', '/status']) expect(html).toContain(`href="${href}"`);
    if (language === 'en') expect(models.reduce((text, model) => text.replaceAll(model.display_name, ''), html).replaceAll('独自提供元', '')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(localStorage.getItem('my-zeta-model')).toBe(models[0].id); expect(localStorage.getItem('my-zeta-researcher')).toBe('1');
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(fetchModels).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
  }
  expect(fixture.states[0]).toBe(models); expect(fixture.states[1]).toBe(health);
  expect(JSON.stringify({ models, health })).toBe(original);
});

it('changes the selected model and catalog only through explicit controls', async () => {
  view(); let { tree } = await loaded();
  radios(tree)[3].props.onClick();
  expect(localStorage.getItem('my-zeta-model')).toBe('mock/echo'); expect(localStorage.getItem('kyalulu-explicit-model')).toBe('mock/echo');
  const writes = vi.mocked(localStorage.setItem).mock.calls.length;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; tree = view().tree;
    expect(radios(tree)[3].props['aria-checked']).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledTimes(writes);
    expect(fetchModels).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
  }
  nodes(view().tree, node => node.type === Button)[0].props.onClick(); await loaded();
  expect(fetchModels).toHaveBeenCalledTimes(2); expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
  fixture.language = 'ja'; tree = view().tree;
  expect(radios(tree)[3].props['aria-checked']).toBe(true);
  expect(fetchModels).toHaveBeenCalledTimes(2); expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
});

it('localizes checking, skeleton and failure views without rewriting diagnostic evidence or changing selection', async () => {
  view(); await loaded();
  fixture.states[1] = null;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { tree, html } = view();
    expect(html).toContain(language === 'en' ? 'Checking…' : '確認中…');
    expect(radios(tree).every(node => !node.props.disabled)).toBe(true);
    expect(radios(tree)[0].props['aria-checked']).toBe(true);
  }
  fixture.states[0] = [];
  expect(view().html.match(/class="k-skeleton-row"/g)).toHaveLength(3);
  fixture.states[4] = true;
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
