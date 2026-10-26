import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/transport';
import { useLanguage } from '../lib/appContext';
import Button from './ui/Button';
import { useConfirm } from './ui/Dialog';
import './connection.css';

type Settings={origin:string;owner:string;connected:boolean;enabled:boolean;selected:string[];pending:boolean;phase:string;error:string;restores?:Record<string,string>;sessions:{id:string;count:number;preview:string}[]};
type Review={id:string;revision:number;count:number;deleted:boolean};
const errors:Record<string,[string,string]>={
  sync_account_changed:['同期先が変わりました。設定を再読込してください。','The account changed. Reload the settings.'],
  sync_account_copy_required:['別アカウントの会話は選べません。必要なら書き出して別コピーを作ってください。','This chat belongs to another sync account. Export and import a separate copy if needed.'],
  sync_delete_reconfirmation_required:['Cloudの会話が更新されています。削除を再確認してください。','The Cloud chat changed. Review the deletion again.'],
  sync_connection_failed:['接続できません。未送信データをこのPCに保持しています。','Connection failed. Pending data remains on this PC.'],
  sync_device_expired:['同期アクセスが失効しています。Cloudで新しいトークンを発行してください。','Sync access expired. Issue a new token in Cloud.'],
  stop_generation_before_sync:['生成結果の保存後に同期します。','Sync will resume after the generation is saved.'],
  sync_pending_receipt_retained:['同期はオフです。未確定の送信結果をこのPCに保持しています。','Sync is off. An unresolved receipt remains on this PC.'],
  sync_restored_session_confirmation_required:['復元内容が更新されたか、別コピーとして送信する確認が必要です。設定を再読込して確認してください。','The restore changed or needs approval as a separate copy. Reload these settings and review it.'],
  sync_restore_receipt_pending:['以前の送信結果が未確定です。接続を確認して、復元コピーの確認をやり直してください。','An earlier send is unresolved. Check the connection, then review the restored copy again.'],
};
export default function NativeSyncSettings(){
  const en=useLanguage()==='en',[settings,setSettings]=useState<Settings|null>(null),[selected,setSelected]=useState<string[]>([]),[enabled,setEnabled]=useState(false),[consent,setConsent]=useState(false),[token,setToken]=useState(''),[replace,setReplace]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[reviews,setReviews]=useState<Review[]>([]);
  const current=useRef(''),epoch=useRef(0),working=useRef(false),edited=useRef(false),[dialog,confirm]=useConfirm();
  const friendly=(code:string)=>errors[code]?.[en?1:0]??(en?'Sync could not finish. Check the connection and device storage.':'同期を完了できません。接続と端末の保存状態を確認してください。');
  async function call(path='',body?:unknown,method=body===undefined?'GET':'POST'){
    const response=await apiFetch('/api/local/app-sync'+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result=await response.json();if(!response.ok)throw Error(result.error??result.detail??'Sync failed');return result;
  }
  async function load(reset=false){const attempt=++epoch.current,value:Settings=await call();if(attempt!==epoch.current)return;const changed=current.current!==value.owner;current.current=value.owner;setSettings(value);if(changed||reset)setReviews([]);if(reset||changed||!edited.current){setSelected(value.selected);setEnabled(value.enabled);}if(reset||changed){edited.current=false;setToken('');setConsent(false);setReplace(false);}}
  useEffect(()=>{let alive=true;const refresh=()=>{if(alive&&!working.current&&document.visibilityState!=='hidden')void load().catch(e=>{if(alive)setError(String(e.message));});};refresh();const timer=setInterval(refresh,5000);return()=>{alive=false;++epoch.current;clearInterval(timer);};},[en]);
  async function act(action:()=>Promise<unknown>,reset=false){working.current=true;++epoch.current;setBusy(true);setError('');setSaved(false);try{await action();await load(reset);setSaved(true);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{working.current=false;setBusy(false);}}
  async function save(){
    if(!settings||busy)return;
    const restore_confirmations=enabled?Object.fromEntries(selected.filter(id=>settings.restores?.[id]).map(id=>[id,settings.restores![id]])):{};
    if(Object.keys(restore_confirmations).length&&!await confirm({title:en?'Sync restored chats as separate copies?':'復元した会話を別コピーとして同期しますか？',description:<><p>{en?'Earlier Cloud chats stay unchanged. Any earlier pending sends will be resolved before these restored chats are saved as new copies.':'以前のCloud会話は変更しません。以前の送信の完了・取消を確認してから、復元した会話を新しいコピーとして保存します。'}</p><ul>{Object.keys(restore_confirmations).map(id=><li key={id}>{settings.sessions.find(s=>s.id===id)?.preview||id}</li>)}</ul></>,confirmLabel:en?'Sync separate copies':'別コピーとして同期',cancelLabel:en?'Cancel':'キャンセル'}))return;
    await act(()=>call('',{enabled,selected,consent,replace_account:replace,expected_owner:settings.owner,...(token?{token}:{}),...(Object.keys(restore_confirmations).length?{restore_confirmations}:{})},'PUT'),true);
  }
  return <section className="k-section k-connection k-native-sync">{dialog}<h2>{en?'Sync this PC':'このPCの会話を同期'}</h2>
    <p>{en?'Send selected PC chats and receive chats already synced to the account. Imported chats continue syncing automatically.':'選んだPCの会話を送信し、アカウントで同期中の会話を受信します。取り込んだ会話の変更も自動で同期します。'}</p>
    <p>{en?'Register on this PC. The token grants sync access only and cannot buy credits or run Cloud models.':'登録はこのPCで行います。同期専用トークンでは購入やCloud生成を行えません。'}</p>
    {settings&&<div className="k-connection__form"><p><a href={settings.origin+'/#/profile'} target="_blank" rel="noreferrer">{en?'Issue a sync token in Cloud settings':'Cloud設定で同期用トークンを発行'}</a></p>
      {settings.owner&&<p>{en?'Account ID: ':'アカウントID：'}{settings.owner}</p>}
      <label>{en?'Sync token':'同期用トークン'}<input type="password" value={token} disabled={busy} autoComplete="off" maxLength={256} onChange={e=>{edited.current=true;setToken(e.target.value);}} placeholder={settings.connected?(en?'Registered; enter only to replace':'登録済み・変更時のみ入力'):''}/></label>
      {!!token&&settings.connected&&<label><input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)}/>{en?'Allow switching to the token’s account. Other-account chats stay on this PC.':'トークンのアカウントへの切替を許可する。別アカウントの会話はこのPCに残します。'}</label>}
      <label><input type="checkbox" disabled={busy} checked={enabled} onChange={e=>{edited.current=true;setEnabled(e.target.checked);}}/>{en?'Enable automatic sync':'自動同期を有効にする'}</label>
      {!!Object.keys(settings.restores??{}).length&&<p role="status">{en?'Restored chats need confirmation before they can be sent as new copies.':'復元した会話を送信するには、新しいコピーとして保存する確認が必要です。'}</p>}
      <fieldset disabled={busy}><legend>{en?'PC chats to send':'送信するPCの会話'}</legend>{settings.sessions.map(s=><label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={e=>{edited.current=true;setSelected(e.target.checked?[...selected,s.id]:selected.filter(id=>id!==s.id));}}/>{s.preview||s.id} · {s.count}{settings.restores?.[s.id]&&(en?' (restored; review required)':'（復元・再確認が必要）')}</label>)}{selected.filter(id=>!settings.sessions.some(s=>s.id===id)).map(id=><label key={id}><input type="checkbox" checked onChange={()=>{edited.current=true;setSelected(selected.filter(s=>s!==id));}}/>{id} · {en?'Chat data is missing. Deselect it or check your backup.':'会話データがありません。選択を解除するか、バックアップを確認してください。'}</label>)}</fieldset>
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>{en?'Allow these chats, settings and memories to be saved to this Cloud account.':'このアカウントへの会話・作品設定・記憶の保存と同期に同意する'}</label>
      <Button disabled={busy||enabled&&!consent||!settings.connected&&!token} onClick={()=>void save()}>{en?'Save sync settings':'同期設定を保存'}</Button>
      <Button variant="secondary" disabled={busy||!settings.connected||!settings.enabled} onClick={()=>void act(()=>call('/run',{expected_owner:settings.owner}))}>{en?'Sync now':'今すぐ同期'}</Button>
      <Button variant="ghost" disabled={busy||!settings.connected} onClick={()=>void act(()=>call('',{expected_owner:settings.owner},'DELETE'),true)}>{en?'Disconnect this PC':'このPCの接続を解除'}</Button>
      {edited.current&&<Button variant="ghost" disabled={busy} onClick={()=>void load(true)}>{en?'Discard settings edits':'設定の変更を戻す'}</Button>}
      <p role="status">{settings.pending?(en?'Pending changes or receipts are retained.':'未送信の変更または未確定の受領結果を保持しています。'):settings.phase==='saved'?(en?'Synced':'同期済み'):settings.enabled?(en?'Automatic sync is enabled':'自動同期は有効です'):en?'Sync is off':'同期はオフです'}</p>
      {settings.error&&<p role="alert">{friendly(settings.error)}</p>}
      <Button variant="ghost" disabled={busy||!settings.connected||!settings.enabled} onClick={()=>void act(async()=>{const value=await call('/deletions');if(value.owner!==current.current)throw Error('sync_account_changed');setReviews(value.items);})}>{en?'Review pending deletions':'保留中の削除を確認'}</Button>
      {reviews.map(r=><div key={r.id}><p>{r.id} · v{r.revision} · {r.count} {en?'messages':'メッセージ'}</p><Button variant="danger" disabled={busy||!settings.enabled} onClick={()=>void(async()=>{
        const owner=settings.owner;
        if(await confirm({title:en?'Erase this synced chat?':'同期コピーを完全消去しますか？',description:<><p>{r.id} · v{r.revision} · {r.count} {en?'messages':'メッセージ'}</p>{en?'Confirm this Cloud version. Unsent edits on other devices are kept as device-only copies.':'このCloudの版を対象にします。他端末の未送信の変更は端末限定のコピーとして保持します。'}</>,confirmLabel:en?'Confirm erasure':'完全消去を確認',cancelLabel:en?'Cancel':'キャンセル',danger:true}))await act(async()=>{await call('/deletions',{id:r.id,revision:r.revision,confirmed:true,expected_owner:owner});setReviews(items=>items.filter(item=>item.id!==r.id));await call('/run',{expected_owner:owner});});
      })()}>{en?'Confirm this version':'この版の削除を確認'}</Button></div>)}
    </div>}{saved&&<p role="status">{en?'Saved.':'保存しました。'}</p>}{error&&<p role="alert">{friendly(error)}</p>}
  </section>;
}
