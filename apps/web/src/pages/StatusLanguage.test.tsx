import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import Status from './Status';
import ProviderStatus from '../components/ProviderStatus';
import Card from '../components/ui/Card';
import { fetchHealth, fetchProvidersHealth, type ProviderHealth } from '../lib/api';

const fixture = vi.hoisted(() => ({ language: 'ja', states: [] as unknown[], next: 0, effectNext: 0,
  effects: [] as (readonly unknown[] | undefined)[], pending: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.next++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [fixture.states[index], (value: unknown) => {
      fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value;
    }];
  },
  useEffect: (effect: () => void, deps?: readonly unknown[]) => {
    const index = fixture.effectNext++, previous = fixture.effects[index];
    if (!previous || !deps || previous.length !== deps.length || deps.some((value, i) => !Object.is(value, previous[i]))) {
      fixture.effects[index] = deps; fixture.pending.push(effect);
    }
  },
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../lib/api', () => ({ fetchHealth: vi.fn(), fetchProvidersHealth: vi.fn() }));
vi.mock('../components/Diagnostics', () => ({ default: () => <section>診断原文：LE token mismatch / HTTP 401</section> }));

function view(component = Status) {
  fixture.next = 0; fixture.effectNext = 0;
  const tree = component(), html = renderToStaticMarkup(tree);
  fixture.pending.splice(0).forEach(effect => effect());
  return { tree, html };
}
function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? []
    : [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
const apiCard = (tree: ReactNode) => renderToStaticMarkup(nodes(tree, node => node.type === Card)[0]);
const recheck = (tree: ReactNode) => nodes(tree, node => node.type === 'button' && typeof node.props.onClick === 'function')[0];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const health: ProviderHealth[] = [
  { id: 'le', provider: 'le', status: 'ok', base_url: 'http://127.0.0.1:8130' },
  { id: 'ollama', provider: 'ollama', status: 'offline', base_url: 'http://127.0.0.1:11434' },
  { id: 'lm_studio', provider: 'lm_studio', status: 'not_configured' },
  { id: 'responses', provider: 'responses', status: 'unauthorized' },
  { id: '提供元の原名', provider: 'custom', status: '未知の診断：custom_status', base_url: 'https://provider.example.test/v1?route=original' },
];

beforeEach(() => {
  fixture.language = 'ja'; fixture.states = []; fixture.effects = []; fixture.pending = [];
  vi.mocked(fetchHealth).mockReset().mockResolvedValue({ status: 'ok', version: '0.1.0' });
  vi.mocked(fetchProvidersHealth).mockReset().mockResolvedValue(health);
});

it.each(['success', 'failure'])('relocalizes API checking and %s after a language change in flight without refetching', async outcome => {
  const pending = deferred<Awaited<ReturnType<typeof fetchHealth>>>();
  vi.mocked(fetchHealth).mockReturnValueOnce(pending.promise);
  expect(apiCard(view().tree)).toContain('確認中...');
  fixture.language = 'en';
  expect(apiCard(view().tree)).toContain('Checking...');
  const evidence = { status: 'ok: 原記録', version: '0.1.0+原版' };
  if (outcome === 'success') pending.resolve(evidence);
  else pending.reject(Error('PRIVATE_ERROR_CANARY'));
  await vi.waitFor(() => expect(fixture.states[0]).toEqual(outcome === 'success' ? evidence : 'failed'));
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { tree, html } = view();
    expect(apiCard(tree)).toContain(outcome === 'success' ? 'ok: 原記録 (v0.1.0+原版)' : language === 'en' ? 'Not connected (API not started)' : '未接続 (API起動前)');
    expect(html).not.toContain('PRIVATE_ERROR_CANARY');
    expect(html).toContain('診断原文：LE token mismatch / HTTP 401');
    expect(html).toContain(language === 'en' ? 'API / provider status' : 'API / プロバイダの稼働状況');
    expect(html).toContain(language === 'en' ? 'How to use' : '使い方');
    for (const code of ['.env', '.env.example', 'OPENAI_COMPATIBLE_URL', 'OPENAI_COMPATIBLE_API_KEY', 'ollama serve']) expect(html).toContain(`<code>${code}</code>`);
    for (const text of language === 'en'
      ? ['Create <code>.env</code> by copying <code>.env.example</code>.', 'To try an external API, set ', 'For a local LLM, start Ollama (', ') or LM Studio.', 'Mock Echo even without an external API or local LLM.']
      : ['<code>.env</code> を作成: <code>.env.example</code> をコピー', '外部APIで試すなら ', 'ローカルLLMなら Ollama (', ') / LM Studio を起動', '何もなくても Mock Echo でUI動作確認できるよ']) expect(html).toContain(text);
  }
  expect(fetchHealth).toHaveBeenCalledTimes(1); expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
});

it('relocalizes provider results and an explicit recheck in flight while retaining IDs, URLs and unknown evidence', async () => {
  const pending = deferred<ProviderHealth[]>(), original = JSON.stringify(health);
  vi.mocked(fetchProvidersHealth).mockReturnValueOnce(pending.promise);
  expect(view(ProviderStatus).html).toContain('確認中...');
  fixture.language = 'en'; expect(view(ProviderStatus).html).toContain('Checking...');
  pending.resolve(health);
  await vi.waitFor(() => expect(fixture.states[1]).toBe(false));
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { tree, html } = view(ProviderStatus);
    expect(html).toContain(language === 'en' ? 'Provider status' : 'Provider 状態');
    expect(recheck(tree).props.children).toBe(language === 'en' ? 'Recheck' : '再確認');
    for (const label of language === 'en' ? ['Connected', 'Offline', 'Not configured', 'Authentication failed'] : ['接続OK', 'オフライン', '未設定', '認証失敗']) expect(html).toContain(label);
    for (const row of health) { expect(html).toContain(row.id); if (row.base_url) expect(html).toContain(row.base_url); }
    expect(html).toContain('未知の診断：custom_status');
    expect(html).toContain(language === 'en' ? 'Configure destinations in .env using ' : '接続先は .env の ');
    for (const code of ['OLLAMA_URL', 'LM_STUDIO_URL', 'OPENAI_COMPATIBLE_URL']) expect(html).toContain(`<code>${code}</code>`);
    expect(fixture.states[0]).toBe(health);
  }
  expect(fetchProvidersHealth).toHaveBeenCalledTimes(1);
  const next = deferred<ProviderHealth[]>();
  vi.mocked(fetchProvidersHealth).mockReturnValueOnce(next.promise);
  const request = recheck(view(ProviderStatus).tree).props.onClick();
  expect(view(ProviderStatus).html).toContain('Checking...');
  fixture.language = 'ja'; expect(view(ProviderStatus).html).toContain('確認中...');
  expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
  next.resolve([{ ...health[0], status: 'offline' }]); await request;
  expect(view(ProviderStatus).html).toContain('オフライン');
  fixture.language = 'en'; expect(view(ProviderStatus).html).toContain('Offline');
  expect(fetchProvidersHealth).toHaveBeenCalledTimes(2); expect(fetchHealth).not.toHaveBeenCalled();
  expect(JSON.stringify(health)).toBe(original);
});

it('retains the previous provider evidence on a failed manual recheck without exposing errors or retrying on language change', async () => {
  view(ProviderStatus); await vi.waitFor(() => expect(fixture.states[1]).toBe(false));
  const pending = deferred<ProviderHealth[]>();
  vi.mocked(fetchProvidersHealth).mockReturnValueOnce(pending.promise);
  const request = recheck(view(ProviderStatus).tree).props.onClick();
  fixture.language = 'en'; expect(view(ProviderStatus).html).toContain('Checking...');
  pending.reject(Error('PRIVATE_PROVIDER_ERROR_CANARY')); await request;
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const { html } = view(ProviderStatus);
    expect(html).toContain('未知の診断：custom_status'); expect(html).toContain('https://provider.example.test/v1?route=original');
    expect(html).toContain(language === 'en' ? 'Connected' : '接続OK');
    expect(html).not.toContain('PRIVATE_PROVIDER_ERROR_CANARY'); expect(fixture.states[0]).toBe(health);
  }
  expect(fetchProvidersHealth).toHaveBeenCalledTimes(2);
});
