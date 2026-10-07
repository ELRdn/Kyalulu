import { useEffect, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { refreshAccountProfile, useAccountProfile } from '../lib/accountProfile';
import { useRuntimeAccess } from './RuntimeGate';
import { useConfirm } from './ui/Dialog';
import Button from './ui/Button';
import Icon from './ui/Icon';
import './cloudSettings.css';

type Plan = {id:string;monthly_usd:number;monthly_credits:number;storage_bytes:number};
type Account = {
  identity?:{id:string;email?:string};private_test?:boolean;
  private_budget?:{limit_nano:number;prior_accounted_nano:number;available_nano:number};
  wallet:{credits:number;plan:string;used_credits?:number;reserved_credits?:number;
    usage?:{state:string;created:number;charged_credits:number;max_credits:number}[];
    lots:{remaining:number;expires:number;kind:string}[]};
  entitlements:Plan;plans:Plan[];storage_bytes:number;byok_configured:boolean;
  routes?:{provider:string;upstream?:string;display_name?:string;model?:string;available?:boolean;unavailable_reason?:string}[];
  sync:{mode:string};billing_available:boolean;billing_portal_available:boolean;
};
const date = (value:number) => new Date(value*1000).toLocaleDateString();
const number = (value:number) => value.toLocaleString();

export default function CloudSettings() {
  const {cloud_mode} = useRuntimeAccess();
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
  useEffect(()=>{if(cloud_mode) void refresh().catch(e=>setError(e.message));},[cloud_mode]);
  async function act(action:()=>Promise<unknown>,success='保存しました。') {
    setBusy(true);setError('');setMessage('');
    try {await action();await refresh();setMessage(success);}
    catch(e){setError(e instanceof Error?e.message:'操作を完了できませんでした。');}
    finally {setBusy(false);}
  }
  if(!cloud_mode) return null;
  const usage = account ? Math.min(100,account.storage_bytes/account.entitlements.storage_bytes*100) : 0;
  const expiry = account?.wallet.lots.filter(l=>l.remaining>0).sort((a,b)=>a.expires-b.expires)[0]?.expires;
  const route = account?.routes?.[0];
  return <section className="k-section k-cloud" aria-labelledby="cloud-settings-title">
    {dialog}
    <div className="k-cloud__heading"><h2 className="k-section__title" id="cloud-settings-title"><Icon name="globe" /> クラウド</h2>
      {account?.private_test&&<span className="k-cloud__badge">個人テスト</span>}</div>
    {error&&<div className="k-cloud__notice is-error" role="alert">{error}<Button size="sm" variant="ghost" onClick={()=>void act(refresh,'更新しました。')}>再読み込み</Button></div>}
    {message&&<p className="k-cloud__notice" role="status">{message}</p>}
    {!account ? <div className="k-cloud__card" role="status">アカウントの状態を確認しています…</div> : <>
      <div className="k-cloud__overview">
        <div className="k-cloud__card k-cloud__wallet">
          <span className="k-cloud__eyebrow">使用できるクレジット</span>
          <div className="k-cloud__balance">{number(account.wallet.credits)}<span>K-Credits</span></div>
          <p>{expiry?`次の有効期限 ${date(expiry)}`:'会話の生成に使用します。'}</p>
          <div className="k-cloud__numbers"><span>消費済み <strong>{number(account.wallet.used_credits||0)}</strong></span><span>予約中 <strong>{number(account.wallet.reserved_credits||0)}</strong></span></div>
        </div>
        <div className="k-cloud__card k-cloud__storage">
          <span className="k-cloud__eyebrow">クラウド保存</span>
          <div className="k-cloud__storage-number">{(account.storage_bytes/1_000_000).toFixed(1)}<span>/ {number(account.entitlements.storage_bytes/1_000_000)} MB</span></div>
          <progress value={usage} max={100} aria-label="クラウド保存容量の使用率" />
          <p>会話・キャラクター・記憶を保存。<br />編集・同期・エクスポートはクレジット不要。</p>
        </div>
      </div>
      <div className="k-cloud__card k-cloud__sync">
        <div className="k-cloud__row"><div><h3><Icon name="refresh" size={17}/>アカウント同期</h3><p>表示名・保存したキャラ・チャットのピン留めを共有します。</p></div>
          <span className={`k-cloud__status ${accountSync.error?'is-warning':''}`}>{accountSync.error?'接続を確認':accountSync.pending?'保存中…':accountSync.profile?'同期済み':'読み込み中…'}</span></div>
        <p>別の端末でも、同じGoogleアカウントでログインするだけ。会話と記憶もこのアカウントに保存されます。</p>
        <Button size="sm" variant="secondary" disabled={busy||accountSync.pending>0} onClick={()=>void refreshAccountProfile()}>最新の内容を読み込む</Button>
      </div>
      <div className="k-cloud__card k-cloud__model"><div className="k-cloud__row"><div><span className="k-cloud__eyebrow">会話モデル</span><h3>{route?.display_name || route?.model || '接続先を確認中'}</h3><p>{route ? [route.provider,route.upstream,route.model].filter(Boolean).join(' · ') : '接続先を確認できません'}</p></div><span className="k-cloud__status">{route?.available===true && !route.unavailable_reason?'利用可能':'準備中'}</span></div>
        <p>クラウドはSFWのみ。会話・設定・記憶を上記の提供先に送信します。</p>
      </div>
      <div className="k-cloud__details">
        <details><summary>クレジット使用履歴と料金</summary><div className="k-cloud__detail-body">
          <p>10,000 K-Credits＝$1。生成ごとのAPI実費の6倍相当を整数で精算します。失敗した生成の消費は0です。</p>
          <div className="k-cloud__list">{account.wallet.lots.map((lot,i)=><div className="k-cloud__row" key={i}><span>{lot.kind==='admin'?'管理者からの付与':lot.kind==='purchase'?'購入分':'付与クレジット'}</span><span>{number(lot.remaining)} · {date(lot.expires)}まで</span></div>)}</div>
          {account.wallet.usage?.length ? <ul className="k-cloud__usage">{account.wallet.usage.map((entry,i)=><li key={i}><span>{new Date(entry.created*1000).toLocaleString()}</span><strong>{entry.state==='pending'?`${entry.max_credits} 予約中`:entry.state==='completed'?`${entry.charged_credits} 消費`:'失敗 · 消費0'}</strong></li>)}</ul> : <p>まだクレジットの使用履歴はありません。</p>}
          {account.private_budget&&<p className="k-cloud__muted">個人テストの累計API上限 ${(account.private_budget.limit_nano/1e9).toFixed(2)} · 残り ${(account.private_budget.available_nano/1e9).toFixed(6)}（過去の検証・予約を含む）</p>}
          {account.billing_available&&<div className="k-cloud__actions">{account.plans.filter(p=>p.id!=='free').map(plan=><Button key={plan.id} disabled={busy} onClick={()=>void act(async()=>{const result=await cloudJson('billing/checkout',{method:'POST',body:JSON.stringify({sku:plan.id,request_id:crypto.randomUUID()})});location.assign(result.url);})}>{plan.id} ${plan.monthly_usd}/月</Button>)}
            {[['credits_5','$5 · 50,000'],['credits_10','$10 · 100,000']].map(([sku,label])=><Button key={sku} disabled={busy} onClick={()=>void act(async()=>{const result=await cloudJson('billing/checkout',{method:'POST',body:JSON.stringify({sku,request_id:crypto.randomUUID()})});location.assign(result.url);})}>{label} K-Creditsを追加</Button>)}</div>}
          {account.billing_portal_available&&<Button variant="secondary" disabled={busy} onClick={()=>void act(async()=>{location.assign((await cloudJson('billing/portal',{method:'POST'})).url);})}>契約・請求を管理</Button>}
        </div></details>
        <details><summary>ローカル端末とのデータ同期</summary><div className="k-cloud__detail-body">
          <p>PCのローカル版と会話・キャラ・記憶をやりとりする設定です。アカウント同期とは別に、初期状態ではオフ。画像は検証待ちです。</p>
          <label>同期する範囲<select aria-label="同期する範囲" value={account.sync.mode} disabled={busy} onChange={e=>void act(()=>cloudJson('sync',{method:'PUT',body:JSON.stringify({mode:e.target.value})}))}><option value="off">オフ</option><option value="selected">選択した会話</option><option value="all">すべて（SFW検査あり）</option></select></label>
          <div className="k-cloud__actions"><Button variant="secondary" disabled={busy||account.sync.mode==='off'} onClick={()=>void act(async()=>{setDevice((await cloudJson('sync/device',{method:'POST'})).token);},'同期用トークンを発行しました。')}>同期用トークンを発行</Button>
            <Button variant="ghost" disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:'同期端末のアクセスを解除しますか？',description:'すべてのローカル端末で再接続が必要になります。',confirmLabel:'解除する'})) await act(async()=>{await cloudJson('sync/devices',{method:'DELETE'});setDevice('');},'同期アクセスを解除しました。');})()}>全端末のアクセスを解除</Button></div>
          {device&&<label>同期用トークン（30日有効）<input readOnly type="password" value={device} onFocus={e=>e.target.select()}/><Button size="sm" variant="secondary" onClick={()=>void navigator.clipboard.writeText(device).then(()=>setMessage('トークンをコピーしました。')).catch(()=>setError('コピーできませんでした。入力欄からコピーしてください。'))}>コピー</Button></label>}
        </div></details>
        <details><summary>自分のAPIキーを使う（BYOK）</summary><div className="k-cloud__detail-body">
          <p>DeepSeekのAPIへ直接接続します。K-Creditsは不要ですが、DeepSeek側の利用料金が発生します。</p>
          <label>DeepSeek APIキー · {account.byok_configured?'登録済み':'未登録'}<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)} maxLength={256} placeholder="sk-…"/></label>
          <label className="k-cloud__checkbox"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>会話・設定・記憶のDeepSeekへの送信と提供元料金に同意します</label>
          <div className="k-cloud__actions"><Button variant="secondary" disabled={busy||!consent||!key.trim()} onClick={()=>void act(async()=>{await cloudJson('byok',{method:'PUT',body:JSON.stringify({key,consent})});setKey('');})}>キーを保存</Button>
            {account.byok_configured&&<Button variant="ghost" disabled={busy} onClick={()=>void act(()=>cloudJson('byok',{method:'PUT',body:JSON.stringify({key:'',consent:true})}),'APIキーを削除しました。')}>キーを削除</Button>}</div>
        </div></details>
        <details><summary>アカウント情報・データ管理</summary><div className="k-cloud__detail-body">
          <p className="k-cloud__email">ログイン中：{account.identity?.email||'確認済みアカウント'}</p>
          {account.identity&&<label>アカウントID<input readOnly value={account.identity.id} onFocus={e=>e.target.select()}/></label>}
          <Button variant="secondary" disabled={busy} onClick={()=>{const a=document.createElement('a');a.href='/api/cloud/export';a.download='kyalulu-cloud.zip';a.click();}}><Icon name="download" size={16}/>データをエクスポート</Button>
          {backups.map(backup=><Button variant="secondary" key={backup.id} disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:'過去の状態へ復元しますか？',description:'現在の状態をバックアップしてから復元します。',confirmLabel:'復元する'})) await act(()=>cloudJson(`backups/${backup.id}/restore`,{method:'POST'}));})()}>{new Date(backup.created*1000).toLocaleString()}に復元</Button>)}
          <p className="k-cloud__muted"><a href="/source.tar.gz">この版のソース（AGPL）</a></p>
          <Button variant="danger" disabled={busy} onClick={()=>void (async()=>{if(await confirm({title:'クラウドコピーを削除しますか？',description:'クラウドの会話・キャラ・記憶を削除してローカル同期を停止します。ローカルのデータは残ります。保持中のバックアップは期間満了まで残ります。',confirmLabel:'削除して同期を停止'})) await act(()=>cloudJson('sync/snapshot',{method:'DELETE'}),'クラウドコピーを削除しました。');})()}>クラウドコピーを削除</Button>
        </div></details>
      </div>
      <footer className="k-cloud__footer"><span>{account.private_test?'招待したアカウント限定 · サブスク・追加購入なし':'アカウントごとにデータを保管'}</span><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act(async()=>{await cloudJson('auth/logout',{method:'POST'});location.reload();})}>ログアウト</Button></footer>
    </>}
  </section>;
}
