import { useEffect, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { refreshAccountProfile, useAccountProfile } from '../lib/accountProfile';
import { useLanguage } from '../lib/appContext';
import { useRuntimeAccess } from './RuntimeGate';
import { useConfirm } from './ui/Dialog';
import Button from './ui/Button';
import Icon from './ui/Icon';
import AnalyticsConsent from './AnalyticsConsent';
import RuntimeSyncSettings from './RuntimeSyncSettings';
import SyncDevices from './SyncDevices';
import { syncAppAnalytics } from '../lib/analytics';
import './cloudSettings.css';

type Plan = {id:string;monthly_usd:number;monthly_credits:number;storage_bytes:number};
type Account = {
  identity?:{id:string;email?:string};private_test?:boolean;unified_sync_available?:boolean;
  private_budget?:{limit_nano:number;prior_accounted_nano:number;available_nano:number};
  wallet:{credits:number;plan:string;used_credits?:number;
    usage?:{state:string;created:number;charged_credits:number;max_credits:number}[];
    lots:{remaining:number;expires:number;kind:string}[]};
  entitlements:Plan;plans:Plan[];storage_bytes:number;byok_configured:boolean;
  routes?:{provider:string;upstream?:string;display_name?:string;model?:string;available?:boolean;unavailable_reason?:string}[];
  sync:{mode:string};billing_available:boolean;billing_portal_available:boolean;
};
export default function CloudSettings() {
  const language=useLanguage(),en=language==='en';
  const date = (value:number) => new Date(value*1000).toLocaleDateString(language);
  const number = (value:number) => value.toLocaleString(language);
  const {cloud_mode} = useRuntimeAccess();
  const [analyticsReady,setAnalyticsReady] = useState(false);
  const accountSync = useAccountProfile();
  const [account,setAccount]=useState<Account|null>(null),[error,setError]=useState('');
  const [key,setKey]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const [device,setDevice]=useState(''),[message,setMessage]=useState('');
  const [backups,setBackups]=useState<{id:string;created:number}[]>([]);
  const [dialog,confirm]=useConfirm();
  async function refresh() {
    const [value,history]=await Promise.all([cloudJson('account'),cloudJson('backups')]);
    setAccount(value);setBackups(history.backups);
  }
  useEffect(()=>{setAnalyticsReady(syncAppAnalytics());if(cloud_mode) void refresh().catch(e=>setError(e.message));},[cloud_mode]);
  async function act(action:()=>Promise<unknown>,success=en?'Saved.':'保存しました。') {
    setBusy(true);setError('');setMessage('');
    try {await action();await refresh();setMessage(success);}
    catch(e){setError(e instanceof Error?e.message:en?'Could not complete the action.':'操作を完了できませんでした。');}
    finally {setBusy(false);}
  }
  if(!cloud_mode) return null;
  const usage = account ? Math.min(100,account.storage_bytes/account.entitlements.storage_bytes*100) : 0;
  const expiry = account?.wallet.lots.filter(l=>l.remaining>0).sort((a,b)=>a.expires-b.expires)[0]?.expires;
  const route = account?.routes?.[0];
  return <section className="k-section k-cloud" aria-labelledby="cloud-settings-title">
    {dialog}
    <div className="k-cloud__heading"><h2 className="k-section__title" id="cloud-settings-title"><Icon name="globe" /> {en?'Cloud':'クラウド'}</h2>
      {account?.private_test&&<span className="k-cloud__badge">{en?'Private test':'個人テスト'}</span>}</div>
    {error&&<div className="k-cloud__notice is-error" role="alert">{error}<Button size="sm" variant="ghost" onClick={()=>void act(refresh,en?'Refreshed.':'更新しました。')}>{en?'Reload':'再読み込み'}</Button></div>}
    {message&&<p className="k-cloud__notice" role="status">{message}</p>}
    <AnalyticsConsent enabled={analyticsReady} language={language} />
    <RuntimeSyncSettings />
    {!account ? <div className="k-cloud__card" role="status">{en?'Checking your account…':'アカウントの状態を確認しています…'}</div> : <>
      <div className="k-cloud__overview">
        <div className="k-cloud__card k-cloud__wallet">
          <span className="k-cloud__eyebrow">{en?'Available credits':'使用できるクレジット'}</span>
          <div className="k-cloud__balance">{number(account.wallet.credits)}<span>K-Credits</span></div>
          <p>{expiry?(en?`Next expiry: ${date(expiry)}`:`次の有効期限 ${date(expiry)}`):(en?'Used to generate replies.':'会話の生成に使用します。')}</p>
          <div className="k-cloud__numbers"><span>{en?'Used ':'消費済み '}<strong>{number(account.wallet.used_credits||0)}</strong></span></div>
        </div>
        <div className="k-cloud__card k-cloud__storage">
          <span className="k-cloud__eyebrow">{en?'Cloud storage':'クラウド保存'}</span>
          <div className="k-cloud__storage-number">{(account.storage_bytes/1_000_000).toFixed(1)}<span>/ {number(account.entitlements.storage_bytes/1_000_000)} MB</span></div>
          <progress value={usage} max={100} aria-label={en?'Cloud storage usage':'クラウド保存容量の使用率'} />
          <p>{en?'Stores chats, characters and memories.':'会話・キャラクター・記憶を保存。'}<br />{en?'Editing, syncing and exporting use no credits.':'編集・同期・エクスポートはクレジット不要。'}</p>
        </div>
      </div>
      <div className="k-cloud__card k-cloud__sync">
        <div className="k-cloud__row"><div><h3><Icon name="refresh" size={17}/>{en?'Account sync':'アカウント同期'}</h3><p>{en?'Share your display name, saved characters and pinned chats.':'表示名・保存したキャラ・チャットのピン留めを共有します。'}</p></div>
          <span className={`k-cloud__status ${accountSync.error?'is-warning':''}`}>{accountSync.error?(en?'Check connection':'接続を確認'):accountSync.pending?(en?'Saving…':'保存中…'):accountSync.profile?(en?'Synced':'同期済み'):(en?'Loading…':'読み込み中…')}</span></div>
        <p>{en?'Sign in with the same account on another device. Cloud chats and their memories are stored in this account; copying conversations to devices requires the separate sync settings.':'別の端末でも、同じアカウントでログインできます。Cloud会話と記憶はこのアカウントに保存され、端末へのコピーは会話同期の設定で選びます。'}</p>
        <Button size="sm" variant="secondary" disabled={busy||accountSync.pending>0} onClick={()=>void refreshAccountProfile()}>{en?'Load latest data':'最新の内容を読み込む'}</Button>
      </div>
      <div className="k-cloud__card k-cloud__model"><div className="k-cloud__row"><div><span className="k-cloud__eyebrow">{en?'Conversation model':'会話モデル'}</span><h3>{route?.display_name || route?.model || (en?'Checking provider':'接続先を確認中')}</h3><p>{route ? [route.provider,route.upstream,route.model].filter(Boolean).join(' · ') : (en?'Provider unavailable':'接続先を確認できません')}</p></div><span className="k-cloud__status">{route?.available===true && !route.unavailable_reason?(en?'Available':'利用可能'):(en?'Not available yet':'準備中')}</span></div>
        <p>{en?'Cloud supports general content only. Chats, settings and memories are sent to the provider above. No external input/output safety screening is performed.':'クラウドはSFWのみ。会話・設定・記憶を上記の提供先に送信します。入力・出力の外部安全検査は行いません。'}</p>
      </div>
      <div className="k-cloud__details">
        <details><summary>{en?'Credit history and pricing':'クレジット使用履歴と料金'}</summary><div className="k-cloud__detail-body">
          <p>{en?'Successful generations cost six times the API cost, rounded to whole credits within your accepted limit. Failed generations cost zero credits. Subscription credits expire after 60 days; top-ups after 180 days. Cancellation keeps previously granted credits until their expiry.':'生成ごとのAPI実費の6倍相当を整数で、同意した消費上限内で精算します。失敗した生成の消費は0です。月額分は60日、追加購入分は180日有効です。解約しても付与済み残高は有効期限まで残ります。'}</p>
          <div className="k-cloud__list">{account.wallet.lots.map((lot,i)=><div className="k-cloud__row" key={i}><span>{lot.kind==='admin'?(en?'Admin grant':'管理者からの付与'):lot.kind==='purchase'?(en?'Purchased credits':'購入分'):(en?'Granted credits':'付与クレジット')}</span><span>{number(lot.remaining)} · {en?`expires ${date(lot.expires)}`:`${date(lot.expires)}まで`}</span></div>)}</div>
          {account.wallet.usage?.length ? <ul className="k-cloud__usage">{account.wallet.usage.map((entry,i)=><li key={i}><span>{new Date(entry.created*1000).toLocaleString(language)}</span><strong>{entry.state==='pending'?(en?`Generating · limit ${number(entry.max_credits)}`:`生成中 · 消費上限 ${number(entry.max_credits)}`):entry.state==='completed'?(en?`${number(entry.charged_credits)} used`:`${number(entry.charged_credits)} 消費`):(en?'Failed · 0 used':'失敗 · 消費0')}</strong></li>)}</ul> : <p>{en?'No credit usage yet.':'まだクレジットの使用履歴はありません。'}</p>}
          {account.private_budget&&<p className="k-cloud__muted">{en?'Private test API budget':'個人テストの累計API上限'} ${(account.private_budget.limit_nano/1e9).toFixed(2)} · {en?'remaining':'残り'} ${(account.private_budget.available_nano/1e9).toFixed(6)}{en?' (includes earlier validation and operator reserves)':'（過去の検証と運営側の確保額を含む）'}</p>}
          {account.billing_available&&<div className="k-cloud__actions">{account.plans.filter(p=>p.id!=='free').map(plan=><Button key={plan.id} disabled={busy} onClick={()=>void act(async()=>{const result=await cloudJson('billing/checkout',{method:'POST',body:JSON.stringify({sku:plan.id,request_id:crypto.randomUUID()})});location.assign(result.url);})}>{plan.id} ${plan.monthly_usd}{en?'/month':'/月'} · {number(plan.monthly_credits)} K-Credits</Button>)}
            {[['credits_5',`$5 · ${account.wallet.plan==='free'?'37,500':'45,000'}`],['credits_10',`$10 · ${account.wallet.plan==='free'?'75,000':'90,000'}`]].map(([sku,label])=><Button variant="secondary" key={sku} disabled={busy} onClick={()=>void act(async()=>{const result=await cloudJson('billing/checkout',{method:'POST',body:JSON.stringify({sku,request_id:crypto.randomUUID()})});location.assign(result.url);})}>{en?'Add ':''}{label} {en?'K-Credits':'K-Creditsを追加'}</Button>)}</div>}
          {account.billing_portal_available&&<Button variant="secondary" disabled={busy} onClick={()=>void act(async()=>{location.assign((await cloudJson('billing/portal',{method:'POST'})).url);})}>{en?'Manage subscription and billing':'契約・請求を管理'}</Button>}
        </div></details>
        <details><summary>{en?'Legacy sync with local devices':'以前のローカル端末とのデータ同期'}</summary><div className="k-cloud__detail-body">
          <p>{en?'Exchange chats, characters and memories with the local PC app. Separate from account sync and off by default. Image support is awaiting validation.':'PCのローカル版と会話・キャラ・記憶をやりとりする設定です。アカウント同期とは別に、初期状態ではオフ。画像は検証待ちです。'}</p>
          <label>{en?'Sync scope':'同期する範囲'}<select aria-label={en?'Sync scope':'同期する範囲'} value={account.sync.mode} disabled={busy} onChange={e=>void act(()=>cloudJson('sync',{method:'PUT',body:JSON.stringify({mode:e.target.value})}))}><option value="off">{en?'Off':'オフ'}</option><option value="selected">{en?'Selected chats':'選択した会話'}</option><option value="all">{en?'All':'すべて'}</option></select></label>
          <div className="k-cloud__actions"><Button variant="secondary" disabled={busy||account.sync.mode==='off'} onClick={()=>void act(async()=>{setDevice((await cloudJson('sync/device',{method:'POST'})).token);},en?'Sync token issued.':'同期用トークンを発行しました。')}>{en?'Issue sync token':'同期用トークンを発行'}</Button>
            <Button variant="ghost" disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:en?'Revoke sync device access?':'同期端末のアクセスを解除しますか？',description:en?'Every local device will need to reconnect.':'すべてのローカル端末で再接続が必要になります。',confirmLabel:en?'Revoke access':'解除する'})) await act(async()=>{await cloudJson('sync/devices',{method:'DELETE'});setDevice('');},en?'Sync access revoked.':'同期アクセスを解除しました。');})()}>{en?'Revoke all device access':'全端末のアクセスを解除'}</Button></div>
          {device&&<label>{en?'Sync token (valid for 30 days)':'同期用トークン（30日有効）'}<input readOnly type="password" value={device} onFocus={e=>e.target.select()}/><Button size="sm" variant="secondary" onClick={()=>void navigator.clipboard.writeText(device).then(()=>setMessage(en?'Token copied.':'トークンをコピーしました。')).catch(()=>setError(en?'Could not copy. Copy it from the input field.':'コピーできませんでした。入力欄からコピーしてください。'))}>{en?'Copy':'コピー'}</Button></label>}
        </div></details>
        <details><summary>{en?'Use your own API key (BYOK)':'自分のAPIキーを使う（BYOK）'}</summary><div className="k-cloud__detail-body">
          <p>{en?'Connect to the DeepSeek API. No K-Credits are used; DeepSeek charges apply.':'DeepSeekのAPIへ直接接続します。K-Creditsは不要ですが、DeepSeek側の利用料金が発生します。'}</p>
          <label>{en?'DeepSeek API key':'DeepSeek APIキー'} · {account.byok_configured?(en?'Registered':'登録済み'):(en?'Not registered':'未登録')}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} maxLength={256} placeholder="sk-…"/></label>
          <label className="k-cloud__checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{en?'Allow chats, settings and memories to be sent to DeepSeek and accept provider charges.':'会話・設定・記憶のDeepSeekへの送信と提供元料金に同意します'}</label>
          <div className="k-cloud__actions"><Button variant="secondary" disabled={busy||!consent||!key.trim()} onClick={()=>void act(async()=>{await cloudJson('byok',{method:'PUT',body:JSON.stringify({key,consent})});setKey('');})}>{en?'Save key':'キーを保存'}</Button>
            {account.byok_configured&&<Button variant="ghost" disabled={busy} onClick={()=>void act(()=>cloudJson('byok',{method:'PUT',body:JSON.stringify({key:'',consent:true})}),en?'API key removed.':'APIキーを削除しました。')}>{en?'Remove key':'キーを削除'}</Button>}</div>
        </div></details>
        <details><summary>{en?'Account and data management':'アカウント情報・データ管理'}</summary><div className="k-cloud__detail-body">
          <p className="k-cloud__email">{en?'Signed in: ':'ログイン中：'}{account.identity?.email||(en?'Verified account':'確認済みアカウント')}</p>
          {account.identity&&<label>{en?'Account ID':'アカウントID'}<input readOnly value={account.identity.id} onFocus={e=>e.target.select()}/></label>}
          <Button variant="secondary" disabled={busy} onClick={()=>{const a=document.createElement('a');a.href='/api/cloud/export';a.download='kyalulu-cloud.zip';a.click();}}><Icon name="download" size={16}/>{en?'Export data':'データをエクスポート'}</Button>
          {backups.map(backup=><Button variant="secondary" key={backup.id} disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:en?'Restore an earlier backup?':'過去の状態へ復元しますか？',description:en?'The current state will be backed up before restoring.':'現在の状態をバックアップしてから復元します。',confirmLabel:en?'Restore':'復元する'})) await act(()=>cloudJson(`backups/${backup.id}/restore`,{method:'POST'}));})()}>{en?'Restore ':''}{new Date(backup.created*1000).toLocaleString(language)}{en?'':'に復元'}</Button>)}
          <p className="k-cloud__muted"><a href="/source.tar.gz">{en?'Source for this version (AGPL)':'この版のソース（AGPL）'}</a></p>
          <Button variant="danger" disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:en?'Delete the Cloud copy?':'クラウドコピーを削除しますか？',description:en?'Delete Cloud chats, characters and memories, and stop local sync. Local data stays on your devices. Retained backups remain until their retention period ends.':'クラウドの会話・キャラ・記憶を削除してローカル同期を停止します。ローカルのデータは残ります。保持中のバックアップは期間満了まで残ります。',confirmLabel:en?'Delete and stop sync':'削除して同期を停止'})) await act(()=>cloudJson('sync/snapshot',{method:'DELETE'}),en?'Cloud copy deleted.':'クラウドコピーを削除しました。');})()}>{en?'Delete Cloud copy':'クラウドコピーを削除'}</Button>
        </div></details>
      </div>
      {account.unified_sync_available&&<SyncDevices/>}
      <footer className="k-cloud__footer"><span>{account.private_test?(en?'Invited accounts only · subscriptions and purchases disabled':'招待したアカウント限定 · サブスク・追加購入なし'):(en?'Data is stored per account':'アカウントごとにデータを保管')}</span><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act(async()=>{await cloudJson('auth/logout',{method:'POST'});location.reload();})}>{en?'Sign out':'ログアウト'}</Button></footer>
    </>}
  </section>;
}
