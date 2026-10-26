import { useEffect, useRef, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { operatorDisclosure, understoodDisclosure, type OperatorRoute } from '../lib/cloudDisclosure';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import './cloudLogin.css';
import { useNavigate } from 'react-router-dom';
import { clearLoginReturn, rememberLoginReturn } from '../lib/cloudGuest';
import { analyticsConsent } from '../lib/analytics';
import { preferences, savePreferences, useLanguage } from '../lib/appContext';

export default function CloudLogin({ returnTo = '/' }: { returnTo?: string }) {
  const navigate = useNavigate();
  const language=useLanguage(),en=language==='en';
  const [email,setEmail] = useState(''), [consent,setConsent] = useState(false);
  const [country,setCountry] = useState('');
  const [analyticsEnabled,setAnalyticsEnabled] = useState(() => analyticsConsent() !== 'denied');
  const [busy,setBusy] = useState(false), [message,setMessage] = useState<null|'email'|'disclosure'|{cause:unknown}>(null);
  const [provider,setProvider] = useState<string|null>(null);
  const [operatorRoute,setOperatorRoute] = useState<OperatorRoute|null>(null);
  const [providerVersion,setProviderVersion] = useState<string|null>(null);
  const [ready,setReady] = useState(false), [loading,setLoading] = useState(true), [privateTest,setPrivateTest] = useState(false);
  const [retry,setRetry] = useState(0);
  const disclosure = useRef<string|null>(null);
  const mounted=useRef(false),analyticsChoice=useRef(analyticsEnabled);
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
    const params=new URLSearchParams(location.hash.split('?')[1] || '');
    const error=params.get('login_error');
    if(error) setMessage({cause:error});
    void cloudJson('status').then(status=>{
      const backend=status.operator_route?.provider;
      const version=understoodDisclosure(backend,status.provider_consent_version,status.operator_route);
      if(!version){if(active){setMessage('disclosure');setConsent(false);setOperatorRoute(null);setProvider(null);setProviderVersion(null);disclosure.current=null;}return;}
      operatorDisclosure(status.operator_route);
      const receipt = JSON.stringify([version, status.operator_route]);
      if(active) {
        if(disclosure.current!==receipt) setConsent(false);
        disclosure.current=receipt;
        setOperatorRoute(status.operator_route);
        setProvider(backend);setProviderVersion(version);setReady(status.login_available===true);setPrivateTest(status.private_test===true);
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
      const result=await cloudJson('auth/login',{method:'POST',body:JSON.stringify({provider:authProvider,email,consent,country,eligibility_ticket:localStorage.getItem('kyalulu-eligibility-ticket'),
        operator_backend:provider,provider_consent_version:providerVersion,provider_disclosure_version:providerVersion})});
      if(!mounted.current)return;
      analyticsConsent(analyticsChoice.current ? 'granted' : 'denied');
      if(result.url) location.assign(result.url);
      else setMessage('email');
    } catch(error) {if(mounted.current)setMessage({cause:error});}
    finally {if(mounted.current)setBusy(false);}
  }
  const disabled=busy || !ready || !provider || !providerVersion || !consent || !country;
  const cause=message&&typeof message==='object'?message.cause:null;
  const detail=cause&&typeof cause==='object'&&'code' in cause&&typeof cause.code==='string'?cause.code:cause;
  const notice=message==='email'?(en?'A sign-in email was sent. Open its link in this browser.':'確認メールを送りました。このブラウザでリンクを開いてください。'):message==='disclosure'?(en?'The provider disclosure has changed. Reload the login status to review the current details.':'接続先の説明が更新されています。ログイン状態を再確認し、現在の内容を確認してください。'):message?friendlyMessage(detail,language):'';
  return <main className="k-connect-screen k-cloud-login" lang={language}><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div>
    <label className="k-cloud-login__language">{en?'Language':'表示言語'}<select aria-label={en?'Language':'表示言語'} value={language} onChange={e=>savePreferences({...preferences(),language:e.target.value as 'ja'|'en'})}><option value="ja">日本語</option><option value="en">English</option></select></label>
    <h1>{en?'Keep sharing memories and worlds with your characters.':'キャラクターと、記憶や世界を持ち続ける。'}</h1>
    <h2>{en?'Sign in / Create an account':'ログイン / 新規登録'}</h2>
    <p>{en?'Browse Home, characters and public works without signing in. Cloud conversations and storage require an account.':'ホーム・キャラクター・公開作品はログインなしで閲覧できます。Cloudでの会話と保存にはログインが必要です。'}</p>
    <Button variant="secondary" disabled={busy} onClick={() => { clearLoginReturn(); navigate('/', { replace: true }); }}>{en?'Browse without signing in':'ログインせずに見てみる'}</Button>
    <p>{en?'Your first sign-in creates an account. Conversations, characters and memories are stored separately for each account.':'初めてログインするとアカウントを作成します。会話・キャラクター・記憶はアカウントごとに保存します。'}</p>
    <p className="k-cloud-login__destination">{explanation}{en?' Cloud supports general-audience content only.':'クラウドはSFWのみです。'}</p>
    {privateTest&&<p>{en?'This test is available only to invited accounts. Subscriptions and top-ups are unavailable.':'招待したアカウントのみ利用できるテスト版です。サブスクや追加購入はありません。'}</p>}
    {loading?<p role="status">{en?'Checking sign-in availability…':'ログインの状態を確認しています…'}</p>:!ready&&<p role="status">{en?'Sign-in is not available in this environment yet.':'この環境のログインは準備中です。'}</p>}
    <form className="k-connection__form" onSubmit={e=>{e.preventDefault();void login();}}>
      <label>{en?'Country of residence':'居住国'}<select aria-label={en?'Country of residence':'居住国'} disabled={busy} value={country} onChange={e=>{setCountry(e.target.value);setConsent(false);}} required>
        <option value="">{en?'Select your country':'選択してください'}</option><option value="JP">{en?'Japan':'日本'}</option><option value="US">{en?'United States':'米国'}</option>
      </select></label>
      <label><input type="checkbox" disabled={busy||loading||!ready||!providerVersion} checked={consent} onChange={e=>setConsent(e.target.checked)} />
        {en?`I agree to the terms, privacy policy and eligibility conditions, and to sending data to ${destination}.`:`利用条件を含む規約・プライバシーポリシーと、${destination}へのデータ送信に同意します`}
      </label>
      <p><a href="/legal/terms.html" target="_blank" rel="noreferrer">{en?'Terms':'規約'}</a> · <a href="/legal/privacy.html" target="_blank" rel="noreferrer">{en?'Privacy policy':'プライバシーポリシー'}</a>{privateTest?(en?' (pre-release drafts)':'（公開前ドラフト）'):''}</p>
      <label><input type="checkbox" checked={analyticsEnabled} onChange={e=>{analyticsChoice.current=e.target.checked;setAnalyticsEnabled(e.target.checked);if(!e.target.checked) analyticsConsent('denied');}} />
        {en?'Enable usage analytics (optional, on by default)':'利用状況の解析を有効にする（任意・標準で有効）'}
      </label>
      <p>{en?'Only after terms consent, Google Analytics receives screen categories, language and success events. Conversation text, memories and email addresses are not sent. Analytics is optional and can be revoked from the terms and privacy settings in your profile.':'規約への同意後だけGoogle Analyticsへ画面の種類・言語・成功イベントを送ります。会話本文・記憶・メールは送りません。無効でも利用でき、プロフィールの規約・プライバシー設定から撤回できます。'}</p>
      <Button type="button" disabled={disabled} onClick={()=>void login('google')}>{busy?(en?'Preparing sign-in…':'ログインを準備しています…'):(en?'Continue with Google':'Googleで始める')}</Button>
      <p>{en?'Or sign in with email':'または、メールでログイン'}</p>
      <label>{en?'Email address':'メールアドレス'}<input type="email" disabled={busy} value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254} /></label>
      <Button type="submit" disabled={disabled}>{en?'Send sign-in link':'メールリンクを送る'}</Button>
    </form>
    {notice&&<p role="status" aria-live="polite">{notice}</p>}
    {!loading&&!ready&&<Button variant="secondary" disabled={busy} onClick={()=>setRetry(value=>value+1)}>{en?'Check sign-in status again':'ログイン状態を再確認'}</Button>}
    <p>{en?'Free Core supports local models and your own API key (BYOK). No Cloud account or K-Credits are required.':'無料Coreはローカル／BYOKで利用できます。クラウドアカウントやK-Creditsは不要です。'}</p>
  </div></main>;
}
