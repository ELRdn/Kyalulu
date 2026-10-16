import config from '../../../../packages/analytics/config.json';
import { initAnalytics, analyticsEvent as sendEvent, analyticsConsent, subscribeAnalyticsConsent,
  type AnalyticsEvent } from '../../../../packages/analytics/analytics.js';
import { cloudOwner, isCloud, subscribeCloudIdentity } from './cloudMode';

export { analyticsConsent, subscribeAnalyticsConsent };
export const analyticsLanguage = (): 'ja' | 'en' => typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? 'en' : 'ja';
let authenticated: boolean | null = null;
let viewedPage: string | null = null;

function cloudApp() {
  return import.meta.env.PROD && isCloud() && typeof window !== 'undefined' && window.location.hostname === 'cloud.kyalulu.com';
}

export function appAnalyticsEvent(name: AnalyticsEvent, pageKind = 'cloud') {
  try { return cloudApp() && sendEvent(name, { page_kind: pageKind, language: analyticsLanguage() }); } catch { return false; }
}

export function syncAppAnalytics() {
  try {
    const cloud = cloudApp();
    const ready = initAnalytics({ measurementId: cloud ? config.measurementId : '', language: analyticsLanguage(), cloud });
    if (!cloud) { authenticated = null; viewedPage = null; return false; }
    const next = Boolean(cloudOwner());
    let returningFromLogin = false;
    if (authenticated === null && next) {
      // Reuse the existing OAuth return receipt; do not persist analytics events or account IDs.
      try { returningFromLogin = sessionStorage.getItem('kyalulu-cloud-login-return') !== null; } catch { /* No receipt: count only observed transitions. */ }
    }
    if (next && (authenticated === false || returningFromLogin)) appAnalyticsEvent('login');
    authenticated = next;
    return ready;
  } catch { return false; }
}

// RuntimeGate sets mode and owner together. Batch its notifications to avoid a false guest->login on startup.
subscribeCloudIdentity(() => { queueMicrotask(syncAppAnalytics); });

export function analyticsPageKind(pathname: string) {
  if (pathname === '/') return 'home';
  if (/^\/chats\/[^/]+$/.test(pathname)) return 'chat';
  if (/^\/characters\/[^/]+$/.test(pathname)) return 'character';
  if (/^\/works\/[^/]+$/.test(pathname)) return 'work';
  if (/^\/authors\/[^/]+$/.test(pathname)) return 'author';
  if (/^\/create(?:\/settings)?$/.test(pathname)) return 'create';
  return ['/discover', '/chats', '/profile'].includes(pathname) ? pathname.slice(1) : 'other';
}

export const appAnalyticsPageView = (pathname: string) => appAnalyticsEvent('page_view', analyticsPageKind(pathname));

export function subscribeAppAnalyticsPageView(routeKey: string, pathname: string) {
  const view = () => {
    if (viewedPage !== routeKey && appAnalyticsPageView(pathname)) viewedPage = routeKey;
  };
  view();
  return subscribeAnalyticsConsent(() => { viewedPage = null; view(); });
}

/** Call after the history response passes the caller's session/epoch guards. */
export function chatReopenedAnalytics(loadedSession: { current: string | null }, sessionId: string, hasSavedContent: boolean) {
  if (loadedSession.current === sessionId) return false;
  loadedSession.current = sessionId;
  return hasSavedContent && Boolean(cloudOwner()) && appAnalyticsEvent('chat_reopened', 'chat');
}

/** New request's terminal success only; recovery/debug/replay never call this. */
export function chatCompletedAnalytics(success: boolean, fresh: boolean) {
  return success && fresh && Boolean(cloudOwner()) && appAnalyticsEvent('chat_completed', 'chat');
}
