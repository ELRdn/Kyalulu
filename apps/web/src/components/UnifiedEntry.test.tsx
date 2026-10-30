import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UnifiedEntry, { ExecutionPicker } from './UnifiedEntry';
import { executionTarget, preferences, rememberOwner } from '../lib/appContext';
import { ChatRecovery } from '../lib/chatRecovery';
import { connectionScope } from '../lib/remoteStore';

const fixture = vi.hoisted(() => ({ states: [] as any[], next: 0, request: vi.fn(), confirm: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = fixture.next++;
    if (fixture.states[index] === undefined) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [fixture.states[index], (value: any) => { fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value; }];
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock('../lib/transport', () => ({ cloudFetch: fixture.request }));
vi.mock('./ui/Dialog', () => ({ useConfirm: () => [null, fixture.confirm] }));

let stored: Map<string, string>;
function find(tree: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any> {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(node)) continue;
    if (predicate(node)) return node;
    try { return find(node.props.children, predicate); } catch { /* Inspect the next sibling. */ }
  }
  throw Error('Missing entry control');
}
function view() { fixture.next = 0; return UnifiedEntry({ children: <p>Runtime content</p> }); }
function form() {
  find(view(), node => node.type === 'input' && node.props.autoComplete === 'country').props.onChange({ target: { value: 'ZZ' } });
  find(view(), node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { valueAsNumber: 22 } });
  return find(view(), node => node.type === 'form');
}
const eligibility = (patch = {}) => new Response(JSON.stringify({ country: 'ZZ', age_band: 'adult', policy: 'fictional-test-policy-not-approval', ticket: 'native:fictional', ...patch }));
beforeEach(() => {
  vi.clearAllMocks(); fixture.states = []; fixture.next = 0;
  stored = new Map();
  vi.stubEnv('MODE', 'native');
  vi.stubGlobal('navigator', { language: 'en', userAgent: 'Chromium' });
  vi.stubGlobal('window', { open: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal('location', { origin: 'http://127.0.0.1', hostname: '127.0.0.1', protocol: 'http:', pathname: '/', search: '', assign: vi.fn(), reload: vi.fn() });
  Object.assign(window, { location });
  vi.stubGlobal('localStorage', { get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
  fixture.confirm.mockResolvedValue(false);
  fixture.request.mockResolvedValue(eligibility());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('offers a scoped JA/EN return path without changing or resending pending work', () => {
  const recovery = new ChatRecovery(localStorage, connectionScope(), 'pending:茶'); recovery.begin('generation');
  for (const language of ['ja', 'en']) {
    stored.set('kyalulu-app-preferences-v1', JSON.stringify({version:1,language}));
    const before=[...stored], picker=ExecutionPicker(), html=renderToStaticMarkup(picker);
    expect(find(picker, node=>node.type==='select').props.disabled).toBe(true);
    expect(html).toContain(language==='en'?'Check send result':'送信結果を確認');
    expect(find(picker, node=>node.type==='a').props.href).toBe('#/chats/pending%3A%E8%8C%B6');
    expect([...stored]).toEqual(before); expect(fixture.request).not.toHaveBeenCalled();
  }
});

it('localizes destination review cancellation without changing the destination', async () => {
  for (const language of ['ja', 'en']) {
    stored.set('kyalulu-app-preferences-v1', JSON.stringify({version:1,language}));
    const before=[...stored];
    await find(ExecutionPicker(),node=>node.type==='select').props.onChange({target:{value:'device'}});
    expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({cancelLabel:language==='en'?'Cancel':'キャンセル'}));
    expect([...stored]).toEqual(before); expect(location.assign).not.toHaveBeenCalled();
  }
});

it('rechecks pending work admitted while the destination confirmation was open', async () => {
  fixture.confirm.mockImplementationOnce(async () => {
    new ChatRecovery(localStorage, connectionScope(), 'concurrent').begin('generation'); return true;
  });
  await find(ExecutionPicker(),node=>node.type==='select').props.onChange({target:{value:'device'}});
  expect(location.assign).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  expect(executionTarget()).toBe('local');
});

it('offers This PC on native browsers and keeps the region/age/consent form', () => {
  const picker = ExecutionPicker(), html = renderToStaticMarkup(picker);
  expect(find(picker, node => node.type === 'select').props.value).toBe('local');
  expect(html).toContain('value="local"'); expect(html).toContain('This PC');
  const tree = view();
  expect(find(tree, node => node.type === 'input' && node.props.autoComplete === 'country').props.required).toBe(true);
  expect(find(tree, node => node.type === 'input' && node.props.type === 'number').props.min).toBe(13);
  expect(find(tree, node => node.type === 'input' && node.props.type === 'checkbox').props.required).toBe(true);
  expect(fixture.request).not.toHaveBeenCalled();
});
it('keeps hosted browsers on Cloud without a This PC option', () => {
  vi.stubEnv('MODE', 'unified');
  const picker = ExecutionPicker();
  expect(find(picker, node => node.type === 'select').props.value).toBe('cloud');
  expect(renderToStaticMarkup(picker)).not.toContain('value="local"');
});
it.each(['file:', 'app:'])('preserves legacy Electron entry consent assumptions on %s outside native mode', protocol => {
  vi.stubEnv('MODE', 'production'); vi.stubEnv('VITE_UNIFIED_APP', '');
  Object.assign(window, { electronAPI: {} });
  Object.assign(location, { protocol, hostname: protocol === 'app:' ? 'kyalulu' : '', pathname: '/index.html' });
  expect(preferences().accepted).toBe(false);
  expect(renderToStaticMarkup(view())).toBe('<p>Runtime content</p>');
  expect(executionTarget()).toBe('local');
  expect(fixture.request).not.toHaveBeenCalled(); expect(stored.size).toBe(0);
});
it.each(['native', 'unified'])('posts %s first-run eligibility only to its own endpoint', async mode => {
  vi.stubEnv('MODE', mode);
  await form().props.onSubmit({ preventDefault: vi.fn() });
  expect(fixture.request).toHaveBeenCalledExactlyOnceWith(mode === 'native' ? '/api/local/eligibility' : '/api/cloud/app/eligibility', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ country: 'ZZ', age: 22 }),
  });
  expect(preferences()).toMatchObject({ country: 'ZZ', age: 22, accepted: true });
  expect(stored.get('kyalulu-eligibility-ticket')).toBe('native:fictional');
  expect(fixture.states[1]).toBe('interests');
});
it('keeps native device onboarding on the local eligibility service', async () => {
  location.pathname = '/device/';
  await form().props.onSubmit({ preventDefault: vi.fn() });
  expect(fixture.request.mock.calls.map(call => call[0])).toEqual(['/api/local/eligibility']);
});
it.each(['region_not_configured', 'verified_guardian_consent_required'])('stays closed after %s without Cloud fallback', async error => {
  fixture.request.mockResolvedValue(new Response(JSON.stringify({ error }), { status: 403 }));
  await form().props.onSubmit({ preventDefault: vi.fn() });
  expect(fixture.request).toHaveBeenCalledOnce();
  expect(fixture.request.mock.calls[0][0]).toBe('/api/local/eligibility');
  expect(preferences().accepted).toBe(false);
  expect(stored.has('kyalulu-eligibility-ticket')).toBe(false);
  expect(fixture.states[1]).toBe('legal');
  expect(fixture.states[3]).toBe(error === 'verified_guardian_consent_required' ? 'guardian' : 'eligibility');
});
it.each([{ ticket: '' }, { country: 'XY' }, { age_band: 'unknown' }, { policy: '' }])('does not accept an invalid local eligibility response %j', async patch => {
  fixture.request.mockResolvedValue(eligibility(patch));
  await form().props.onSubmit({ preventDefault: vi.fn() });
  expect(preferences().accepted).toBe(false);
  expect(stored.has('kyalulu-eligibility-ticket')).toBe(false);
});
it('does not accept an eligibility response after the owner changes', async () => {
  fixture.request.mockImplementation(async () => { rememberOwner('other-fictional-owner'); return eligibility(); });
  await form().props.onSubmit({ preventDefault: vi.fn() });
  expect(preferences().accepted).toBe(false); expect(fixture.states[3]).toBe('scope');
});
it.each([false, true])('requires explicit confirmation before opening Cloud, without changing local state (confirmed=%s)', async confirmed => {
  stored.set('kyalulu-execution-target', 'local'); stored.set('private-draft', 'fictional unsent text');
  const before = [...stored];
  fixture.confirm.mockImplementation(async () => { expect(window.open).not.toHaveBeenCalled(); return confirmed; });
  await find(ExecutionPicker(), node => node.type === 'select').props.onChange({ target: { value: 'cloud' } });
  expect(fixture.confirm).toHaveBeenCalledOnce();
  expect(window.open).toHaveBeenCalledTimes(confirmed ? 1 : 0);
  if (confirmed) expect(window.open).toHaveBeenCalledWith('https://app.kyalulu.com/', '_blank', 'noopener,noreferrer');
  expect([...stored]).toEqual(before); expect(executionTarget()).toBe('local');
  expect(fixture.request).not.toHaveBeenCalled();
});
it('holds a previously saved Cloud target at an explicit handoff instead of running Cloud against local APIs', () => {
  stored.set('kyalulu-execution-target', 'cloud');
  stored.set('kyalulu-app-preferences-v1', JSON.stringify({ ...preferences(), country: 'ZZ', age: 22, accepted: true }));
  const html = renderToStaticMarkup(view());
  expect(html).toContain('Open Cloud'); expect(html).toContain('app.kyalulu.com');
  expect(html).not.toContain('Runtime content'); expect(html).not.toContain('<form');
  expect(fixture.request).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
});
