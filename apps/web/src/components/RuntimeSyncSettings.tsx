import { useState } from 'react';
import { deviceOwner, useLanguage, useGenerationBusy, useDeviceOwner } from '../lib/appContext';
import { runtimeConsent, setSyncConsent, syncNow, syncState, type RuntimeConsent } from '../lib/appSync';
import { cloudFetch } from '../lib/transport';
import { sessionTitle, type SessionInfo } from '../lib/api';
import Button from './ui/Button';
import { useConfirm } from './ui/Dialog';
import SyncDeletionReview from './SyncDeletionReview';

export default function RuntimeSyncSettings() {
  const en=useLanguage()==='en',generation=useGenerationBusy(),owner=useDeviceOwner();
  const tr=(ja:string,english:string)=>en?english:ja;
  const [loadedOwner,setLoadedOwner]=useState('');
  const [value,setValue]=useState<RuntimeConsent|null>(null),[selected,setSelected]=useState<string[]>([]);
  const [sessions,setSessions]=useState<SessionInfo[]>([]),[busy,setBusy]=useState(false);
  const [error,setError]=useState<'verify'|'reload'|'account'|{raw:string}|null>(null),[message,setMessage]=useState<''|'enabled'|'stopped'|'stop-unverified'>('');
  const [dialog,confirm]=useConfirm();
  async function load() {
    setBusy(true);setError(null);setValue(null);setMessage('');
    try {
      const consent=await runtimeConsent(owner);
      const response=await cloudFetch('/api/chat/sessions',{headers:{'X-Kyalulu-Owner':owner},signal:AbortSignal.timeout(20000)}),body=await response.json();
      if(!response.ok||!Array.isArray(body.sessions)||owner!==deviceOwner()){setError('verify');return;}
      setLoadedOwner(owner);setValue(consent);setSelected(consent.selected);setSessions(body.sessions);
    }catch(e){setError({raw:String(e)});}finally{setBusy(false);}
  }
  async function save(enabled:boolean) {
    if(generation||owner!==deviceOwner()||enabled&&(!value||loadedOwner!==owner))return;
    if(enabled&&!await confirm({title:en?'Enable conversation sync?':'会話の同期を有効にしますか？',
      description:en?'Selected Cloud conversations, messages, settings and attributable memories will be copied to this account’s devices. Synced device conversations create separate Cloud copies. Conversations replaced through legacy sync resume as separate restored copies. Originals stay intact; no other conversations are selected automatically.':'選んだCloud会話の本文・設定・出典を確認できる記憶を、このアカウントの端末へコピーします。同期を許可した端末会話はCloudに別コピーを作ります。旧同期で置き換えた履歴は、独立した復元コピーとして同期を再開します。元の会話は残し、他の会話を自動選択しません。',
      confirmLabel:en?'Enable sync':'同意して有効にする'}))return;
    setBusy(true);setError(null);setMessage('');
    try {
      if(owner!==deviceOwner()){setError('account');return;}
      if(!enabled)await setSyncConsent(owner,false);
      if(!value||loadedOwner!==owner){setError('reload');if(!enabled)setMessage('stop-unverified');return;}
      const next=await runtimeConsent(owner,{revision:value.revision,selected:enabled?selected:[],consent:enabled});
      setValue(next);setSelected(next.selected);await setSyncConsent(owner,enabled);
      if(enabled){await syncNow(owner);if(syncState().phase==='error')throw Error(syncState().error);}
      setMessage(enabled?'enabled':'stopped');
    }catch(e){
      setError({raw:String(e)});
      if(!enabled)setMessage('stop-unverified');
    }finally{setBusy(false);}
  }
  if(owner==='guest')return null;
  return <details onToggle={e=>{if(e.currentTarget.open&&!value&&!busy)void load();}}>{dialog}
    <summary>{en?'Sync Cloud conversations with this device':'Cloud会話をこの端末と同期'}</summary>
    <div className="k-cloud__detail-body">
      <p>{en?'Choose individual Cloud conversations. Device-only conversations stay on their original device. This setting does not connect your PC.':'Cloudから持ち出す会話を個別に選びます。端末限定の会話はその端末に残します。自分のPCとの接続は別設定です。'}</p>
      {value&&loadedOwner===owner&&<><p role="status">{en?'Cloud copying: ':'Cloud側のコピー: '}{value.accepted?(en?'Enabled':'有効'):(en?'Off':'オフ')}</p>
        <fieldset disabled={busy||generation}><legend>{en?'Cloud conversations to copy':'コピーするCloud会話'}</legend>
          {sessions.filter(s=>!s.nsfw).map(s=><label className="k-cloud__checkbox" key={s.session_id}><input type="checkbox" checked={selected.includes(s.session_id)}
            onChange={e=>setSelected(ids=>e.target.checked?[...ids,s.session_id]:ids.filter(id=>id!==s.session_id))}/>{sessionTitle(s)} · {s.count} {en?'messages':'件'} {s.sync_copy?`(${en?'Synced copy':'同期コピー'} v${s.sync_copy.revision})`:''}</label>)}
          {!sessions.length&&<p>{en?'No Cloud conversations yet. You can enable incoming device copies.':'Cloud会話はまだありません。端末からのコピー受け取りは有効にできます。'}</p>}
          {selected.filter(id=>!sessions.some(s=>s.session_id===id)).map(id=><label className="k-cloud__checkbox" key={id}><input type="checkbox" checked onChange={()=>setSelected(ids=>ids.filter(item=>item!==id))}/>{en?'Unavailable selection — uncheck before saving':'一覧にない選択済み会話 — チェックを外して保存してください'}</label>)}
        </fieldset>
        <div className="k-cloud__actions"><Button disabled={busy||generation||selected.length>1000} onClick={()=>void save(true)}>{en?'Save selection and enable':'選択を保存して有効にする'}</Button></div>
      </>}
      <Button variant="secondary" disabled={busy||generation} onClick={()=>void save(false)}>{en?'Stop copying and device sync':'コピーと端末同期を停止'}</Button>
      <Button variant="ghost" disabled={busy} onClick={()=>void load()}>{en?'Reload settings':'設定を再読み込み'}</Button>
      <SyncDeletionReview />
      {error&&<p role="alert">{typeof error==='object'?error.raw:error==='verify'
        ?tr('Cloudの会話を確認できません','Could not verify Cloud conversations')
        :error==='reload'?tr('Cloud側の設定は再読み込みして確認してください。','Reload Cloud settings to confirm the server-side change.')
        :tr('アカウントが切り替わりました','Account changed')}</p>}
      {message&&<p role="status">{message==='enabled'?tr('同期を有効にしました。コピーは別の会話として表示します。','Sync enabled. Copies are listed separately.')
        :message==='stopped'?tr('Cloudとのコピーと、この端末の同期を停止しました。保存済みコピーは残ります。','Cloud copying and sync on this device stopped. Existing copies are retained.')
        :tr('この端末の同期は停止しました。Cloud側のコピー停止は再試行して確認してください。','Sync on this device is stopped. Retry to confirm that Cloud copying is also stopped.')}</p>}
    </div>
  </details>;
}
