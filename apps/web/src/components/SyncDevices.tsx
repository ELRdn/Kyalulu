import { useEffect, useState } from 'react';
import { cloudJson } from '../lib/cloud';
import { useLanguage } from '../lib/appContext';
import Button from './ui/Button';
import './connection.css';

export default function SyncDevices(){
  const en=useLanguage()==='en',[name,setName]=useState(''),[token,setToken]=useState(''),[copied,setCopied]=useState(false),[devices,setDevices]=useState<{id:string;name:string;expires:number}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(){setDevices((await cloudJson('app/devices')).devices);}
  useEffect(()=>{void load().catch(()=>setError(en?'Cannot load sync devices.':'同期端末を取得できません。'));},[en]);
  async function act(action:()=>Promise<void>){setBusy(true);setError('');try{await action();await load();}catch{setError(en?'Could not update sync access. Check your login and eligibility.':'同期アクセスを変更できません。ログインと利用条件を確認してください。');}finally{setBusy(false);}}
  return <section className="k-section k-connection k-native-sync"><h3>{en?'Connect your PC for sync':'PCを会話の同期に接続'}</h3>
    <p>{en?'Create a token for sync only, then register it on that PC. Do not enter it through a Remote connection. It expires after 30 days and also stops working when the login session is revoked.':'同期専用トークンを発行し、対象PCで登録してください。Remote接続の画面には入力しません。有効期間は30日で、ログインセッションの失効でも利用できなくなります。'}</p>
    <label>{en?'PC name':'PCの名前'}<input value={name} maxLength={80} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
    <Button disabled={busy||!name.trim()} onClick={()=>void act(async()=>{const result=await cloudJson('app/devices',{method:'POST',body:JSON.stringify({name})});setToken(result.token);setCopied(false);setName('');})}>{en?'Issue sync token':'同期専用トークンを発行'}</Button>
    {token&&<><label>{en?'Token (shown once; register on your PC)':'トークン（今回のみ表示・PCで登録）'}<input type="password" value={token} readOnly autoComplete="off"/></label>
      <Button variant="secondary" onClick={async()=>{setError('');setCopied(false);try{await navigator.clipboard.writeText(token);setCopied(true);}catch{setError(en?'Could not copy the token. Allow clipboard access, then try again.':'コピーできませんでした。クリップボードへのアクセスを確認して再試行してください。');}}}>{en?'Copy token':'トークンをコピー'}</Button>
      {copied&&<p role="status">{en?'Copied. Paste it into the sync settings on your PC.':'コピーしました。対象PCの同期設定に貼り付けてください。'}</p>}</>}
    {devices.map(device=><p key={device.id}>{device.name} · {new Date(device.expires*1000).toLocaleDateString()} <Button size="sm" variant="ghost" disabled={busy} onClick={()=>void act(async()=>{await cloudJson('app/devices/'+encodeURIComponent(device.id),{method:'DELETE'});setToken('');setCopied(false);})}>{en?'Revoke access':'アクセスを解除'}</Button></p>)}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
