import { useEffect, useRef, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { understoodDisclosure } from '../lib/cloudDisclosure';
import { friendlyMessage } from '../lib/errors';
import Button from './ui/Button';
import './cloudLogin.css';

export default function CloudLogin() {
  const [email,setEmail] = useState(''), [consent,setConsent] = useState(false), [adult,setAdult] = useState(false);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const [provider,setProvider] = useState<string|null>(null);
  const [providerVersion,setProviderVersion] = useState<string|null>(null);
  const [ready,setReady] = useState(false), [loading,setLoading] = useState(true), [privateTest,setPrivateTest] = useState(false);
  const [retry,setRetry] = useState(0);
  const disclosure = useRef<string|null>(null);
  const explanation = provider==='openrouter'
    ? '生成と安全検査はOpenRouter経由でInferenceNetが提供するDeepSeek V4.1 Flashを使用します。別のモデルや提供元へは自動転送しません。'
    : provider==='opencode-go'
      ? 'OpenCode Go経由のMiMo／DeepSeekを使用します。Muse Contributorは学習利用への別の同意が必要で、自動では使用しません。'
      : '生成と安全検査にはDeepSeek V4.1 Flashを使用します。';
  const destination = provider==='openrouter'?'OpenRouter／InferenceNet経由のDeepSeek':provider==='opencode-go'?'OpenCode Go経由のDeepSeek／MiMo':'DeepSeek';

  useEffect(()=>{
    let active=true;
    setLoading(true);setReady(false);
    const refresh=()=>setRetry(value=>value+1);
    window.addEventListener('online',refresh);
    window.addEventListener('focus',refresh);
    const params=new URLSearchParams(location.hash.split('?')[1] || '');
    const error=params.get('login_error');
    if(error) {setMessage(friendlyMessage(error));history.replaceState(null,'',location.pathname+'#/');}
    void cloudJson('status').then(status=>{
      const backend=status.operator_route?.provider;
      const version=understoodDisclosure(backend,status.provider_consent_version);
      if(!version) throw Error('接続先の説明が更新されています。画面を再読み込みしてください。');
      if(active) {
        if(disclosure.current!==version) setConsent(false);
        disclosure.current=version;
        setProvider(backend);setProviderVersion(version);setReady(status.login_available===true);setPrivateTest(status.private_test===true);
        if(!error) setMessage('');
      }
    }).catch(error=>{if(active)setMessage(error instanceof Error?error.message:'ログイン画面を取得できませんでした。');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);};
  },[retry]);

  async function login(authProvider?: string) {
    if(busy || !ready || !consent || !adult) return;
    setBusy(true);setMessage('');
    try {
      const result=await cloudJson('auth/login',{method:'POST',body:JSON.stringify({provider:authProvider,email,consent,adult,
        operator_backend:provider,provider_consent_version:providerVersion,provider_disclosure_version:providerVersion})});
      if(result.url) location.assign(result.url);
      else setMessage('確認メールを送りました。このブラウザでリンクを開いてください。');
    } catch(error) {setMessage(error instanceof Error?error.message:'ログインできませんでした。');}
    finally {setBusy(false);}
  }
  const disabled=busy || !ready || !provider || !providerVersion || !consent || !adult;
  return <main className="k-connect-screen k-cloud-login"><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div>
    <h1>キャラクターと、記憶や世界を持ち続ける。</h1>
    <h2>ログイン / 新規登録</h2>
    <p>初めてログインするとアカウントを作成します。会話・キャラクター・記憶はアカウントごとに保存します。</p>
    <p className="k-cloud-login__destination">{explanation}クラウドはSFWのみです。</p>
    {privateTest&&<p>招待したアカウントのみ利用できるテスト版です。サブスクや追加購入はありません。</p>}
    {loading?<p role="status">ログインの状態を確認しています…</p>:!ready&&<p role="status">この環境のログインは準備中です。</p>}
    <form className="k-connection__form" onSubmit={e=>{e.preventDefault();void login();}}>
      <label><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)} />18歳以上です</label>
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />
        {privateTest?'テスト版での保存と':'規約・プライバシーポリシーと'}{destination}へのデータ送信に同意します
      </label>
      <p><a href="/legal/terms.html" target="_blank" rel="noreferrer">規約</a> · <a href="/legal/privacy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>{privateTest?'（公開前ドラフト）':''}</p>
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
