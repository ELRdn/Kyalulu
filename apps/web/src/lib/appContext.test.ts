import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { executionTarget, generationBusy, hasLocalRuntime, isDesktop, isUnifiedEntry, setGenerationBusy, switchTarget } from './appContext';

let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubEnv('MODE', 'native');
  vi.stubGlobal('navigator', { userAgent: 'Chromium', language: 'en' });
  vi.stubGlobal('window', { open: vi.fn(), dispatchEvent: vi.fn() });
  vi.stubGlobal('location', { hostname: '127.0.0.1', protocol: 'http:', pathname: '/', search: '?private=fixture', hash: '#/chats/private', assign: vi.fn(), reload: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => {
  while (generationBusy()) setGenerationBusy(false);
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
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
