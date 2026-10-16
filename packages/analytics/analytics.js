// This file is also copied unchanged into the public static site.
const COOKIE = 'kyalulu_analytics_consent';
const MAX_AGE = 180 * 24 * 60 * 60;
const EVENTS = new Set(['page_view', 'local_install_guide_open', 'cloud_open', 'login', 'chat_completed', 'chat_reopened']);
const KINDS = new Set(['landing', 'docs', 'cloud', 'home', 'discover', 'chats', 'chat', 'character', 'work', 'author', 'create', 'profile', 'other']);
const DOCS = new Set(['overview', 'quickstart', 'models', 'characters', 'memory', 'worlds', 'privacy', 'imports', 'compatibility', 'mobile', 'remote', 'development', 'characterbench', 'troubleshooting', 'faq', 'release-status', 'cloud']);
const CAMPAIGNS = {
  utm_source: ['campaign_source', new Set(['chatgpt', 'perplexity', 'claude', 'google', 'bing', 'reddit', 'x', 'github'])],
  utm_medium: ['campaign_medium', new Set(['referral', 'organic', 'social'])],
  utm_campaign: ['campaign_name', new Set(['docs', 'cloud-beta', 'seo-aeo-20261012'])],
};
const listeners = new Set();
let options = { measurementId: '', language: 'ja', cloud: false };
let consent = null;
let volatileConsent;
let script;
let configured = '';
let watching = false;
let failed = false;

function publicHost() {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' &&
    (!window.location.port || window.location.port === '443') &&
    (window.location.hostname === 'kyalulu.com' || (window.location.hostname === 'cloud.kyalulu.com' && options.cloud === true));
}

function enabled() {
  return publicHost() && /^G-[A-Z0-9]{4,20}$/.test(options.measurementId);
}

function readConsent() {
  if (!publicHost()) return null;
  try {
    const values = document.cookie.split(';').map(part => part.trim()).filter(part => part.startsWith(COOKIE + '='));
    // Conflicting host/path cookies cannot grant consent.
    if (values.some(value => value === COOKIE + '=denied')) return 'denied';
    if (volatileConsent !== undefined) return volatileConsent;
    return values.length === 1 && values[0] === COOKIE + '=granted' ? 'granted' : null;
  } catch { return volatileConsent ?? null; }
}

function removeGaCookies() {
  const paths = new Set(['/']);
  const parts = window.location.pathname.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/') || '/';
    if (!/[;\r\n]/.test(path)) { paths.add(path); paths.add(path.endsWith('/') ? path : path + '/'); }
  }
  const domains = new Set(['', window.location.hostname, '.' + window.location.hostname, 'kyalulu.com', '.kyalulu.com']);
  let names = [];
  try { names = document.cookie.split(';').map(part => part.trim().split('=')[0]).filter(name => /^_ga(?:_[A-Za-z0-9_]+)?$/.test(name)); } catch { return; }
  for (const name of names) for (const path of paths) for (const domain of domains) {
    try { document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=${path};${domain ? ' Domain=' + domain + ';' : ''} Secure; SameSite=Lax`; } catch { /* Storage can be disabled. */ }
  }
}

function stop() {
  if (options.measurementId) window['ga-disable-' + options.measurementId] = true;
  // Drop commands awaiting the script; never replay pre-consent or revoked events.
  if (script && Array.isArray(window.dataLayer)) window.dataLayer.length = 0;
  configured = '';
  if (publicHost()) removeGaCookies();
}

function metadata(pageKind, language) {
  let pageLocation = 'https://cloud.kyalulu.com/';
  if (window.location.hostname === 'kyalulu.com') {
    pageLocation = 'https://kyalulu.com/' + (language === 'en' ? 'en/' : '');
    const match = /^\/docs\/(en\/)?(?:([a-z-]+)\/?)?(?:index\.html)?$/.exec(window.location.pathname);
    if (match && (!match[2] || DOCS.has(match[2]))) {
      pageLocation = 'https://kyalulu.com/docs/' + (match[1] || '') + (match[2] ? match[2] + '/' : '');
    } else if (window.location.pathname.startsWith('/docs/')) pageLocation = 'https://kyalulu.com/docs/';
  }
  let pageReferrer = '';
  try {
    const referrer = new URL(document.referrer);
    if (['http:', 'https:'].includes(referrer.protocol) && !referrer.username && !referrer.password) pageReferrer = referrer.origin;
  } catch { /* Empty and invalid referrers are omitted. */ }
  const campaign = {};
  const query = new URLSearchParams(window.location.search);
  for (const [parameter, [key, values]] of Object.entries(CAMPAIGNS)) {
    const entries = query.getAll(parameter);
    if (entries.length === 1 && values.has(entries[0])) campaign[key] = entries[0];
  }
  return { page_kind: pageKind, language, page_location: pageLocation, page_title: 'Kyalulu | ' + pageKind, page_referrer: pageReferrer, ...campaign };
}

function command(...args) { window.gtag(...args); }

function start() {
  if (!enabled() || consent !== 'granted' || failed) return;
  window['ga-disable-' + options.measurementId] = false;
  if (!script) {
    window.dataLayer = [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + options.measurementId;
    // Do not send the actual private document URL as the script request's referrer.
    script.referrerPolicy = 'no-referrer';
    script.onload = () => { try { if (analyticsConsent() !== 'granted' || !enabled()) stop(); } catch { /* Analytics is optional. */ } };
    script.onerror = () => { failed = true; try { stop(); } catch { /* Analytics is optional. */ } };
    command('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    document.head.appendChild(script);
  }
  const key = options.measurementId + ':' + options.language;
  if (configured === key) return;
  command('consent', 'update', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  // Revocation can have cleared the bootstrap while the script was still loading.
  command('js', new Date());
  command('config', options.measurementId, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    cookie_domain: 'kyalulu.com', cookie_path: '/', cookie_expires: MAX_AGE, cookie_flags: 'SameSite=Lax;Secure',
    ...metadata(window.location.hostname === 'cloud.kyalulu.com' ? 'cloud' : 'landing', options.language),
  });
  configured = key;
}

function refresh() {
  const next = readConsent();
  const changed = next !== consent;
  consent = next;
  if (consent !== 'granted' || !enabled()) stop();
  else { try { start(); } catch { failed = true; stop(); } }
  if (changed) for (const listener of listeners) {
    try { listener(consent); } catch { /* A subscriber cannot break the application. */ }
  }
  return consent;
}

/** Cloud callers must pass their verified runtime mode, not infer it from a URL. */
export function initAnalytics({ measurementId = '', language = 'ja', cloud = false } = {}) {
  try {
    if (options.measurementId && options.measurementId !== measurementId) stop();
    options = { measurementId: typeof measurementId === 'string' ? measurementId.trim() : '', language: language === 'en' ? 'en' : 'ja', cloud: cloud === true };
    if (!watching && typeof window !== 'undefined') {
      const sync = () => { try { refresh(); } catch { /* Analytics is optional. */ } };
      window.addEventListener('focus', sync);
      document.addEventListener('visibilitychange', sync);
      watching = true;
    }
    refresh();
    return enabled();
  } catch { try { stop(); } catch { /* No browser or blocked GA. */ } return false; }
}

/** Getter: null | 'granted' | 'denied'. Setter: explicit 'granted' or 'denied'. */
export function analyticsConsent(value) {
  try {
    if ((value === 'granted' || value === 'denied') && publicHost()) {
      volatileConsent = value;
      try {
        document.cookie = `${COOKIE}=${value}; Path=/; Domain=kyalulu.com; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`;
        if (document.cookie.split(';').some(part => part.trim() === COOKIE + '=' + value)) volatileConsent = undefined;
      } catch { /* Explicit consent applies only to this document when storage is denied. */ }
    }
    return refresh();
  } catch { try { stop(); } catch { /* Analytics is optional. */ } return null; }
}

export function subscribeAnalyticsConsent(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Only these two categorical properties can be supplied by callers. */
export function analyticsEvent(name, props = {}) {
  try {
    if (!EVENTS.has(name) || !enabled() || analyticsConsent() !== 'granted' || !configured) return false;
    const kind = KINDS.has(props.page_kind) ? props.page_kind : window.location.hostname === 'cloud.kyalulu.com' ? 'cloud' : window.location.pathname.startsWith('/docs/') ? 'docs' : 'landing';
    const language = props.language === 'en' || props.language === 'ja' ? props.language : options.language;
    command('event', name, { ...metadata(kind, language), send_to: options.measurementId });
    return true;
  } catch { return false; }
}
