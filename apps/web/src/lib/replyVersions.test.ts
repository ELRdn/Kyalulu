import { afterEach, expect, it, vi } from 'vitest';
import { eraseReplyVersions, getReplyVersions, recordReplyVersion } from './replyVersions';
import { setCloud, setCloudOwner } from './cloudMode';
afterEach(() => { setCloud(false); vi.unstubAllGlobals(); });
it('erases only the exact session under the current account, including colon IDs', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
  setCloud(true); setCloudOwner('a');
  recordReplyVersion('s', 1, 'old', 'new'); recordReplyVersion('s:1', 2, 'other old', 'other new');
  setCloudOwner('b'); recordReplyVersion('s', 1, 'private old', 'private new');
  setCloudOwner('a'); eraseReplyVersions('s');
  expect(getReplyVersions('s', 1)).toBeNull(); expect(getReplyVersions('s:1', 2)?.versions).toEqual(['other old', 'other new']);
  setCloudOwner('b'); expect(getReplyVersions('s', 1)?.versions).toEqual(['private old', 'private new']);
});
it('surfaces inaccessible browser storage instead of claiming erasure succeeded', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); } });
  expect(() => eraseReplyVersions('s')).toThrow('blocked');
});
