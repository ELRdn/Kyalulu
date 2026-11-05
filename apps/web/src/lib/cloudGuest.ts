import { fetchCharacters, fetchSessions, fetchWorlds } from './api';

type Access = { cloud_mode?: boolean; authenticated: boolean };
export const isCloudGuest = (access: Access) => access.cloud_mode === true && !access.authenticated;
// The tab roots render a guest view with the login sheet instead of the full-screen login (docs/MOBILE_UX_SPEC.md §5.4-5.7).
export const guestReadableRoute = (path: string) => ['/', '/discover', '/published', '/chats', '/create', '/profile'].includes(path) ||
  /^\/(?:characters|works|authors|published)\/[^/]+$/.test(path);
// Top-level segments of the routes in App.tsx (same list as APP_ROUTES in runtime/python/api/mobile.py).
const APP_SEGMENTS = new Set(['', 'discover', 'published', 'publications', 'works', 'authors', 'chats', 'characters',
  'create', 'research', 'profile', 'migration', 'studio', 'status']);
/** Paths no route matches: guests get the 404 page instead of the login screen. */
export const unknownRoute = (path: string) => !APP_SEGMENTS.has(path.split('/')[1] ?? '');

export async function fetchBrowseCatalog(guest: boolean, adult = false) {
  return Promise.all([fetchCharacters(adult), fetchWorlds(), guest ? Promise.resolve([]) : fetchSessions()]);
}

const RETURN_KEY = 'kyalulu-cloud-login-return';
export function safeLoginReturn(value: string | null | undefined): string {
  if (!value || value.length > 2048 || /[\\\u0000-\u001f#]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/';
  const path = value.split('?')[0];
  return guestReadableRoute(path) || /^\/(?:chats|create|profile|studio|research|status|benchmarks|publications)(?:\/[^/]+)*$/.test(path) ? value : '/';
}
export function rememberLoginReturn(value: string) {
  const safe = safeLoginReturn(value);
  try { sessionStorage.setItem(RETURN_KEY, safe); } catch { /* The URL still carries the return path. */ }
  return safe;
}
export function loginPath(value: string) {
  return '/login?' + new URLSearchParams({ returnTo: safeLoginReturn(value) });
}
export function readLoginReturn(fallback = '/') {
  try { return safeLoginReturn(sessionStorage.getItem(RETURN_KEY) ?? fallback); } catch { return safeLoginReturn(fallback); }
}
export function consumeLoginReturn(fallback = '/') {
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(RETURN_KEY); sessionStorage.removeItem(RETURN_KEY); } catch { /* Storage may be disabled. */ }
  return safeLoginReturn(saved ?? fallback);
}
export function clearLoginReturn() {
  try { sessionStorage.removeItem(RETURN_KEY); } catch { /* Storage may be disabled. */ }
}
