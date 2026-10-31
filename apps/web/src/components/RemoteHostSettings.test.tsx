import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteHostSettings from './RemoteHostSettings';
import { apiFetch } from '../lib/transport';

const fixture = vi.hoisted(() => ({ language: 'en', states: [] as unknown[], next: 0, effectNext: 0,
  effects: [] as { deps?: readonly unknown[]; cleanup?: void | (() => void) }[], pending: [] as (() => void)[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.next++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [fixture.states[index], (value: unknown) => {
      fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value;
    }];
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = fixture.effectNext++, previous = fixture.effects[index];
    if (previous && deps && previous.deps?.length === deps.length && deps.every((value, i) => Object.is(value, previous.deps![i]))) return;
    fixture.pending.push(() => { if (typeof previous?.cleanup === 'function') previous.cleanup(); fixture.effects[index] = { deps, cleanup: effect() }; });
  },
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/transport', () => ({ apiFetch: vi.fn() }));

function view() {
  fixture.next = 0; fixture.effectNext = 0;
  const tree = RemoteHostSettings();
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
const button = (tree: ReactNode, label: string) => find(tree, node => node.props.children === label && typeof node.props.onClick === 'function');
const checkbox = (tree: ReactNode) => find(tree, node => node.type === 'input' && node.props.type === 'checkbox');
const codeInput = (tree: ReactNode) => find(tree, node => node.type === 'input' && node.props.inputMode === 'numeric');
const pairing = { url: 'https://relay.example.test/#pair=fixture', qr: 'data:image/png;base64,AA==', expires: 1893456300 };
let status: { installed: boolean; connected: boolean; runtime: boolean; le: { status: string };
  pending: { device_id: string; name: string }[]; devices: { device_id: string; name: string; management: boolean }[] };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  vi.stubGlobal('document', { visibilityState: 'visible' });
  fixture.language = 'en'; fixture.states = []; fixture.effects = []; fixture.pending = [];
  status = { installed: true, connected: true, runtime: true, le: { status: 'ok' },
    pending: [{ device_id: 'pending-phone', name: '入力途中の端末' }],
    devices: [{ device_id: 'registered-phone', name: '登録済み端末', management: false }] };
  vi.mocked(apiFetch).mockReset().mockImplementation(async (path, init) => {
    if (path === '/api/remote/devices/registered-phone/management') status.devices[0].management = JSON.parse(String(init?.body)).enabled;
    return Response.json(path === '/api/remote/status' ? status : pairing);
  });
});
afterEach(() => {
  fixture.effects.forEach(effect => { if (typeof effect.cleanup === 'function') effect.cleanup(); });
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function mount() {
  view(); await vi.waitFor(() => expect(fixture.states[0]).toEqual(status));
  return view();
}
async function settled() { await vi.waitFor(() => expect(fixture.states[3]).toBe(false)); return view(); }

it('preserves pending codes, QR, names and management grants through JA/EN switches without requests', async () => {
  let tree = await mount();
  codeInput(tree).props.onChange({ target: { value: '12x3456' } });
  button(view(), 'Register a phone').props.onClick(); tree = await settled();
  expect(apiFetch).toHaveBeenCalledWith('/api/remote/pair', expect.objectContaining({ method: 'POST' }));
  const savedPairing = fixture.states[1], savedCodes = fixture.states[4];
  expect(savedPairing).toEqual(pairing);
  expect(checkbox(tree).props.checked).toBe(false);
  checkbox(tree).props.onChange({ target: { checked: true } }); tree = await settled();
  expect(apiFetch).toHaveBeenCalledWith('/api/remote/devices/registered-phone/management', expect.objectContaining({ method: 'PUT', body: '{"enabled":true}' }));
  expect(checkbox(tree).props.checked).toBe(true);
  vi.mocked(apiFetch).mockClear();
  for (const language of ['ja', 'en', 'ja', 'en']) {
    fixture.language = language; tree = view();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('入力途中の端末'); expect(html).toContain('登録済み端末');
    expect(codeInput(tree).props.value).toBe('123456');
    expect(codeInput(tree).props.maxLength).toBe(6);
    expect(codeInput(tree).props['aria-label']).toBe(language === 'en' ? 'Confirmation code for 入力途中の端末' : '入力途中の端末の確認コード');
    expect(checkbox(tree).props.checked).toBe(true); expect(checkbox(tree).props.disabled).toBe(false);
    const image = find(tree, node => node.type === 'img');
    expect(image.props.src).toBe(pairing.qr);
    expect(image.props.alt).toBe(language === 'en' ? 'Phone registration QR code' : 'スマホ登録用QRコード');
    expect(html).toContain(pairing.url);
    for (const label of language === 'en'
      ? ['Take your conversations with you from this PC', 'Connected to relay', 'Running', 'Connected', 'Conversations are saved on this PC.',
        'Register a phone', 'expires in 5 minutes', 'Do not share', 'Show registration link', 'Hide QR code', '6-digit confirmation code',
        'Approve this device', 'Allow model management, diagnostics and experiments', 'Revoke registration', 'Stop Remote connection']
      : ['このPCから、会話を持ち歩く', '中継に接続中', '稼働中', '会話はこのPCに保存', 'スマホを登録する', '5分で失効',
        '第三者に共有しない', '登録リンクを表示', 'QRを隠す', '6桁の確認コード', 'この端末を承認', 'モデル管理・診断・実験を許可', '登録解除', 'Remote接続を停止']) expect(html).toContain(label);
    expect(fixture.states[1]).toBe(savedPairing); expect(fixture.states[4]).toBe(savedCodes);
    expect(apiFetch).not.toHaveBeenCalled();
  }
  button(tree, 'Approve this device').props.onClick(); await settled();
  expect(apiFetch).toHaveBeenCalledWith('/api/remote/approve', expect.objectContaining({ method: 'POST', body: '{"device_id":"pending-phone","code":"123456"}' }));
});

it.each([
  ['ok', 'Connected', '接続中'], ['offline', 'Offline', 'オフライン'],
  ['unauthorized', 'Authentication failed', '認証失敗'], ['unknown', 'Not verified', '未確認'],
])('localizes disconnected, stopped and LE %s statuses', async (leStatus, english, japanese) => {
  status.connected = false; status.runtime = false; status.le.status = leStatus;
  let tree = await mount();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; tree = view();
    const line = find(tree, node => node.props.role === 'status');
    const html = renderToStaticMarkup(line);
    expect(html).toContain(language === 'en' ? 'Cannot connect to relay' : '中継に接続できません');
    expect(html).toContain(language === 'en' ? 'Stopped' : '停止中');
    expect(html).toContain(language === 'en' ? english : japanese);
    expect(button(tree, language === 'en' ? 'Register a phone' : 'スマホを登録する').props.disabled).toBe(true);
  }
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

it('localizes setup instructions without requesting setup or changing roles', async () => {
  status.installed = false; await mount(); vi.mocked(apiFetch).mockClear();
  for (const language of ['ja', 'en', 'ja']) {
    fixture.language = language;
    const html = renderToStaticMarkup(view());
    expect(html).toContain(language === 'en' ? 'Set up Remote Host to connect' : 'Remote Hostをセットアップ');
    expect(html).not.toContain('type="checkbox"');
    if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  }
  expect(apiFetch).not.toHaveBeenCalled();
});

it.each(['response', 'network', 'timeout', 'status', 'unknown', 'unexpected'])('relocalizes %s errors without leaking raw details or retrying', async failure => {
  const tree = await mount(), secret = 'PRIVATE_TOKEN_CANARY 生のエラー';
  if (failure === 'response') vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({ error: secret }, { status: 403 }));
  else if (failure === 'network') vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError(secret));
  else if (failure === 'timeout') vi.mocked(apiFetch).mockRejectedValueOnce(new DOMException(secret, 'TimeoutError'));
  else if (failure === 'unexpected') vi.mocked(apiFetch).mockRejectedValueOnce(Error(secret));
  else if (failure === 'unknown') vi.mocked(apiFetch).mockRejectedValueOnce(secret);
  else vi.mocked(apiFetch).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(new Response(null, { status: 503 }));
  button(tree, 'Stop Remote connection').props.onClick(); await settled();
  const errorCode = fixture.states[2];
  vi.mocked(apiFetch).mockClear();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const html = renderToStaticMarkup(view());
    expect(html).toContain('role="alert"'); expect(html).not.toContain(secret); expect(html).not.toContain('remote_host_');
    expect(html).toContain(failure === 'status'
      ? language === 'en' ? 'Could not retrieve Remote Host status.' : 'Remote Hostの状態を取得できません。'
      : failure === 'unknown' || failure === 'unexpected' ? language === 'en' ? 'The action failed.' : '操作に失敗しました。'
      : failure === 'timeout' ? language === 'en' ? 'The request timed out. Its result is unverified; check the PC before retrying.' : '要求がタイムアウトしました。結果は未確認です。再試行の前にPC側を確認してください。'
      : failure === 'network' ? language === 'en' ? 'The connection failed. The result is unverified; check the PC and connection before retrying.' : '通信に失敗しました。結果は未確認です。再試行の前にPC側と接続を確認してください。'
      : language === 'en' ? 'Could not complete the action. Check the connection and confirmation code.' : '操作を完了できません。接続状態と確認コードを確認してください。');
    expect(fixture.states[2]).toBe(errorCode); expect(apiFetch).not.toHaveBeenCalled();
  }
});
