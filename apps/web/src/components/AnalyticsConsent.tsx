import { useState } from 'react';
import { analyticsConsent } from '../lib/analytics';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import './AnalyticsConsent.css';

const copy = {
  ja: { title: 'アクセス解析の設定', description: '同意した場合だけGoogle Analyticsを使い、画面の分類・言語・ログインや会話完了などの成功イベントをGoogleに送信します。GAは仮名のクライアントIDを含むCookieを使います。会話本文・キャラクター情報・アプリの個人IDは送信しません。拒否してもすべての機能を利用でき、同意はいつでも撤回できます。',
    accept: '規約・プライバシーに同意して解析を有効にする', deny: '解析を無効にする', change: '規約・プライバシー設定', close: '閉じる', details: 'アクセス解析の詳細', provider: 'Googleのプライバシーポリシー' },
  en: { title: 'Analytics preferences', description: 'Only with your consent, Google Analytics receives screen categories, language, and success events such as login or chat completion. GA uses cookies containing a pseudonymous client ID. We do not send conversation content, character information, or personal IDs from the app. All features work if you decline, and you can withdraw consent at any time.',
    accept: 'Agree to terms and privacy and enable analytics', deny: 'Disable analytics', change: 'Terms and privacy settings', close: 'Close', details: 'Website analytics details', provider: 'Google privacy policy' },
};

export function AnalyticsConsentChoices({ language, onChoose }: { language: 'ja' | 'en'; onChoose: (value: 'granted' | 'denied') => void }) {
  const text = copy[language];
  return <>
    <h2 id="analytics-consent-title">{text.title}</h2>
    <p>{text.description}</p>
    <p><a href={`/legal/${language === 'en' ? 'en/' : ''}terms.html`} target="_blank" rel="noreferrer">{language === 'en' ? 'Terms of service' : '利用規約'}</a>
      {' · '}<a href={`/legal/${language === 'en' ? 'en/' : ''}privacy.html`} target="_blank" rel="noreferrer">{language === 'en' ? 'Privacy policy' : 'プライバシーポリシー'}</a></p>
    <p><a href={`https://kyalulu.com/docs/${language === 'en' ? 'en/' : ''}privacy/#website-analytics`} target="_blank" rel="noreferrer">{text.details}</a>
      {' · '}<a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{text.provider}</a></p>
    <div className="k-analytics-consent__actions">
      <Button type="button" variant="secondary" onClick={() => onChoose('denied')}>{text.deny}</Button>
      <Button type="button" variant="secondary" onClick={() => onChoose('granted')}>{text.accept}</Button>
    </div>
  </>;
}

export default function AnalyticsConsent({ enabled, language }: { enabled: boolean; language: 'ja' | 'en' }) {
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  const text = copy[language];
  const choose = (value: 'granted' | 'denied') => { analyticsConsent(value); setOpen(false); };
  return <>
    <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>{text.change}</Button>
    <Dialog open={open} onClose={() => setOpen(false)} labelledBy="analytics-consent-title">
      <AnalyticsConsentChoices language={language} onChoose={choose} />
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{text.close}</Button>
    </Dialog>
  </>;
}
