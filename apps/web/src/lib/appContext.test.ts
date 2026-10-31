import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executionTarget, generationBusy, hasLocalRuntime, isDesktop, isUnifiedEntry, pendingConversation, rememberOwner, setGenerationBusy, switchTarget } from './appContext';
import { ChatRecovery } from './chatRecovery';
import { connectionScope } from './remoteStore';

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubEnv('MODE', 'native');
  vi.stubGlobal('navigator', { userAgent: 'Chromium', language: 'en' });
  vi.stubGlobal('window', { open: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal('location', { origin: 'http://127.0.0.1', hostname: '127.0.0.1', protocol: 'http:', pathname: '/', search: '?private=fixture', hash: '#/chats/private', assign: vi.fn(), reload: vi.fn() });
  Object.assign(window, { location });
  vi.stubGlobal('localStorage', { get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', { getItem: () => null });
  while (generationBusy()) setGenerationBusy(false);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('keeps switching blocked by durable pending work after its chat component leaves and across reloads', () => {
  const recovery = new ChatRecovery(localStorage, connectionScope(), 'pending:茶');
  recovery.draft('Unsent input'); recovery.begin('generation');
  setGenerationBusy(true); setGenerationBusy(false);
  expect(pendingConversation()).toBe('pending:茶'); expect(generationBusy()).toBe(true);
  const before = [...stored];
  for (const target of ['cloud', 'device', 'pc'] as const) expect(() => switchTarget(target)).toThrow('Stop generation');
  expect([...stored]).toEqual(before); expect(location.assign).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  new ChatRecovery(localStorage, connectionScope(), 'pending:茶').settle('generation', false);
  expect(generationBusy()).toBe(false); expect(pendingConversation()).toBeNull();
  expect(recovery.read().draft).toBe('Unsent input');
  switchTarget('device'); expect(location.assign).toHaveBeenCalledWith('/device/#/');
});

it('only blocks the current destination and owner, leaving other-account recovery records untouched', () => {
  stored.set('kyalulu-execution-target', 'device'); rememberOwner('owner-a');
  const recovery = new ChatRecovery(localStorage, connectionScope(), 'same-id'); recovery.begin('generation-a');
  const before = [...stored];
  rememberOwner('owner-b'); expect(generationBusy()).toBe(false);
  stored.set('kyalulu-execution-target', 'pc'); expect(generationBusy()).toBe(false);
  stored.set('kyalulu-execution-target', 'device'); rememberOwner('owner-a');
  expect(generationBusy()).toBe(true); expect([...stored]).toEqual(before);
});

it('fails closed on damaged current recovery or unavailable storage without mutating it', () => {
  const key = new ChatRecovery(localStorage, connectionScope(), 'damaged').key;
  stored.set(key, '{invalid'); const before = [...stored];
  expect(pendingConversation()).toBe(''); expect(() => switchTarget('device')).toThrow('Stop generation');
  expect([...stored]).toEqual(before);
  stored.clear(); Object.defineProperty(localStorage, 'length', { get() { throw Error('Storage denied'); } });
  expect(pendingConversation()).toBe(''); expect(generationBusy()).toBe(true);
  vi.stubGlobal('localStorage', { getItem: () => null });
});

it('defaults native browsers to local without treating them as Electron', () => {
  expect(isDesktop()).toBe(false);
  expect(hasLocalRuntime()).toBe(true);
  expect(isUnifiedEntry()).toBe(true);
  expect(executionTarget()).toBe('local');
});
it('keeps hosted unified browsers on Cloud', () => {
  vi.stubEnv('MODE', 'unified');
  expect(hasLocalRuntime()).toBe(false);
  expect(executionTarget()).toBe('cloud');
});
it('keeps Electron local even without the native browser build context', () => {
  vi.stubEnv('MODE', 'production');
  vi.stubGlobal('window', { electronAPI: {} });
  expect(isDesktop()).toBe(true);
  expect(hasLocalRuntime()).toBe(true);
  expect(executionTarget()).toBe('local');
});
it.each(['local', 'pc', 'device', 'cloud'])('preserves an explicit saved %s target', target => {
  stored.set('kyalulu-execution-target', target);
  expect(executionTarget()).toBe(target);
});
it('preserves explicit PC pairing as the existing default', () => {
  stored.set('kyalulu-active-remote', 'fictional-pairing');
  expect(executionTarget()).toBe('pc');
});
it('keeps device URLs isolated regardless of the saved local target', () => {
  location.pathname = '/device/';
  stored.set('kyalulu-execution-target', 'local');
  expect(executionTarget()).toBe('device');
  switchTarget('local');
  expect(location.assign).toHaveBeenCalledWith('/#/');
});
it('uses the isolated device document when a native browser selects device', () => {
  switchTarget('device');
  expect(stored.get('kyalulu-execution-target')).toBe('device');
  expect(location.assign).toHaveBeenCalledWith('/device/#/');
  expect(location.reload).not.toHaveBeenCalled();
});
it.each([false, true])('opens only the canonical Cloud URL, preserving local target and drafts (Electron=%s)', electron => {
  stored.set('kyalulu-execution-target', 'local'); stored.set('private-draft', 'fictional unsent draft');
  stored.set('kyalulu-eligibility-ticket', 'native:fictional');
  const before = [...stored];
  if (electron) Object.assign(window, { electronAPI: {} });
  switchTarget('cloud');
  expect(window.open).toHaveBeenCalledExactlyOnceWith('https://app.kyalulu.com/', '_blank', 'noopener,noreferrer');
  expect([...stored]).toEqual(before);
  expect(location.assign).not.toHaveBeenCalled();
  expect(location.reload).not.toHaveBeenCalled();
  expect(executionTarget()).toBe('local');
});
it('still prevents external Cloud transitions during generation reconciliation', () => {
  setGenerationBusy(true);
  expect(() => switchTarget('cloud')).toThrow('Stop generation');
  expect(window.open).not.toHaveBeenCalled(); expect(stored.size).toBe(0);
});
it('keeps hosted Cloud switching within its own origin', () => {
  vi.stubEnv('MODE', 'unified');
  switchTarget('cloud');
  expect(stored.get('kyalulu-execution-target')).toBe('cloud');
  expect(location.assign).toHaveBeenCalledWith('/#/');
  expect(window.open).not.toHaveBeenCalled();
});
