import { useEffect, useRef, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { operatorDisclosure, understoodDisclosure, type OperatorRoute } from '../lib/cloudDisclosure';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import './cloudLogin.css';
import { useNavigate } from 'react-router-dom';
import { clearLoginReturn, rememberLoginReturn } from '../lib/cloudGuest';
import { analyticsConsent } from '../lib/analytics';

export default function CloudLogin({ returnTo = '/' }: { returnTo?: string }) {
  const navigate = useNavigate();
  const [email,setEmail] = useState(''), [consent,setConsent] = useState(false);
  const [country,setCountry] = useState('');
  const [analyticsEnabled,setAnalyticsEnabled] = useState(() => analyticsConsent() !== 'denied');
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const [provider,setProvider] = useState<string|null>(null);
  const [operatorRoute,setOperatorRoute] = useState<OperatorRoute|null>(null);
  const [providerVersion,setProviderVersion] = useState<string|null>(null);
  const [ready,setReady] = useState(false), [loading,setLoading] = useState(true), [privateTest,setPrivateTest] = useState(false);
  const [retry,setRetry] = useState(0);
  const disclosure = useRef<string|null>(null);
  const { explanation, destination } = operatorDisclosure(operatorRoute);

  useEffect(()=>{
    let active=true;
    setLoading(true);setReady(false);
    const refresh=()=>setRetry(value=>value+1);
    window.addEventListener('online',refresh);
    window.addEventListener('focus',refresh);
    const params=new URLSearchParams(location.hash.split('?')[1] || '');
    const error=params.get('login_error');
    if(error) setMessage(friendlyMessage(error));
    void cloudJson('status').then(status=>{
      const backend=status.operator_route?.provider;
      const version=understoodDisclosure(backend,status.provider_consent_version,status.operator_route);
      if(!version) throw Error('接続先の説明が更新されています。画面を再読み込みしてください。');
      operatorDisclosure(status.operator_route);
      const receipt = JSON.stringify([version, status.operator_route]);
      if(active) {
        if(disclosure.current!==receipt) setConsent(false);
        disclosure.current=receipt;
        setOperatorRoute(status.operator_route);
        setProvider(backend);setProviderVersion(version);setReady(status.login_available===true);setPrivateTest(status.private_test===true);
        if(!error) setMessage('');
      }
    }).catch(error=>{if(active)setMessage(error instanceof Error?error.message:'ログイン画面を取得できませんでした。');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
  },[retry]);

  async function login(authProvider?: string) {
    if(busy || !ready || !consent || !country) return;
    setBusy(true);setMessage('');
    rememberLoginReturn(returnTo);
    try {
      const result=await cloudJson('auth/login',{method:'POST',body:JSON.stringify({provider:authProvider,email,consent,country,eligibility_ticket:localStorage.getItem('kyalulu-eligibility-ticket'),
        operator_backend:provider,provider_consent_version:providerVersion,provider_disclosure_version:providerVersion})});
      analyticsConsent(analyticsEnabled ? 'granted' : 'denied');
      if(result.url) location.assign(result.url);
      else setMessage('確認メールを送りました。このブラウザでリンクを開いてください。');
    } catch(error) {setMessage(error instanceof Error?error.message:'ログインできませんでした。');}
    finally {setBusy(false);}
  }
  const disabled=busy || !ready || !provider || !providerVersion || !consent || !country;
  return <main className="k-connect-screen k-cloud-login"><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div>
    <h1>キャラクターと、記憶や世界を持ち続ける。</h1>
    <h2>ログイン / 新規登録</h2>
    <p>ホーム・キャラクター・公開作品はログインなしで閲覧できます。Cloudでの会話と保存にはログインが必要です。</p>
    <Button variant="secondary" disabled={busy} onClick={() => { clearLoginReturn(); navigate('/', { replace: true }); }}>ログインせずに見てみる</Button>
    <p>初めてログインするとアカウントを作成します。会話・キャラクター・記憶はアカウントごとに保存します。</p>
    <p className="k-cloud-login__destination">{explanation}クラウドはSFWのみです。</p>
    {privateTest&&<p>招待したアカウントのみ利用できるテスト版です。サブスクや追加購入はありません。</p>}
    {loading?<p role="status">ログインの状態を確認しています…</p>:!ready&&<p role="status">この環境のログインは準備中です。</p>}
    <form className="k-connection__form" onSubmit={e=>{e.preventDefault();void login();}}>
      <label>居住国<select aria-label="居住国" value={country} onChange={e=>{setCountry(e.target.value);setConsent(false);}} required>
        <option value="">選択してください</option><option value="JP">日本</option><option value="US">米国</option>
      </select></label>
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />
        利用条件を含む規約・プライバシーポリシーと、{destination}へのデータ送信に同意します
      </label>
      <p><a href="/legal/terms.html" target="_blank" rel="noreferrer">規約</a> · <a href="/legal/privacy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>{privateTest?'（公開前ドラフト）':''}</p>
      <label><input type="checkbox" checked={analyticsEnabled} onChange={e=>{setAnalyticsEnabled(e.target.checked);if(!e.target.checked) analyticsConsent('denied');}} />
        利用状況の解析を有効にする（任意・標準で有効）
      </label>
      <p>規約への同意後だけGoogle Analyticsへ画面の種類・言語・成功イベントを送ります。会話本文・記憶・メールは送りません。無効でも利用でき、プロフィールの規約・プライバシー設定から撤回できます。</p>
      <Button type="button" disabled={disabled} onClick={()=>void login('google')}>{busy?'ログインを準備しています…':'Googleで始める'}</Button>
      <p>または、メールでログイン</p>
      <label>メールアドレス<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254} /></label>
      <Button type="submit" disabled={disabled}>メールリンクを送る</Button>
    </form>
    {message&&<p role="status" aria-live="polite">{message}</p>}
    {!loading&&!ready&&<Button variant="secondary" disabled={busy} onClick={()=>setRetry(value=>value+1)}>ログイン状態を再確認</Button>}
    <p>無料Coreはローカル／BYOKで利用できます。クラウドアカウントやK-Creditsは不要です。</p>
  </div></main>;
}
