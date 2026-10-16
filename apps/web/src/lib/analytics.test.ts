import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../packages/analytics/config.json', () => ({ default: { measurementId: 'G-TEST123' } }));
const ID = 'G-TEST123';
const COOKIE = 'kyalulu_analytics_consent';
type Cookie = { name: string; value: string; path: string; domain: string };

function browser(url = 'https://cloud.kyalulu.com/?token=PRIVATE#/chats/SECRET') {
  const location = new URL(url);
  const jar: Cookie[] = [];
  const writes: string[] = [];
  const scripts: any[] = [];
  const events = new Map<string, () => void>();
  const window: any = { location, addEventListener: (name: string, callback: () => void) => events.set(name, callback) };
  let denyReads = false, denyWrites = false;
  const document = {
    documentElement: { lang: 'ja' },
    referrer: 'https://search.example/private?q=SECRET#secret',
    createElement: vi.fn(() => ({})),
    head: { appendChild: vi.fn((script: any) => { scripts.push(script); }) },
    addEventListener: (name: string, callback: () => void) => events.set(name, callback),
    get cookie() {
      if (denyReads) throw Error('Storage denied');
      return jar.filter(cookie => (cookie.domain === location.hostname || location.hostname.endsWith('.' + cookie.domain)) &&
        (location.pathname === cookie.path || location.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : cookie.path + '/')))
        .map(cookie => cookie.name + '=' + cookie.value).join('; ');
    },
    set cookie(value: string) {
      if (denyWrites) throw Error('Storage denied');
      writes.push(value);
      const [pair, ...attributes] = value.split(';').map(part => part.trim());
      const [name, content] = pair.split('=');
      const domain = (attributes.find(part => part.startsWith('Domain='))?.slice(7) ?? location.hostname).replace(/^\./, '');
      const path = attributes.find(part => part.startsWith('Path='))?.slice(5) ?? '/';
      const index = jar.findIndex(cookie => cookie.name === name && cookie.domain === domain && cookie.path === path);
      if (index !== -1) jar.splice(index, 1);
      if (!attributes.includes('Max-Age=0')) jar.push({ name, value: content, domain, path });
    },
  };
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null) });
  return { window, document, jar, writes, scripts, events,
    blockStorage() { denyReads = true; denyWrites = true; },
    commands: () => (window.dataLayer ?? []).map((args: any) => Array.from(args)),
    seed(name: string, value: string, path = '/', domain = 'kyalulu.com') { jar.push({ name, value, path, domain }); },
  };
}

beforeEach(() => { vi.resetModules(); vi.stubEnv('PROD', true); vi.stubEnv('DEV', false); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('shared GA4 privacy boundary', () => {
  it('makes no Google request and queues no event before consent or on denial', async () => {
    const b = browser();
    const a = await import('../../../../packages/analytics/analytics.js');
    expect(a.initAnalytics({ measurementId: ID, cloud: true })).toBe(true);
    expect(a.analyticsConsent()).toBeNull();
    expect(a.analyticsEvent('chat_completed', { page_kind: 'chat' })).toBe(false);
    a.analyticsConsent('denied');
    expect(a.analyticsEvent('page_view')).toBe(false);
    expect(b.scripts).toHaveLength(0); expect(b.commands()).toEqual([]);
    expect(b.window['ga-disable-' + ID]).toBe(true);
    expect(b.writes).toContain(`${COOKIE}=denied; Path=/; Domain=kyalulu.com; Max-Age=15552000; Secure; SameSite=Lax`);
  });

  it('loads one script after consent, disables auto pageviews/ads/signals and uses safe config defaults', async () => {
    const b = browser(); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted');
    expect(b.scripts).toHaveLength(1);
    expect(b.scripts[0]).toMatchObject({ src: 'https://www.googletagmanager.com/gtag/js?id=' + ID, async: true, referrerPolicy: 'no-referrer' });
    const configs = b.commands().filter((args: any[]) => args[0] === 'config');
    expect(configs).toHaveLength(1);
    expect(configs[0][2]).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      page_location: 'https://cloud.kyalulu.com/', page_title: 'Kyalulu | cloud', page_referrer: 'https://search.example', cookie_flags: 'SameSite=Lax;Secure' });
    expect(b.commands().filter((args: any[]) => args[0] === 'event')).toEqual([]);
    expect(JSON.stringify(b.commands())).not.toMatch(/PRIVATE|SECRET|user_id/);
  });

  it.each([
    ['http://kyalulu.com/', false], ['http://cloud.kyalulu.com/', true], ['https://app.kyalulu.com/', true],
    ['http://localhost:5173/', true], ['https://127.0.0.1/', true], ['file:///app/index.html', true],
    ['https://cloud.kyalulu.com.evil.test/', true], ['https://preview.kyalulu.com/', true],
    ['https://cloud.kyalulu.com:5173/', true], ['https://kyalulu.com:5173/', false], ['https://cloud.kyalulu.com/', false],
  ])('blocks origin/runtime %s (Cloud=%s)', async (url, cloud) => {
    const b = browser(url as string); b.seed(COOKIE, 'granted');
    const a = await import('../../../../packages/analytics/analytics.js');
    expect(a.initAnalytics({ measurementId: ID, cloud: cloud as boolean })).toBe(false);
    a.analyticsConsent('granted');
    expect(a.analyticsEvent('page_view')).toBe(false); expect(b.scripts).toHaveLength(0);
  });

  it.each(['', 'G-evil?id=SECRET', 'UA-123', 'https://evil.test/', 'G-foo'])('disables unset/invalid ID %s', async measurementId => {
    const b = browser('https://kyalulu.com/'); b.seed(COOKIE, 'granted');
    const a = await import('../../../../packages/analytics/analytics.js');
    expect(a.initAnalytics({ measurementId })).toBe(false); expect(b.scripts).toHaveLength(0);
  });

  it('allows only named events, categorical props, safe URLs and no app identifiers/content', async () => {
    const b = browser(); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted');
    const privateProps = { page_kind: 'chat', language: 'en', session_id: 'SECRET', account_id: 'SECRET', user_id: 'SECRET',
      message: 'SECRET', character: 'SECRET', content: 'SECRET', page_location: 'https://evil.test/?token=SECRET', page_title: 'SECRET', page_referrer: 'SECRET', utm_source: 'SECRET' };
    for (const name of ['page_view', 'local_install_guide_open', 'cloud_open', 'login', 'chat_completed', 'chat_reopened'] as const) {
      expect(a.analyticsEvent(name, privateProps)).toBe(true);
    }
    expect(a.analyticsEvent('arbitrary' as never, privateProps)).toBe(false);
    const payloads = b.commands().filter((args: any[]) => args[0] === 'event').map((args: any[]) => args[2]);
    expect(payloads).toHaveLength(6);
    for (const payload of payloads) expect(payload).toEqual({ page_kind: 'chat', language: 'en', page_location: 'https://cloud.kyalulu.com/',
      page_title: 'Kyalulu | chat', page_referrer: 'https://search.example', send_to: ID });
    a.analyticsEvent('page_view', { page_kind: 'SECRET', language: 'SECRET' });
    expect(b.commands().at(-1)[2]).toMatchObject({ page_kind: 'cloud', language: 'ja' });
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it.each([
    ['/docs/quickstart/?token=SECRET#private', 'https://kyalulu.com/docs/quickstart/'],
    ['/docs/en/cloud/index.html?token=SECRET#private', 'https://kyalulu.com/docs/en/cloud/'],
    ['/docs/SECRET/?q=SECRET', 'https://kyalulu.com/docs/'],
    ['/docs/en/?q=SECRET', 'https://kyalulu.com/docs/en/'],
    ['/account/SECRET?q=SECRET', 'https://kyalulu.com/'],
  ])('canonicalizes public URL %s', async (path, safe) => {
    const b = browser('https://kyalulu.com' + path); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID }); a.analyticsConsent('granted'); a.analyticsEvent('page_view');
    for (const args of b.commands().filter((args: any[]) => ['config', 'event'].includes(args[0]))) expect(args[2].page_location).toBe(safe);
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it.each(['https://user:password@example.test/private', 'javascript:alert(1)', 'file:///SECRET', 'not a URL'])('excludes credentialed/non-HTTP referrer %s', async referrer => {
    const b = browser(); b.document.referrer = referrer;
    const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted'); a.analyticsEvent('page_view');
    expect(b.commands().at(-1)[2].page_referrer).toBe('');
  });

  it('preserves only exact allowlisted campaign values in both config and events', async () => {
    const b = browser('https://cloud.kyalulu.com/?utm_source=chatgpt&utm_medium=referral&utm_campaign=cloud-beta&utm_term=SECRET&token=SECRET#/chats/SECRET');
    const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted'); a.analyticsEvent('page_view');
    for (const args of b.commands().filter((args: any[]) => ['config', 'event'].includes(args[0]))) {
      expect(args[2]).toMatchObject({ campaign_source: 'chatgpt', campaign_medium: 'referral', campaign_name: 'cloud-beta', page_location: 'https://cloud.kyalulu.com/' });
      expect(args[2]).not.toHaveProperty('campaign_term');
    }
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it.each(['utm_source=SECRET&utm_medium=email&utm_campaign=SECRET', 'utm_source=chatgpt&utm_source=SECRET', 'utm_source=ChatGPT', 'utm_source=github%0ASECRET'])('drops unsafe/duplicate attribution %s', async query => {
    const b = browser('https://kyalulu.com/docs/?' + query); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID }); a.analyticsConsent('granted'); a.analyticsEvent('page_view');
    for (const args of b.commands().filter((args: any[]) => ['config', 'event'].includes(args[0]))) {
      expect(args[2]).not.toHaveProperty('campaign_source'); expect(args[2]).not.toHaveProperty('campaign_medium'); expect(args[2]).not.toHaveProperty('campaign_name');
    }
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it('revokes immediately, removes accessible GA cookies across domain/path scopes and clears pending commands', async () => {
    const b = browser('https://cloud.kyalulu.com/docs/en/privacy/'); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); a.analyticsConsent('granted'); a.analyticsEvent('chat_completed');
    b.seed('_ga', 'SECRET'); b.seed('_ga_TEST123', 'SECRET', '/docs', 'cloud.kyalulu.com');
    b.seed('_ga_OTHER', 'SECRET', '/docs/en/'); b.seed('account', 'keep'); b.seed('_gads', 'keep');
    a.analyticsConsent('denied');
    expect(b.window['ga-disable-' + ID]).toBe(true); expect(b.commands()).toEqual([]);
    expect(a.analyticsEvent('page_view')).toBe(false);
    expect(b.jar.filter(cookie => cookie.name.startsWith('_ga') && cookie.name !== '_gads')).toEqual([]);
    expect(b.jar.find(cookie => cookie.name === 'account')?.value).toBe('keep');
    expect(b.jar.find(cookie => cookie.name === '_gads')?.value).toBe('keep');
    b.seed('_ga', 'late-cookie'); b.scripts[0].onload();
    expect(b.jar.find(cookie => cookie.name === '_ga')).toBeUndefined();
    a.analyticsConsent('granted'); a.analyticsEvent('page_view');
    expect(b.scripts).toHaveLength(1); expect(b.commands().filter((args: any[]) => args[0] === 'event').map((args: any[]) => args[1])).toEqual(['page_view']);
    expect(b.commands().some((args: any[]) => args[0] === 'js')).toBe(true);
  });

  it('notifies subscribers once per change and shares revocation across public surfaces', async () => {
    const b = browser(); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true });
    const changed = vi.fn(); const unsubscribe = a.subscribeAnalyticsConsent(changed);
    a.analyticsConsent('granted'); a.analyticsConsent('granted');
    expect(changed.mock.calls).toEqual([['granted']]);
    b.document.cookie = `${COOKIE}=denied; Domain=kyalulu.com; Path=/`;
    b.events.get('focus')!();
    expect(changed.mock.calls).toEqual([['granted'], ['denied']]); expect(a.analyticsEvent('page_view')).toBe(false);
    unsubscribe(); a.analyticsConsent('granted'); expect(changed).toHaveBeenCalledTimes(2);
  });

  it('supports explicit per-document decisions when storage is denied without a persistent event queue', async () => {
    const b = browser(); b.blockStorage(); const a = await import('../../../../packages/analytics/analytics.js');
    expect(a.initAnalytics({ measurementId: ID, cloud: true })).toBe(true);
    expect(a.analyticsEvent('login')).toBe(false); expect(b.scripts).toHaveLength(0);
    expect(a.analyticsConsent('granted')).toBe('granted'); expect(a.analyticsEvent('page_view')).toBe(true);
    expect(a.analyticsConsent('denied')).toBe('denied'); expect(a.analyticsEvent('chat_completed')).toBe(false);
    expect(b.writes).toEqual([]); expect(b.commands()).toEqual([]);
  });

  it('fails closed on conflicting consent cookies', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); b.seed(COOKIE, 'denied', '/', 'cloud.kyalulu.com');
    const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true }); expect(a.analyticsConsent()).toBe('denied'); expect(b.scripts).toHaveLength(0);
  });

  it('tolerates script, GA, DOM and subscriber failures without breaking the app', async () => {
    const b = browser(); const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true });
    a.subscribeAnalyticsConsent(() => { throw Error('UI failure'); });
    expect(() => a.analyticsConsent('granted')).not.toThrow();
    b.window.gtag = () => { throw Error('Blocked GA'); };
    expect(a.analyticsEvent('page_view')).toBe(false);
    b.scripts[0].onerror(); expect(a.analyticsEvent('page_view')).toBe(false);
    expect(() => a.analyticsConsent('denied')).not.toThrow();
    expect(b.window['ga-disable-' + ID]).toBe(true);
  });

  it('does nothing when no browser exists', async () => {
    const a = await import('../../../../packages/analytics/analytics.js');
    expect(a.initAnalytics({ measurementId: ID })).toBe(false); expect(a.analyticsEvent('page_view')).toBe(false); expect(a.analyticsConsent()).toBeNull();
  });

  it('contains DOM setup failure and does not accumulate events after failed loading', async () => {
    const b = browser(); b.document.head.appendChild.mockImplementation(() => { throw Error('CSP/DOM failure'); });
    const a = await import('../../../../packages/analytics/analytics.js');
    a.initAnalytics({ measurementId: ID, cloud: true });
    expect(() => a.analyticsConsent('granted')).not.toThrow();
    for (let i = 0; i < 10; i++) expect(a.analyticsEvent('page_view')).toBe(false);
    expect(b.commands()).toEqual([]); expect(b.window['ga-disable-' + ID]).toBe(true);
  });
});

describe('Cloud app integration', () => {
  async function app() {
    const mode = await import('./cloudMode'); const a = await import('./analytics'); return { mode, a };
  }
  it('waits for verified actual Cloud mode even with an existing grant', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app();
    expect(a.syncAppAnalytics()).toBe(false); expect(b.scripts).toHaveLength(0);
    mode.setCloud(true); mode.setCloudOwner('PRIVATE'); await Promise.resolve();
    expect(a.syncAppAnalytics()).toBe(true); expect(b.scripts).toHaveLength(1);
    expect(b.commands().filter((args: any[]) => args[0] === 'event')).toEqual([]); // Existing session is not a fresh login.
    expect(JSON.stringify(b.commands())).not.toContain('PRIVATE');
  });

  it('emits login only for successful guest->authenticated transitions, never failed/duplicate/account-only changes', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app();
    mode.setCloud(true); await Promise.resolve();
    mode.setCloudOwner(''); a.syncAppAnalytics();
    mode.setCloudOwner('SECRET'); await Promise.resolve(); a.syncAppAnalytics();
    mode.setCloudOwner('OTHER_SECRET'); await Promise.resolve();
    expect(b.commands().filter((args: any[]) => args[0] === 'event').map((args: any[]) => args[1])).toEqual(['login']);
    expect(JSON.stringify(b.commands())).not.toMatch(/SECRET/);
  });

  it('counts a verified OAuth return without modifying the app navigation receipt', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const receipt = vi.fn(() => '/works/SECRET');
    vi.stubGlobal('sessionStorage', { getItem: receipt }); const { mode, a } = await app();
    mode.setCloud(true); mode.setCloudOwner('SECRET'); await Promise.resolve(); a.syncAppAnalytics();
    expect(b.commands().filter((args: any[]) => args[0] === 'event').map((args: any[]) => args[1])).toEqual(['login']);
    expect(receipt).toHaveBeenCalledWith('kyalulu-cloud-login-return'); expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it('drops pre-consent login/completion and emits current sanitized page_view once on grant', async () => {
    const b = browser(); const { mode, a } = await app(); mode.setCloud(true); await Promise.resolve();
    mode.setCloudOwner('SECRET'); await Promise.resolve();
    expect(a.chatCompletedAnalytics(true, true)).toBe(false);
    const initialCleanup = a.subscribeAppAnalyticsPageView('route-key', '/chats/SECRET'); initialCleanup();
    const unsubscribe = a.subscribeAppAnalyticsPageView('route-key', '/chats/SECRET');
    a.analyticsConsent('granted'); a.analyticsConsent('granted'); unsubscribe();
    const remountCleanup = a.subscribeAppAnalyticsPageView('route-key', '/chats/SECRET'); remountCleanup();
    const events = b.commands().filter((args: any[]) => args[0] === 'event');
    expect(events.map((args: any[]) => args[1])).toEqual(['page_view']);
    expect(events[0][2]).toMatchObject({ page_kind: 'chat', page_location: 'https://cloud.kyalulu.com/' });
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  it('tracks real SPA navigation once while keeping automatic config and route data safe', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app();
    mode.setCloud(true); await Promise.resolve();
    const home = a.subscribeAppAnalyticsPageView('home', '/'); home();
    b.window.location.hash = '#/chats/SECRET?account=PRIVATE';
    (b.document as any).title = 'PRIVATE character name';
    const chat = a.subscribeAppAnalyticsPageView('chat', '/chats/SECRET'); chat();
    const duplicate = a.subscribeAppAnalyticsPageView('chat', '/chats/SECRET'); duplicate();
    const events = b.commands().filter((args: any[]) => args[0] === 'event');
    expect(events.map((args: any[]) => args[2].page_kind)).toEqual(['home', 'chat']);
    expect(JSON.stringify(b.commands())).not.toMatch(/SECRET|PRIVATE/);
    expect(b.commands().filter((args: any[]) => args[0] === 'config')).toHaveLength(1);
  });

  it.each([['/', 'home'], ['/chats/SECRET', 'chat'], ['/works/SECRET', 'work'], ['/characters/SECRET', 'character'],
    ['/authors/SECRET', 'author'], ['/create/settings', 'create'], ['/profile', 'profile'], ['/status', 'other']])('uses generic SPA category for %s', async (path, kind) => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app(); mode.setCloud(true); await Promise.resolve();
    expect(a.appAnalyticsPageView(path)).toBe(true); expect(b.commands().at(-1)[2].page_kind).toBe(kind);
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it('accepts only successful fresh authenticated chat events and stops after logout/mode change', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app(); mode.setCloud(true); mode.setCloudOwner('SECRET'); await Promise.resolve();
    expect(a.chatCompletedAnalytics(false, true)).toBe(false); expect(a.chatCompletedAnalytics(true, false)).toBe(false);
    const loadedSession = { current: null as string | null };
    expect(a.chatReopenedAnalytics(loadedSession, 'empty', false)).toBe(false); expect(a.chatCompletedAnalytics(true, true)).toBe(true);
    expect(a.chatReopenedAnalytics(loadedSession, 'saved', true)).toBe(true);
    mode.setCloudOwner(''); expect(a.chatCompletedAnalytics(true, true)).toBe(false); await Promise.resolve();
    mode.setCloud(false); expect(a.appAnalyticsPageView('/')).toBe(false); await Promise.resolve();
    expect(b.window['ga-disable-' + ID]).toBe(true);
  });

  it('counts each newly opened saved session using the same gate, without counting history replay or empty-chat updates', async () => {
    const b = browser(); b.seed(COOKIE, 'granted'); const { mode, a } = await app();
    mode.setCloud(true); mode.setCloudOwner('SECRET_OWNER'); await Promise.resolve();
    const loadedSession = { current: null as string | null };
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_A', true)).toBe(true);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_A', true)).toBe(false);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_B', true)).toBe(true);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_B', true)).toBe(false);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_EMPTY', false)).toBe(false);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_EMPTY', true)).toBe(false);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_A', true)).toBe(true);
    const events = b.commands().filter((args: any[]) => args[0] === 'event');
    expect(events.map((args: any[]) => args[1])).toEqual(['chat_reopened', 'chat_reopened', 'chat_reopened']);
    expect(events.every((args: any[]) => args[2].page_kind === 'chat')).toBe(true);
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it('does not replay a pre-consent initial history load after consent is granted', async () => {
    const b = browser(); const { mode, a } = await app();
    mode.setCloud(true); mode.setCloudOwner('SECRET'); await Promise.resolve();
    const loadedSession = { current: null as string | null };
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_A', true)).toBe(false);
    a.analyticsConsent('granted');
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_A', true)).toBe(false);
    expect(a.chatReopenedAnalytics(loadedSession, 'SECRET_B', true)).toBe(true);
    expect(b.commands().filter((args: any[]) => args[0] === 'event').map((args: any[]) => args[1])).toEqual(['chat_reopened']);
    expect(JSON.stringify(b.commands())).not.toContain('SECRET');
  });

  it('blocks developer builds and the Local app host', async () => {
    const b = browser('https://app.kyalulu.com/'); b.seed(COOKIE, 'granted'); const { mode, a } = await app(); mode.setCloud(true); await Promise.resolve();
    expect(a.syncAppAnalytics()).toBe(false); expect(a.appAnalyticsPageView('/')).toBe(false);
    b.window.location = new URL('https://cloud.kyalulu.com/'); vi.stubEnv('PROD', false); vi.stubEnv('DEV', true);
    expect(a.syncAppAnalytics()).toBe(false); expect(b.scripts).toHaveLength(0);
  });
});
