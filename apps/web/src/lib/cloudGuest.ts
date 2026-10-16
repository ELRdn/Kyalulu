import { fetchCharacters, fetchSessions, fetchWorlds } from './api';

type Access = { cloud_mode?: boolean; authenticated: boolean };
export const isCloudGuest = (access: Access) => access.cloud_mode === true && !access.authenticated;
export const guestReadableRoute = (path: string) => path === '/' || path === '/discover' ||
  /^\/(?:characters|works|authors)\/[^/]+$/.test(path);

export async function fetchBrowseCatalog(guest: boolean, adult = false) {
  return Promise.all([fetchCharacters(adult), fetchWorlds(), guest ? Promise.resolve([]) : fetchSessions()]);
}

const RETURN_KEY = 'kyalulu-cloud-login-return';
export function safeLoginReturn(value: string | null | undefined): string {
  if (!value || value.length > 2048 || /[\\\u0000-\u001f#]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/';
  const path = value.split('?')[0];
  return guestReadableRoute(path) || /^\/(?:chats|create|profile|studio|research|status|benchmarks)(?:\/[^/]+)*$/.test(path) ? value : '/';
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
