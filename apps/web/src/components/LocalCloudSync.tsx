import { useEffect,useState } from 'react';
import { apiFetch } from '../lib/transport';
import { useLanguage } from '../lib/appContext';
import Button from './ui/Button';
type Settings={mode:string;selected:string[];connected:boolean;origin:string;revision:number};
export default function LocalCloudSync() {
  const en=useLanguage()==='en';
  const [settings,setSettings]=useState<Settings|null>(null),[mode,setMode]=useState('off'),[selected,setSelected]=useState(''),[token,setToken]=useState('');
  const [consent,setConsent]=useState(false),[imageConsent,setImageConsent]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false),[busy,setBusy]=useState(false);
  async function call(path:string,body?:unknown,method='POST') {
    const response=await apiFetch('/api/local/cloud'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok){if(result.conflict)setConflict(true);throw Error(result.error || result.detail || `HTTP ${response.status}`);}return result;
  }
  useEffect(()=>{void call('',undefined,'GET').then(value=>{setSettings(value);setMode(value.mode);setSelected(value.selected.join(','));}).catch(()=>{});},[]);
  if(!settings)return null;
  async function act(action:()=>Promise<unknown>){setBusy(true);setMessage('');try{await action();setMessage(en?'Done.':'完了しました。');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="k-section"><h2>{en?'Legacy backup sync':'以前のバックアップ同期'}</h2><p>{en?'Off by default. Transfer chats, characters, Personas, Worlds and memories as backups. API keys, Remote keys, device settings and experiments are excluded. Content screening uses the provider route described and accepted at Cloud login.':'既定はオフ。会話・キャラ・Persona・World・記憶をバックアップ形式で送受信します。APIキー、Remote鍵、端末設定、実験は送りません。内容検査にはCloudのログイン画面で説明され、同意した提供元の経路を使用します。'}</p>
    <div className="k-connection__form"><p>{en?'Cloud: ':'接続先：'}{settings.origin}</p>
      <label>{en?'Sync token':'同期用トークン'}<input type="password" value={token} autoComplete="off" maxLength={256} onChange={e=>setToken(e.target.value)} placeholder={settings.connected?(en?'Registered; enter only to replace':'登録済み（変更時のみ入力）'):(en?'Issue in Cloud settings':'クラウド設定画面で発行')} /></label>
      <label>{en?'Scope':'範囲'}<select value={mode} onChange={e=>setMode(e.target.value)}><option value="off">{en?'Off':'オフ'}</option><option value="selected">{en?'Selected chats and related data':'選択した会話と関連データ'}</option><option value="all">{en?'All data':'全同期'}</option></select></label>
      {mode==='selected'&&<label>{en?'Chat IDs, separated by commas':'会話ID（カンマ区切り）'}<input value={selected} onChange={e=>setSelected(e.target.value)} /></label>}
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{en?'Allow Cloud backup storage and content screening by the accepted provider.':'Cloudへのバックアップ保存と、同意済み提供元による内容検査への送信に同意します'}</label>
      <label><input type="checkbox" checked={imageConsent} onChange={e=>setImageConsent(e.target.checked)}/>{en?'Allow related images to be screened by the accepted provider and saved to Cloud. Available after operator verification; still images up to 1 MB.':'関連画像の内容検査への送信とCloud保存に同意します（同意済み提供元の経路を使用。運営の検証完了後に利用可能・静止画1MBまで）'}</label>
      <Button disabled={busy || (mode!=='off'&&!consent)} onClick={()=>void act(async()=>{const value=await call('',{mode,selected:selected.split(',').map(s=>s.trim()).filter(Boolean),consent,image_consent:imageConsent,...(token?{token}:{})},'PUT');setSettings(value);setToken('');return {mode:value.mode};})}>{en?'Save settings':'設定を保存'}</Button>
      <Button disabled={busy || settings.mode==='off'} onClick={()=>void act(()=>call('/push'))}>{en?'Sync local changes':'ローカルの変更を同期'}</Button>
      <Button disabled={busy || settings.mode==='off'} onClick={()=>{if(window.confirm(en?'Save a separate copy of the current local data, then adopt the Cloud version?':'今のローカル版を別コピーに保存して、クラウド版を採用しますか？'))void act(async()=>{const result=await call('/adopt');setConflict(false);return result;});}}>{en?'Adopt Cloud version (back up local data)':'クラウド版を採用（ローカルをバックアップ）'}</Button>
      {conflict&&<p role="alert">{en?'Sync conflict. Choose whether to adopt the Cloud version or save a separate local copy.':'同期が競合しています。自動上書きはしません。クラウド版の採用か、ローカル版の別コピーを選んでください。'}</p>}
      <Button disabled={busy} onClick={()=>void act(()=>call('/copy'))}>{en?'Save a separate local copy':'ローカル版を別コピーとして保存'}</Button>
      <p role="status">{message}</p>
    </div></section>;
}
