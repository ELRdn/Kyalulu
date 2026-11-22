import { useEffect, useState } from 'react';
import { QuoteConsent, type PendingQuote } from '../lib/quoteConsent';
import Button from './ui/Button';
import './cloudQuoteConfirmation.css';
import { useLanguage } from '../lib/appContext';

export function useQuoteConfirmation() {
  const [quote, setQuote] = useState<PendingQuote | null>(null);
  const [consent] = useState(() => new QuoteConsent(setQuote));
  useEffect(() => () => consent.cancel(), [consent]);
  return { quote, consent };
}

export default function CloudQuoteConfirmation({ quote, onAccept, onCancel, onProviderTrainingConsentChange }: {
  quote: PendingQuote; onAccept: () => void; onCancel: () => void;
  onProviderTrainingConsentChange?: (checked: boolean) => void;
}) {
  const language = useLanguage(), en = language === 'en';
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000)));
    const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((quote.expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [quote.expiresAt]);
  const disabled = remaining === 0 || quote.providerTrainingConsent !== true;
  return <section className="k-quote" aria-label={en ? 'Review quote before sending' : '送信前の見積確認'}>
    <span className="k-quote__handle" aria-hidden="true" />
    <h2>{en ? 'Review before sending' : '送信前の確認'}</h2>
    <dl className="k-quote__rows">
      <div><dt>{en ? 'Destination' : '送信先'}</dt><dd>{quote.route.display_name} · {quote.route.upstream || quote.route.provider}{quote.route.upstream && (en ? ` (via ${quote.route.provider})` : `（${quote.route.provider}経由）`)}</dd></div>
      <div><dt>{en ? 'Limit' : '上限'}</dt><dd>{quote.max_credits.toLocaleString(language)} K-Credits</dd></div>
      <div><dt>{en ? 'Settlement' : '精算'}</dt><dd>{en ? 'Actual cost after completion. 0 if it fails' : '完了後に実費。失敗時は0'}</dd></div>
    </dl>
    <p>{quote.route.privacy_note || (en ? 'Baidu may retain conversations, settings, memories and generated results and use them to train or improve AI.' : 'Baiduは会話・設定・記憶・生成結果を保存し、AIの学習・改善に利用する可能性があります。')}</p>
    <label className="k-quote__consent">
      <input type="checkbox" aria-label={en ? 'I agree that Baidu may retain conversations, settings, memories and generated results and use them to train or improve AI' : 'Baiduが会話・設定・記憶・生成結果を保存し、AIの学習・改善に利用する可能性に同意します'}
        checked={quote.providerTrainingConsent === true}
        onChange={event => onProviderTrainingConsentChange?.(event.target.checked)} />
      <span>{en ? 'Agree to Baidu storage and training use' : 'Baiduの保存・学習利用に同意する'}</span>
    </label>
    <div className="k-quote__actions">
      <Button variant="secondary" onClick={onCancel}>{en ? 'Cancel' : 'キャンセル'}</Button>
      <Button disabled={disabled} onClick={() => { if (!disabled) onAccept(); }}>{en ? 'Send' : '送信する'}</Button>
    </div>
    <p className="k-quote__expires" role={remaining === 0 ? 'status' : undefined}>{remaining === 0 ? (en ? 'This quote expired. Cancel and send again to request a new quote.' : '待たせすぎちゃったみたい…キャンセルして、もう一度送ってね。期限が切れたので、料金はかかっていません。') : `${en ? 'Valid for ' : '有効期間：残り '}${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}</p>
  </section>;
}
