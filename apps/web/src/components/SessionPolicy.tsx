import { useEffect, useState, useSyncExternalStore } from 'react';
import { useExecutionTarget, useLanguage, labels, deviceOwner, useDeviceOwner } from '../lib/appContext';
import { entity, conversationInfo, saveEntity, entitySelection, appTransaction } from '../lib/appStore';
import { syncNow, syncState, subscribeSync, setSyncConsent, hydrateConversation } from '../lib/appSync';
import { apiFetch, cloudFetch } from '../lib/transport';
import { useConfirm } from './ui/Dialog';
import Button from './ui/Button';

export function UnifiedSync() {
  useEffect(()=>{
    const run=()=>{if(document.visibilityState!=='hidden')void syncNow();};
    run();const timer=setInterval(run,15000);window.addEventListener('online',run);
    return()=>{clearInterval(timer);window.removeEventListener('online',run);};
  },[]);
  return null;
}
function NativeSessionPolicy({sessionId,en}:{sessionId:string;en:boolean}) {
  const [status,setStatus]=useState<{selected:boolean;enabled:boolean;pending:boolean;error:string}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();setStatus(null);
    const refresh=async()=>{
      try{
        const response=await apiFetch('/api/local/app-sync/status?session_id='+encodeURIComponent(sessionId),{signal:controller.signal});
        const value=await response.json();if(!response.ok||value.session_id!==sessionId)throw Error('Invalid sync status');
        if(!controller.signal.aborted)setStatus(value);
      }catch{if(!controller.signal.aborted)setStatus({selected:false,enabled:false,pending:false,error:'unavailable'});}
    };
    void refresh();const timer=setInterval(()=>{if(document.visibilityState!=='hidden')void refresh();},5000);
    return()=>{controller.abort();clearInterval(timer);};
  },[sessionId]);
  const text=!status?(en?'Checking sync':'同期状態を確認中'):status.error?(en?'Check sync settings':'同期設定を確認')
    :status.pending?(en?'Sync receipt pending':'同期の送信結果を確認中'):!status.selected?(en?'Not selected for sync':'同期対象外')
    :status.enabled?(en?'Automatic sync enabled':'自動同期が有効'):(en?'Sync stopped':'同期停止中');
  return <span role="status">{text}</span>;
}
export default function SessionPolicy({sessionId,model,disabled}:{sessionId:string;model:string;disabled:boolean}) {
  const target=useExecutionTarget(),language=useLanguage(),en=language==='en',t=labels[language];
  const owner=useDeviceOwner();
  const state=useSyncExternalStore(subscribeSync,syncState,syncState);
  const [policy,setPolicy]=useState('local'),[pinned,setPinned]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stored,setStored]=useState(false);
  const [dialog,confirm]=useConfirm();
  useEffect(()=>{let alive=true;setStored(false);if(target==='device')void conversationInfo(sessionId,owner).then(value=>{if(alive){setPolicy(value?.selection.storage_policy??'local');setPinned(value?.pinned??false);setStored(!!value&&!value.deleted);}}).catch(error=>{if(alive)setError(String(error));});return()=>{alive=false;};},[sessionId,target,state,owner,disabled]);
  return <div className="k-session-policy">{dialog}<span>{t.target}: {t[target]}</span><span>{t.model}: {model||t.unavailable}</span>
    {target==='local'&&<NativeSessionPolicy key={sessionId} sessionId={sessionId} en={en}/>}
    {target!=='device'?<span>{en?'Saved on':'保存先'}: {target==='cloud'?'Cloud':target==='local'?t.local:t.pc}</span>:<>
      <span>{policy==='local'?t.localOnly:t.sync}</span>
      {policy==='local'&&<Button size="sm" variant="ghost" disabled={disabled||busy||!stored} onClick={async()=>{
        const owner=deviceOwner();setError('');
        if(owner==='guest'){setError(en?'Log in to Cloud first. Device-only conversations stay on this device.':'先にCloudへログインしてください。端末限定の会話は転送しません。');return;}
        if(!await confirm({title:en?'Sync this conversation?':'この会話を同期しますか？',description:en?'Messages, settings, memories and branches will be uploaded to your account.':'本文・設定・記憶・分岐をアカウントへ送信します。',confirmLabel:t.sync}))return;
        setBusy(true);
        try{
          const response=await cloudFetch('/api/mobile/status'),identity=await response.json();
          if(!response.ok||!identity.authenticated||identity.owner_scope!==owner)throw Error(en?'Login required':'ログインを確認できません');
          const value=await entity(sessionId,owner);if(!value||value.deleted||owner!==deviceOwner())throw Error(en?'Check the saved conversation first':'保存済みの会話を確認してください');
          await saveEntity({...value,payload:{...value.payload,storage_policy:'sync'}},value.revision);await setSyncConsent(owner,true);await syncNow(owner);setPolicy('sync');
        }catch(e){setError(String(e));}finally{setBusy(false);}
      }}>{t.sync}</Button>}
      <label className="k-unified-check"><input type="checkbox" checked={pinned} disabled={disabled||busy||!stored} onChange={async e=>{
        const next=e.target.checked,owner=deviceOwner();setBusy(true);
        try{
          if(next&&(await conversationInfo(sessionId,owner))?.selection.cache_evicted)await hydrateConversation(sessionId,owner);
          await appTransaction<void>(['entities'],'readwrite',(tx,done)=>{const store=tx.objectStore('entities'),r=store.get([owner,sessionId]);r.onsuccess=()=>{
            if(owner!==deviceOwner()||!r.result||r.result.deleted||next&&entitySelection(r.result).cache_evicted){tx.abort();return;}
            store.put({...r.result,pinned:next});done();};});setPinned(next);
        }catch(e){setError(String(e));}finally{setBusy(false);}
      }}/>{t.offline}</label>
      {policy==='sync'&&<span role="status">{state.phase==='off'?en?'Sync stopped':'同期停止中':state.phase==='error'?en?'Sync needs attention':'同期を確認':state.pending||state.phase==='syncing'?en?'Saving':'保存中':en?'Saved':'同期済み'}</span>}
    </>}
    {error&&<span role="alert">{error}</span>}
  </div>;
}
