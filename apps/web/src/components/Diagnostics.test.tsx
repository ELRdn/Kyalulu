import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Diagnostics from './Diagnostics';
import { fetchDiagnostics, type DiagnosticCheck } from '../lib/api';

const fixture = vi.hoisted(() => ({ language: 'ja', states: [] as unknown[], next: 0, effectNext: 0,
  effects: [] as { deps?: readonly unknown[] }[], pending: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.next++;
    if (!(index in fixture.states)) fixture.states[index] = initial;
    return [fixture.states[index], (value: unknown) => { fixture.states[index] = value; }];
  },
  useEffect: (effect: () => void, deps?: readonly unknown[]) => {
    const index = fixture.effectNext++, previous = fixture.effects[index];
    if (previous && deps && previous.deps?.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps![i]))) return;
    fixture.pending.push(() => { fixture.effects[index] = { deps }; effect(); });
  }
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/api', () => ({ fetchDiagnostics: vi.fn() }));

const check = (id: string, message: string, hint: string | null = null, detail: DiagnosticCheck['detail'] = null, ok: boolean | null = false): DiagnosticCheck =>
  ({ id, message, hint, detail, ok });
const getSupervision = vi.fn();
const adminFetch = vi.fn();
function view() {
  fixture.next = 0; fixture.effectNext = 0;
  const tree = Diagnostics();
  fixture.pending.splice(0).forEach(effect => effect());
  return tree;
}
function find(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any> {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(node)) continue;
    if (match(node)) return node;
    try { return find(node.props.children, match); } catch { /* Continue with siblings. */ }
  }
  throw Error('Missing control');
}
const refresh = (tree: ReactNode) => find(tree, node => node.type === 'button');
const text = (tree = view()) => renderToStaticMarkup(tree);
async function settled() { await vi.waitFor(() => expect(fixture.states[3]).toBe(false)); return view(); }
async function mount() { view(); return settled(); }

beforeEach(() => {
  fixture.language = 'ja'; fixture.states = []; fixture.effects = []; fixture.pending = [];
  vi.resetAllMocks();
  vi.stubGlobal('window', { electronAPI: { getSupervision } });
  vi.stubGlobal('fetch', adminFetch);
  getSupervision.mockResolvedValue({ api: { state: 'owned', healthy: true }, le: { state: 'disabled', healthy: false } });
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: true, checks: [
    check('api', 'API 稼働中', null, null, true),
    check('storage', '会話 12 件・ライブラリ 34 件を保存済み', null, { sessions: 12, library_versions: 34 }, true),
    check('providers', '直接つながるエンジン: ollama, custom日本語', null, { status: { ollama: 'ok', 'custom日本語': 'ok' } }, true),
    check('le', 'LE 稼働中（https://localhost:8130/le/v1?name=日本語）', null, { url: 'https://localhost:8130/le/v1?name=日本語' }, true),
    check('le_models', '会話用モデル 2 件', null, null, true),
    check('le_engine', 'kyalulu/日本語-model をロード中', null, { model: 'kyalulu/日本語-model' }, true)
  ] });
});
afterEach(() => vi.unstubAllGlobals());

it('renders diagnostics and relocalizes preserved data without diagnostics, supervision or admin requests', async () => {
  await mount();
  const savedChecks = fixture.states[0];
  for (const language of ['ja', 'en', 'ja', 'en']) {
    fixture.language = language;
    const html = text(), en = language === 'en';
    for (const label of en
      ? ['Connection diagnostics', 'Ready to chat', 'Refresh diagnostics', 'Saved data', 'Conversation engines', 'LE built-in model', 'LE conversation models',
        'API is running', 'Saved conversations: 12; library entries: 34', 'Directly connected engines: ollama, custom日本語', 'Conversation models: 2',
        'Loaded model: kyalulu/日本語-model', 'Started by Desktop (responding)', 'Disabled']
      : ['接続診断', '会話できる状態です', '再診断', '保存データ', '会話エンジン', 'LE 内蔵モデル', 'LE 会話用モデル',
        'API 稼働中', '会話 12 件・ライブラリ 34 件を保存済み', '会話用モデル 2 件', 'kyalulu/日本語-model をロード中', 'Desktop が起動（応答あり）', '無効']) expect(html).toContain(label);
    expect(html).toContain('https://localhost:8130/le/v1?name=日本語');
    expect(fixture.states[0]).toBe(savedChecks);
    expect(fixture.states[1]).toBe(true);
    expect(refresh(view()).props.disabled).toBe(false);
    if (en) expect(html).not.toContain('（応答あり）');
    expect(fetchDiagnostics).toHaveBeenCalledTimes(1);
    expect(getSupervision).toHaveBeenCalledTimes(1);
    expect(adminFetch).not.toHaveBeenCalled();
  }
  vi.mocked(fetchDiagnostics).mockResolvedValueOnce({ ready: false, checks: [check('le_models', '会話用モデルは配信されていません')] });
  refresh(view()).props.onClick();
  expect(refresh(view()).props.disabled).toBe(true);
  expect(text()).toContain('Checking...');
  expect(text()).toContain('Saved conversations: 12; library entries: 34');
  const html = text(await settled());
  expect(html).toContain('Action is needed before chatting');
  expect(html).toContain('No conversation models are being served');
  expect(html).not.toContain('Saved conversations: 12');
  expect(fetchDiagnostics).toHaveBeenCalledTimes(2);
  expect(getSupervision).toHaveBeenCalledTimes(2);
  expect(adminFetch).not.toHaveBeenCalled();
});

it('switches language while loading and renders the result in the current language', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof fetchDiagnostics>>) => void;
  vi.mocked(fetchDiagnostics).mockReturnValue(new Promise(done => { resolve = done; }));
  expect(text(view())).toContain('確認中...');
  fixture.language = 'en';
  expect(text()).toContain('Checking...');
  expect(refresh(view()).props.disabled).toBe(true);
  await vi.waitFor(() => expect(fetchDiagnostics).toHaveBeenCalledTimes(1));
  resolve({ ready: false, checks: [check('le', 'LE は未設定（トークンなし）')] });
  expect(text(await settled())).toContain('LE is not configured (no token)');
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1);
  expect(getSupervision).toHaveBeenCalledTimes(1);
});

it.each([
  [check('storage', 'データベースを読めません（OperationalError）', 'KYALULU_DATA_DIR の場所と書き込み権限を確認してね'),
    'Cannot read the database (OperationalError)', 'Check the KYALULU_DATA_DIR location and write permissions.'],
  [check('providers', '直接つながる会話エンジンはありません', 'Ollama や LM Studio を起動するか、LE 経由のモデルを使ってね'),
    'No directly connected conversation engines', 'Start Ollama or LM Studio, or use a model through LE.'],
  [check('le', 'LE は未設定（トークンなし）', 'LE を使うなら le-daemon を起動するか、Desktop で KYALULU_LE_BINARY を設定してね', null, null),
    'LE is not configured (no token)', 'To use LE, start le-daemon or set KYALULU_LE_BINARY in Desktop.'],
  [check('le', 'LE がトークンを拒否しました', 'LE の api-token と Kyalulu の LE_API_TOKEN が一致しているか確認してね'),
    'LE rejected the token', "Check that LE's api-token matches Kyalulu's LE_API_TOKEN."],
  [check('le', 'LE に接続できません（ConnectTimeout）', 'le-daemon が起動しているか、LE_API_URL を確認してね', { url: 'http://localhost:8130' }),
    'Cannot connect to LE (ConnectTimeout)', 'Check that le-daemon is running and verify LE_API_URL.'],
  [check('le_models', '会話用モデルは配信されていません', '/le models で確認し、/le load <id> でモデルをロードしてね'),
    'No conversation models are being served', 'Check /le models and load a model with /le load <id>.'],
  [check('le_engine', '内蔵エンジン（llama-server）は未設定', 'GGUF を LE で直接動かすなら LE_LLAMA_SERVER_BIN を設定してね', null, null),
    'The built-in engine (llama-server) is not configured', 'To run GGUF directly in LE, set LE_LLAMA_SERVER_BIN.'],
  [check('le_engine', '内蔵モデルはロードされていません', 'チャット欄で /le load 日本語/model:Q4 を実行するとロードできるよ', { installed: ['日本語/model:Q4', 'other'] }),
    'No built-in model is loaded', 'Load it by running /le load 日本語/model:Q4 in chat.'],
  [check('le_engine', '内蔵モデルは未インストール', '/le download <GGUFのURL> でダウンロードできるよ', null, null),
    'No built-in model is installed', 'Download a model with /le download <GGUF URL>.']
])('localizes the known $id failure and hint while preserving the Japanese source', async (row, message, hint) => {
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: false, checks: [row] });
  await mount();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const tree = view(), item = find(tree, node => node.type === 'li');
    const html = renderToStaticMarkup(item);
    expect(html).toContain(renderToStaticMarkup(<>{language === 'en' ? message : row.message}</>));
    expect(html).toContain(renderToStaticMarkup(<>{language === 'en' ? hint : row.hint}</>));
    expect(text(tree)).toContain(language === 'en' ? 'Action is needed before chatting' : '会話の前に対処が必要です');
    expect(fixture.states[0]).toEqual(expect.arrayContaining([row]));
  }
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1);
  expect(getSupervision).toHaveBeenCalledTimes(1);
});

it.each([0, 1, 987654])('preserves %i counts, including old responses without detail', async count => {
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: true, checks: [
    check('storage', `会話 ${count} 件・ライブラリ ${count} 件を保存済み`), check('le_models', `会話用モデル ${count} 件`)
  ] });
  fixture.language = 'en';
  const html = text(await mount());
  expect(html).toContain(`Saved conversations: ${count}; library entries: ${count}`);
  expect(html).toContain(`Conversation models: ${count}`);
});

it.each([
  ['disabled', false, '無効', 'Disabled'], ['starting', false, '起動中', 'Starting'],
  ['owned', true, 'Desktop が起動（応答あり）', 'Started by Desktop (responding)'],
  ['external', true, '外部で稼働（応答あり）', 'Running externally (responding)'],
  ['unavailable', false, '利用不可', 'Unavailable'], ['exited', false, '終了', 'Exited'],
  ['future日本語-state', true, 'future日本語-state（応答あり）', 'future日本語-state (responding)']
])('renders Desktop %s from raw supervision data in each language', async (state, healthy, ja, en) => {
  getSupervision.mockResolvedValue({ api: { state, healthy }, le: { state, healthy } });
  await mount();
  for (const language of ['ja', 'en', 'ja']) {
    fixture.language = language;
    expect(text()).toContain(language === 'en' ? en : ja);
  }
  expect(getSupervision).toHaveBeenCalledTimes(1);
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1);
});

it.each([
  ['The configured API is unavailable; automatic startup requires a local HTTP URL', '設定された API は利用できません。自動起動にはローカルの HTTP URL が必要です'],
  ['Kyalulu runtime not found; set KYALULU_REPO_ROOT or KYALULU_API_COMMAND', 'Kyalulu ランタイムが見つかりません。KYALULU_REPO_ROOT または KYALULU_API_COMMAND を設定してください'],
  ['API did not become healthy in time', 'API の応答確認がタイムアウトしました'],
  ['LE did not become healthy in time', 'LE の応答確認がタイムアウトしました'],
  ['API exited with code -9', 'API がコード -9 で終了しました'],
  ['LE exited with code 42', 'LE がコード 42 で終了しました']
])('localizes known Desktop error %s without losing its parameters', async (error, ja) => {
  getSupervision.mockResolvedValue({ api: { state: 'unavailable', healthy: false, error }, le: { state: 'disabled', healthy: false } });
  await mount();
  expect(text()).toContain(ja);
  fixture.language = 'en'; expect(text()).toContain(error);
  fixture.language = 'ja'; expect(text()).toContain(ja);
  expect(getSupervision).toHaveBeenCalledTimes(1);
});

it('localizes the deviceApi browser check without adding Desktop checks', async () => {
  vi.stubGlobal('window', {});
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: true, checks: [check('browser', 'On-device runtime', null, null, true)] });
  await mount();
  expect(text()).toContain('この端末'); expect(text()).toContain('端末内ランタイム');
  fixture.language = 'en'; expect(text()).toContain('This device'); expect(text()).toContain('On-device runtime');
  expect(text()).not.toContain('Desktop:'); expect(getSupervision).not.toHaveBeenCalled();
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1);
});

it('preserves unknown, custom and nearly matching messages and hints verbatim', async () => {
  const rows = [check('provider_custom', 'API 稼働中', 'KYALULU_DATA_DIR の場所と書き込み権限を確認してね'),
    check('le', 'LE がトークンを拒否しました — provider独自: E_UNKNOWN', '追加ヒント https://custom.test/日本語'),
    check('le_engine', 'ユーザー指定文', 'チャット欄で /le load custom を実行するとロードできるよ', { model: 'ユーザーモデル', installed: ['different'] }),
    check('storage', '独自ストレージ診断', '独自ヒント', { sessions: 123, library_versions: 456 })];
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: false, checks: rows });
  getSupervision.mockResolvedValue({ api: { state: 'unknown-state', healthy: false, error: 'spawn C:\\独自\\server.exe ENOENT' }, le: { state: 'disabled', healthy: false } });
  await mount();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const html = text();
    for (const row of rows) {
      expect(html).toContain(renderToStaticMarkup(<>{row.message}</>));
      expect(html).toContain(renderToStaticMarkup(<>{row.hint}</>));
    }
    expect(html).toContain('provider_custom'); expect(html).toContain('unknown-state'); expect(html).toContain('spawn C:\\独自\\server.exe ENOENT');
  }
});

it.each([Error('HTTP 503 / 独自通信エラー'), 'network: 独自詳細'])('preserves API failure evidence and Desktop rows, then recovers with one refresh', async error => {
  vi.mocked(fetchDiagnostics).mockRejectedValueOnce(error);
  await mount();
  for (const language of ['ja', 'en', 'ja']) {
    fixture.language = language;
    const html = text();
    expect(html).toContain(language === 'en' ? 'Cannot connect to the API. Check that it is running.' : 'API に接続できません。API が起動しているか確認してね。');
    expect(html).toContain(error instanceof Error ? error.message : error);
    expect(html).toContain('role="alert"'); expect(html).toContain('Desktop: API');
  }
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1); expect(getSupervision).toHaveBeenCalledTimes(1);
  refresh(view()).props.onClick();
  const html = text(await settled());
  expect(html).toContain('会話できる状態です'); expect(html).not.toContain('role="alert"');
  expect(fetchDiagnostics).toHaveBeenCalledTimes(2); expect(getSupervision).toHaveBeenCalledTimes(2);
  expect(adminFetch).not.toHaveBeenCalled();
});

it('keeps unknown supervision rejection evidence while still loading API diagnostics', async () => {
  getSupervision.mockRejectedValue(Error('IPC失敗 E_BRIDGE_UNKNOWN'));
  await mount();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const html = text();
    expect(html).toContain(language === 'en' ? 'Could not read Desktop supervision status' : 'Desktop の状態を取得できません');
    expect(html).toContain('IPC失敗 E_BRIDGE_UNKNOWN'); expect(html).toContain(language === 'en' ? 'API is running' : 'API 稼働中');
  }
  expect(fetchDiagnostics).toHaveBeenCalledTimes(1); expect(getSupervision).toHaveBeenCalledTimes(1);
});

it.each(['toString', 'constructor', '__proto__'])('preserves unknown %s dictionary keys as diagnostic evidence', async value => {
  const rows = [check('api', value, value), check(value, value, value), check('desktop_supervision', value, value)];
  vi.mocked(fetchDiagnostics).mockResolvedValue({ ready: false, checks: rows });
  getSupervision.mockResolvedValue({ api: { state: value, healthy: false, error: value }, le: { state: 'disabled', healthy: false } });
  await mount();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    expect(text().match(new RegExp(value, 'g'))).toHaveLength(9);
  }
});
