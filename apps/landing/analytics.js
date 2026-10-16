import { initAnalytics, analyticsConsent, analyticsEvent, subscribeAnalyticsConsent } from './analytics-core.js';

const language = document.documentElement.lang === 'en' ? 'en' : 'ja';
const ja = language === 'ja';
const measurementId = document.querySelector('meta[name="kyalulu-ga4"]')?.content || '';
const kind = location.pathname.startsWith('/docs/') ? 'docs' : 'landing';
if (initAnalytics({ measurementId, language })) {
  const panel = document.createElement('section');
  panel.className = 'analytics-consent';
  panel.setAttribute('aria-label', ja ? '規約・プライバシー設定' : 'Terms and privacy settings');
  panel.innerHTML = `<p>${ja ? '規約・プライバシー設定' : 'Terms and privacy settings'}</p><p>${ja ? '同意するとGoogle Analyticsへ画面の種類・言語・利用成功のイベントを送ります。GoogleはCookieの仮名IDや端末情報を処理します。会話・記憶・メール・アプリの個人IDは送りません。拒否・撤回しても利用できます。' : 'With your consent, Google Analytics receives page categories, language and successful-use events, and processes pseudonymous cookie IDs and device information. Conversations, memory, email and personal IDs from the app are excluded. You can decline or withdraw consent.'}</p><a href="${ja ? '/docs/privacy/#website-analytics' : '/docs/en/privacy/#website-analytics'}">${ja ? '詳しいデータの説明' : 'Data details'}</a><div><button type="button" data-deny>${ja ? '解析を無効にする' : 'Disable analytics'}</button><button type="button" data-accept>${ja ? '規約・プライバシーに同意して解析を有効にする' : 'Agree to terms and privacy and enable analytics'}</button></div>`;
  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'analytics-settings';
  settings.textContent = ja ? '規約・プライバシー設定' : 'Terms and privacy settings';
  settings.hidden = true;
  let recorded = false;
  const recordPage = () => {
    if (recorded || !analyticsEvent('page_view', { page_kind: kind, language })) return;
    recorded = true;
    if (/^\/docs\/(en\/)?quickstart\/$/.test(location.pathname)) analyticsEvent('local_install_guide_open', { page_kind: 'docs', language });
  };
  const update = () => { panel.hidden = true; settings.hidden = false; };
  panel.querySelector('[data-deny]').addEventListener('click', () => { analyticsConsent('denied'); settings.focus(); });
  panel.querySelector('[data-accept]').addEventListener('click', () => {
    if (analyticsConsent('granted') === 'granted') recordPage();
    settings.focus();
  });
  settings.addEventListener('click', () => { panel.hidden = false; settings.hidden = true; panel.querySelector('[data-deny]').focus(); });
  subscribeAnalyticsConsent(update);
  document.body.append(panel, settings);
  update(analyticsConsent());
  recordPage();
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    const target = new URL(anchor.href);
    if (target.origin === 'https://cloud.kyalulu.com' && target.pathname === '/' && !target.search && ['', '#/', '#/discover'].includes(target.hash)) analyticsEvent('cloud_open', { page_kind: kind, language });
  });
}
