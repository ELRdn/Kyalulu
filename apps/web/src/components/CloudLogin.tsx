import { useEffect, useRef, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { operatorDisclosure, understoodDisclosure, type OperatorRoute } from '../lib/cloudDisclosure';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import './cloudLogin.css';
import { useNavigate } from 'react-router-dom';
import { clearLoginReturn, rememberLoginReturn } from '../lib/cloudGuest';
import { analyticsConsent } from '../lib/analytics';
import { isUnifiedEntry, preferences, savePreferences, useLanguage } from '../lib/appContext';
import Dialog from './ui/Dialog';

// EU/EEA, UK and Switzerland start with analytics off until consent (docs/MOBILE_UX_SPEC.md §3).
const ANALYTICS_OPT_IN = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(' '));
const localeRegion = () => { for (const tag of navigator.languages ?? []) { try { const region = new Intl.Locale(tag).maximize().region; if (region) return region; } catch { /* Ignore malformed tags. */ } } return ''; };

/** The one login entry (docs/MOBILE_UX_SPEC.md §3). With `onClose` it opens as a sheet over the current page. */
export default function CloudLogin({ returnTo = '/', characterName, onClose }: { returnTo?: string; characterName?: string; onClose?: () => void }) {
  const navigate = useNavigate();
  const language=useLanguage(),en=language==='en';
  const [email,setEmail] = useState(''), [consent,setConsent] = useState(false);
  const [country,setCountry] = useState(() => preferences().country || localeRegion());
  const [analyticsEnabled,setAnalyticsEnabled] = useState(() => analyticsConsent() !== 'denied');
  const [busy,setBusy] = useState(false), [message,setMessage] = useState<null|'email'|'disclosure'|{cause:unknown}>(null);
  const [provider,setProvider] = useState<string|null>(null);
  const [operatorRoute,setOperatorRoute] = useState<OperatorRoute|null>(null);
  const [providerVersion,setProviderVersion] = useState<string|null>(null);
  const [ready,setReady] = useState(false), [loading,setLoading] = useState(true), [privateTest,setPrivateTest] = useState(false);
  const [retry,setRetry] = useState(0);
  const [countries,setCountries] = useState<string[]>([]);
  const [age,setAge] = useState(() => preferences().age || 0);
  const disclosure = useRef<string|null>(null);
  const mounted=useRef(false),analyticsChoice=useRef(analyticsEnabled);
  const analyticsTouched = useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const { explanation, destination } = operatorRoute?operatorDisclosure(operatorRoute,language):{
    explanation:loading?(en?'Checking where Cloud sends your data.':'Cloudのデータ送信先を確認しています。'):(en?'Provider details are unavailable. Check the login status again.':'提供元の説明を確認できません。ログイン状態を再確認してください。'),
    destination:en?'the providers described above':'上に表示された提供元'};

  useEffect(()=>{
    let active=true;
    setLoading(true);setReady(false);
    const refresh=()=>setRetry(value=>value+1);
    window.addEventListener('online',refresh);
    window.addEventListener('focus',refresh);
    const params=new URLSearchParams(location.search || location.hash.split('?')[1] || '');
    const error=params.get('login_error');
    if(error) setMessage({cause:error});
    void cloudJson('status').then(status=>{
      const backend=status.operator_route?.provider;
      const version=understoodDisclosure(backend,status.provider_consent_version,status.operator_route);
      if(!version){if(active){setMessage('disclosure');setConsent(false);setCountries([]);setOperatorRoute(null);setProvider(null);setProviderVersion(null);disclosure.current=null;}return;}
      operatorDisclosure(status.operator_route);
      const offered=status.login_countries;
      const countries:string[]=Array.isArray(offered)&&offered.every(value=>typeof value==='string'&&/^[A-Z]{2}$/.test(value))&&new Set(offered).size===offered.length?offered:[];
      const receipt = JSON.stringify([version, status.operator_route, countries]);
      if(active) {
        if(disclosure.current!==receipt) setConsent(false);
        disclosure.current=receipt;
        setCountries(countries);setCountry(value=>countries.includes(value)?value:'');
        setOperatorRoute(status.operator_route);
        setProvider(backend);setProviderVersion(version);setReady(status.login_available===true&&countries.length>0);setPrivateTest(status.private_test===true);
        if(!error) setMessage(null);
      }
    }).catch(error=>{if(active)setMessage({cause:error});})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
  },[retry]);

  async function login(authProvider?: string) {
    if(disabled) return;
    setBusy(true);setMessage(null);
    rememberLoginReturn(returnTo);
    try {
      if(isUnifiedEntry()){
        const eligibility=await cloudJson('app/eligibility',{method:'POST',body:JSON.stringify({country,age})});
        if(typeof eligibility?.ticket!=='string'||eligibility.country!==country)throw Error('Invalid eligibility response');
        localStorage.setItem('kyalulu-eligibility-ticket',eligibility.ticket);
        savePreferences({...preferences(),country,age,accepted:true});
      }
      const result=await cloudJson('auth/login',{method:'POST',body:JSON.stringify({provider:authProvider,email,consent,country,eligibility_ticket:localStorage.getItem('kyalulu-eligibility-ticket'),
        operator_backend:provider,provider_consent_version:providerVersion,provider_disclosure_version:providerVersion})});
      if(!mounted.current)return;
      analyticsConsent(analyticsChoice.current ? 'granted' : 'denied');
      if(result.url) location.assign(result.url);
      else setMessage('email');
    } catch(error) {if(mounted.current)setMessage({cause:error});}
    finally {if(mounted.current)setBusy(false);}
  }
  const disabled=busy || !ready || !provider || !providerVersion || !consent || !countries.includes(country) || (isUnifiedEntry() && !(age>=13 && age<=120));
  const regionNames=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames([language],{type:'region'}):null;
  const cause=message&&typeof message==='object'?message.cause:null;
  const detail=cause&&typeof cause==='object'&&'code' in cause&&typeof cause.code==='string'?cause.code:cause;
  const notice=message==='email'?(en?'A sign-in email was sent. Open its link in this browser.':'メールを送ったよ。このブラウザでリンクを開いてね。届かないときは迷惑メールも確認してね'):message==='disclosure'?(en?'The provider disclosure has changed. Reload the login status to review the current details.':'接続先の説明が更新されています。ログイン状態を再確認し、現在の内容を確認してください。'):message?friendlyMessage(detail,language):'';
  const chooseCountry=(code:string)=>{setCountry(code);setConsent(false);if(!analyticsTouched.current){const on=analyticsConsent()!=='denied'&&!ANALYTICS_OPT_IN.has(code);analyticsChoice.current=on;setAnalyticsEnabled(on);}};
  useEffect(()=>{if(!analyticsTouched.current&&ANALYTICS_OPT_IN.has(country)){analyticsChoice.current=false;setAnalyticsEnabled(false);}},[country]);
  const body=<div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div>
    <h2 id="k-login-title">{characterName?(en?`Sign in to save your conversation with ${characterName}`:`${characterName}との会話を保存して続けよう`):(en?'Sign in to save your conversations':'ログインして会話を保存しよう')}</h2>
    <p>{en?'Your first sign-in creates an account.':'初めての方は、そのままアカウントを作成します。'}</p>
    {privateTest&&<p>{en?'This test is available only to invited accounts. Subscriptions and top-ups are unavailable.':'招待したアカウントのみ利用できるテスト版です。サブスクや追加購入はありません。'}</p>}
    {loading?<p role="status">{en?'Checking sign-in availability…':'ログインの状態を確認しています…'}</p>:!ready&&<p role="status">{en?'Sign-in is not available in this environment yet.':'この環境のログインは準備中です。'}</p>}
    <form className="k-connection__form" onSubmit={e=>{e.preventDefault();void login();}}>
      <div className="k-cloud-login__row">
        <label>{en?'Country / region':'地域'}<select aria-label={en?'Country / region':'地域'} disabled={busy} value={country} onChange={e=>chooseCountry(e.target.value)} required>
          <option value="">{en?'Select':'選択してください'}</option>{countries.map(code=><option key={code} value={code}>{regionNames?.of(code)||code}</option>)}
        </select></label>
        {isUnifiedEntry()&&<label>{en?'Age':'年齢'}<input type="number" inputMode="numeric" min={13} max={120} disabled={busy} value={age||''} onChange={e=>setAge(e.target.valueAsNumber||0)} required /></label>}
      </div>
      <label><input type="checkbox" disabled={busy||loading||!ready||!providerVersion} checked={consent} onChange={e=>setConsent(e.target.checked)} />
        <span>{en?<>I agree to the <a href="/legal/en/terms.html" target="_blank" rel="noreferrer">terms</a> and <a href="/legal/en/privacy.html" target="_blank" rel="noreferrer">privacy policy</a>, and to sending data to {destination}.</>:<><a href="/legal/terms.html" target="_blank" rel="noreferrer">規約</a>と<a href="/legal/privacy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>、{destination}へのデータ送信に同意します</>}</span>
      </label>
      <Button type="button" disabled={disabled} onClick={()=>void login('google')}>{busy?(en?'Preparing sign-in…':'ログインを準備しています…'):(en?'Continue with Google':'Googleで続ける')}</Button>
      <details className="k-cloud-login__email"><summary>{en?'Continue with email':'メールで続ける'}</summary>
        <label>{en?'Email address':'メールアドレス'}<input type="email" disabled={busy} value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254} /></label>
        <Button type="submit" disabled={disabled}>{en?'Send sign-in link':'ログインリンクを送る'}</Button>
      </details>
      <label><input type="checkbox" checked={analyticsEnabled} onChange={e=>{analyticsTouched.current=true;analyticsChoice.current=e.target.checked;setAnalyticsEnabled(e.target.checked);if(!e.target.checked) analyticsConsent('denied');}} />
        <span>{en?'Share usage analytics (optional). Conversation text, memories and email are never sent.':'利用状況の解析に協力する（任意）。会話本文・記憶・メールは送りません。'}</span>
      </label>
    </form>
    <p className="k-cloud-login__destination">{explanation}</p>
    {notice&&<p role="status" aria-live="polite">{notice}</p>}
    {!loading&&!ready&&<Button variant="secondary" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{en?'Check sign-in status again':'ログイン状態を再確認'}</Button>}
    {onClose?<Button variant="ghost" disabled={busy} onClick={onClose}>{en?'Not now':'あとで'}</Button>
      :<Button variant="ghost" disabled={busy} onClick={() => { clearLoginReturn(); navigate('/', { replace: true }); }}>{en?'Browse without signing in':'ログインせずに見てみる'}</Button>}
    <label className="k-cloud-login__language">{en?'Language':'表示言語'}<select aria-label={en?'Language':'表示言語'} value={language} onChange={e=>savePreferences({...preferences(),language:e.target.value as 'ja'|'en'})}><option value="ja">日本語</option><option value="en">English</option></select></label>
  </div>;
  return onClose
    ? <Dialog open onClose={onClose} labelledBy="k-login-title" overlayClassName="k-dialog-overlay k-cloud-login k-cloud-login--sheet" contentClassName="k-cloud-login__sheet">{body}</Dialog>
    : <main className="k-connect-screen k-cloud-login" lang={language}>{body}</main>;
}
