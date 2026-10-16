import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import CloudRouteChoice from '../components/CloudRouteChoice';
import { fetchCharacters, fetchSessions, fetchWorlds } from './api';
import { clearLoginReturn, consumeLoginReturn, fetchBrowseCatalog, guestReadableRoute, isCloudGuest, loginPath, readLoginReturn, rememberLoginReturn, safeLoginReturn } from './cloudGuest';

vi.mock('./api', () => ({ fetchCharacters: vi.fn(), fetchSessions: vi.fn(), fetchWorlds: vi.fn() }));
vi.mock('../components/CloudLogin', () => ({ default: ({ returnTo }: { returnTo: string }) => <div>login:{returnTo}</div> }));

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  vi.mocked(fetchCharacters).mockResolvedValue([{ id: 'public', display_name: 'Public', version: '1.0.0', description: 'Public description' }]);
  vi.mocked(fetchWorlds).mockResolvedValue([]);
  vi.mocked(fetchSessions).mockResolvedValue([{ session_id: 'private', count: 2 } as never]);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('guest browsing never requests private sessions', async () => {
  expect((await fetchBrowseCatalog(true, true))[2]).toEqual([]);
  expect(fetchCharacters).toHaveBeenCalledWith(true);
  expect(fetchWorlds).toHaveBeenCalledOnce();
  expect(fetchSessions).not.toHaveBeenCalled();
});
it('authenticated and local browsing still loads sessions', async () => {
  expect((await fetchBrowseCatalog(false))[2][0].session_id).toBe('private');
  expect(fetchSessions).toHaveBeenCalledOnce();
  expect(isCloudGuest({ cloud_mode: false, authenticated: false })).toBe(false);
  expect(isCloudGuest({ authenticated: true })).toBe(false);
  expect(isCloudGuest({ cloud_mode: true, authenticated: true })).toBe(false);
  expect(isCloudGuest({ cloud_mode: true, authenticated: false })).toBe(true);
});
it.each(['/', '/discover', '/characters/mocha', '/works/public', '/authors/creator'])('renders public guest route %s', path => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><CloudRouteChoice authenticated={false}><span>public-page</span></CloudRouteChoice></MemoryRouter>);
  expect(html).toContain('public-page'); expect(html).not.toContain('login:');
});
it.each(['/chats', '/chats/private', '/create', '/profile', '/studio', '/works/public/edit'])('requires login for guest private route %s', path => {
  expect(guestReadableRoute(path)).toBe(false);
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><CloudRouteChoice authenticated={false}><span>private-page</span></CloudRouteChoice></MemoryRouter>);
  expect(html).toContain('login:'); expect(html).not.toContain('private-page');
});
it('renders authenticated chat without changing the local/BYOK requirement', () => {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/chats/private']}><CloudRouteChoice authenticated><span>private-page</span></CloudRouteChoice></MemoryRouter>);
  expect(html).toContain('private-page');
});
it('preserves the selected work across OAuth redirect and consumes it once', () => {
  const target = '/works/selected?q=story';
  expect(loginPath(target)).toBe('/login?returnTo=%2Fworks%2Fselected%3Fq%3Dstory');
  expect(readLoginReturn()).toBe('/'); // Constructing a link has no storage side effect.
  rememberLoginReturn(target);
  expect(readLoginReturn()).toBe(target);
  expect(consumeLoginReturn()).toBe(target);
  expect(consumeLoginReturn()).toBe('/');
  rememberLoginReturn(target); clearLoginReturn(); expect(readLoginReturn()).toBe('/');
});
it('retains the selected work when OAuth fails and requires a login retry', () => {
  rememberLoginReturn('/works/selected');
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/?login_error=login_cancelled']}><CloudRouteChoice authenticated={false}><span>public-page</span></CloudRouteChoice></MemoryRouter>);
  expect(html).toContain('login:/works/selected');
  expect(html).not.toContain('public-page');
});
it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/login?returnTo=/login', '/chats/private#injected', '/chats/\nprivate'])('rejects unsafe authentication return %s', path => {
  expect(safeLoginReturn(path)).toBe('/');
  rememberLoginReturn(path); expect(consumeLoginReturn()).toBe('/');
});
it('supports explicit internal return paths even when sessionStorage is unavailable', () => {
  vi.stubGlobal('sessionStorage', { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); }, removeItem() { throw Error('disabled'); } });
  expect(rememberLoginReturn('/characters/mocha')).toBe('/characters/mocha');
  expect(consumeLoginReturn('/characters/mocha')).toBe('/characters/mocha');
});
