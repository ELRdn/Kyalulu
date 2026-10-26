import { useEffect, useState, useSyncExternalStore } from 'react';
import { allEntities, entity, getMeta, type AppEntity } from '../lib/appStore';
import { reconfirmDeletion, subscribeSync, syncNow, syncState } from '../lib/appSync';
import { deviceOwner, useDeviceOwner, useLanguage, useGenerationBusy } from '../lib/appContext';
import Button from './ui/Button';
import { useConfirm } from './ui/Dialog';

export default function SyncDeletionReview() {
  const owner=useDeviceOwner(),en=useLanguage()==='en',generation=useGenerationBusy(),status=useSyncExternalStore(subscribeSync,syncState,syncState);
  const [pending,setPending]=useState<AppEntity[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [dialog,confirm]=useConfirm();
  async function refresh(){const records=await allEntities(owner);if(owner===deviceOwner())setPending(records.filter(e=>e.kind==='conversation'&&e.deleted&&e.dirty));}
  useEffect(()=>{let active=true;void allEntities(owner).then(records=>{if(active)setPending(records.filter(e=>e.kind==='conversation'&&e.deleted&&e.dirty));}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[owner,status]);
  if(!pending.length)return null;
  return <section>{dialog}<h3>{en?'Pending conversation erasure':'会話の完全消去を確認'}</h3>
    <p>{en?'Updated Cloud conversations require another confirmation. Unsent local edits on other devices are preserved separately.':'Cloud側で更新があった会話は、再確認してから消去します。他の端末に残る未送信の変更は、独立した端末限定コピーとして保護します。'}</p>
    {pending.filter(record=>record.owner===owner).map(record=><div key={record.id} className="k-cloud__row"><span>{record.payload.title??(en?'Conversation':'会話')} · {record.payload.messages?.length??0} {en?'messages':'件'}</span>
      <Button variant="secondary" disabled={busy||generation} onClick={async()=>{
        setBusy(true);setError('');
        try {
          await syncNow(owner);
          const current=await entity(record.id,owner);
          if(!current?.dirty||!current.deleted){await refresh();return;}
          const remote=await getMeta<{revision:number;deleted:boolean;count:number}>(`sync:${owner}:remote:${record.id}`);
          if(!remote||remote.deleted)throw Error(en?'Reconnect to verify the latest Cloud revision.':'接続を復旧してCloud側の最新状態を確認してください。');
          if(!await confirm({title:en?'Erase the updated Cloud conversation?':'更新されたCloud会話も完全消去しますか？',
            description:en?`Cloud revision ${remote.revision}, ${remote.count} messages. Its synchronized copies will be erased. Unsent changes stay on their devices.`:`Cloud版 v${remote.revision}・${remote.count}件の本文と同期コピーを消去します。未送信の変更は各端末に保持します。`,
            confirmLabel:en?'Confirm erasure':'完全消去を再確認',danger:true}))return;
          await reconfirmDeletion(owner,current.id,current.revision,remote.revision);await syncNow(owner);await refresh();
          if(syncState().phase==='error')throw Error(syncState().error);
        }catch(e){setError(String(e));}finally{setBusy(false);}
      }}>{en?'Verify latest version':'最新の版を確認'}</Button></div>)}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
