import { useEffect,useState } from 'react';
import { apiFetch } from '../lib/transport';
import Button from './ui/Button';
type Settings={mode:string;selected:string[];connected:boolean;origin:string;revision:number};
export default function LocalCloudSync() {
  const [settings,setSettings]=useState<Settings|null>(null),[mode,setMode]=useState('off'),[selected,setSelected]=useState(''),[token,setToken]=useState('');
  const [consent,setConsent]=useState(false),[imageConsent,setImageConsent]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false),[busy,setBusy]=useState(false);
  async function call(path:string,body?:unknown,method='POST') {
    const response=await apiFetch('/api/local/cloud'+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok){if(result.conflict)setConflict(true);throw Error(result.error || result.detail || `HTTP ${response.status}`);}return result;
  }
  useEffect(()=>{void call('',undefined,'GET').then(value=>{setSettings(value);setMode(value.mode);setSelected(value.selected.join(','));}).catch(()=>{});},[]);
  if(!settings)return null;
  async function act(action:()=>Promise<unknown>){setBusy(true);setMessage('');try{const result=await action();setMessage(typeof result==='object'&&result!==null?JSON.stringify(result):'完了');}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  return <section className="k-section"><h2>任意のクラウド同期</h2><p>既定はオフ。会話・キャラ・Persona・World・記憶を同期できます。APIキー、Remote鍵、端末設定、実験は送りません。クラウドではDeepSeekによるSFW検査を受けます。</p>
    <div className="k-connection__form"><p>接続先：{settings.origin}</p>
      <label>同期用トークン<input type="password" value={token} autoComplete="off" maxLength={256} onChange={e=>setToken(e.target.value)} placeholder={settings.connected?'登録済み（変更時のみ入力）':'クラウド設定画面で発行'} /></label>
      <label>範囲<select value={mode} onChange={e=>setMode(e.target.value)}><option value="off">オフ</option><option value="selected">選択した会話と関連データ</option><option value="all">全同期</option></select></label>
      {mode==='selected'&&<label>会話ID（カンマ区切り）<input value={selected} onChange={e=>setSelected(e.target.value)} /></label>}
      <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>クラウド保存とSFW検査への送信に同意します</label>
      <label><input type="checkbox" checked={imageConsent} onChange={e=>setImageConsent(e.target.checked)}/>関連画像をDeepSeekモデルへSFW検査のために送信し、クラウドへ保存することに同意します（送信先はクラウドのログイン画面で説明され、同意した提供元の経路を使用します。運営の検証完了後に利用可能・静止画1MBまで）</label>
      <Button disabled={busy || (mode!=='off'&&!consent)} onClick={()=>void act(async()=>{const value=await call('',{mode,selected:selected.split(',').map(s=>s.trim()).filter(Boolean),consent,image_consent:imageConsent,...(token?{token}:{})},'PUT');setSettings(value);setToken('');return {mode:value.mode};})}>設定を保存</Button>
      <Button disabled={busy || settings.mode==='off'} onClick={()=>void act(()=>call('/push'))}>ローカルの変更を同期</Button>
      <Button disabled={busy || settings.mode==='off'} onClick={()=>{if(window.confirm('今のローカル版を別コピーに保存して、クラウド版を採用しますか？'))void act(async()=>{const result=await call('/adopt');setConflict(false);return result;});}}>クラウド版を採用（ローカルをバックアップ）</Button>
      {conflict&&<p role="alert">同期が競合しています。自動上書きはしません。クラウド版の採用か、ローカル版の別コピーを選んでください。</p>}
      <Button disabled={busy} onClick={()=>void act(()=>call('/copy'))}>ローカル版を別コピーとして保存</Button>
      <p role="status">{message}</p>
    </div></section>;
}
