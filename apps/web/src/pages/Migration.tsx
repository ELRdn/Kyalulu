import { useEffect, useRef, useState } from 'react';
import { parseMigration } from '../mobile/migration';
import { appTransaction, newEntity, type AppEntity } from '../lib/appStore';
import { deviceOwner, preferences, savePreferences, useDeviceOwner, useLanguage } from '../lib/appContext';
import { MODELS, fingerprint, importModel, formatBytes } from '../mobile/models';
import { APP_ORIGIN, MOBILE_ORIGIN, connectMigration, validateManifest, type MigrationReader, type MigrationManifest } from '../mobile/migrationChannel';
import { PortableDocumentSchema, RuntimeStateSchema } from '../../../../packages/schemas/src';
import { ChatRecovery } from '../lib/chatRecovery';
import Button from '../components/ui/Button';
import { useConfirm } from '../components/ui/Dialog';
import type { MobileData } from '../mobile/types';
import '../mobile/migration.css';

export async function importMobile(data:MobileData,hash:string,owner=deviceOwner()) {
  const job='mobile-import:'+owner+':'+hash;
  return appTransaction<{sessions:{id:string;draft:string}[];repeated:boolean}>(['entities','meta'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),store=tx.objectStore('entities'),request=meta.get(job);
    request.onsuccess=()=>{
      if(deviceOwner()!==owner){tx.abort();return;}
      if(request.result){done({...request.result,repeated:true});return;}
      const sequence=meta.get('message-sequence:'+owner);
      sequence.onsuccess=()=>{
        try{
        let number=sequence.result??0;
        const records:AppEntity[]=[],sessions:{id:string;draft:string}[]=[],characters=new Map<string,string>();
        const addCharacter=(character:MobileData['characters'][number])=>{
          const key=JSON.stringify([character.id,character.name,character.prompt,character.intro]);
          if(characters.has(key))return characters.get(key)!;
          const id=crypto.randomUUID(),document=PortableDocumentSchema.parse({name:character.name,data:{personality:character.prompt,first_mes:character.intro}});
          characters.set(key,id);
          records.push(newEntity('character',id,{storage_policy:'local',rating:'general',document,versions:{'1':document},migration:{hash,legacy_id:character.id}},owner));
          return id;
        };
        for(const character of data.characters)addCharacter(character);
        for(const source of data.conversations) {
          const id=crypto.randomUUID(),characterId=addCharacter(source.character);
          const messages=source.messages.map(m=>({id:++number,uuid:crypto.randomUUID(),revision:1,role:m.role,content:m.content,created_at:source.updatedAt,model_id:source.modelId,
            imported_state:m.state??'complete',legacy_id:m.id}));
          records.push(newEntity('conversation',id,{storage_policy:'local',rating:'general',title:source.title,settings:{session_id:id,system_prompt:'',temperature:.8,
            character_id:characterId,library_binding:{character:{id:characterId,revision:1},profile:null,lorebooks:[],expression_asset_id:null}},
            messages,memories:[],summaries:[],memory_enabled:false,state:RuntimeStateSchema.parse({session_id:id}),migrated_draft:source.draft,
            migration:{hash,legacy_id:source.id,revision:1,model_id:source.modelId}},owner));
          sessions.push({id,draft:source.draft});
        }
        if(!Number.isSafeInteger(number)){tx.abort();return;}
        if(deviceOwner()!==owner){tx.abort();return;}
        for(const record of records)store.add({...record,owner,revision:1});
        const result={sessions,repeated:false};meta.put(number,'message-sequence:'+owner);meta.put(result,job);done(result);
        }catch{tx.abort();}
      };
    };
  });
}
export default function Migration() {
  const language=useLanguage(),en=language==='en',owner=useDeviceOwner();
  const [preview,setPreview]=useState<ReturnType<typeof parseMigration>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [manifest,setManifest]=useState<MigrationManifest|null>(null),[selected,setSelected]=useState<string[]>([]),[progress,setProgress]=useState('');
  const connection=useRef<{reader?:MigrationReader;abort:AbortController}|null>(null),previewOwner=useRef(owner);
  useEffect(()=>()=>{connection.current?.abort.abort();connection.current=null;},[]);
  useEffect(()=>{connection.current?.abort.abort();connection.current=null;setPreview(null);setManifest(null);setSelected([]);setBusy(false);setProgress('');},[owner]);
  const models=manifest?.models.flatMap(source=>{const m=MODELS.find(m=>m.id===source.id&&fingerprint(m)===source.fingerprint);return m?[m]:[];})??[];
  const [dialog,confirm]=useConfirm();
  return <div className="k-page k-migration">{dialog}<h1>{en?'Import from Mobile':'以前のMobileから移行'}</h1>
    <label>{en?'Language':'表示言語'}<select aria-label={en?'Language':'表示言語'} value={language} onChange={e=>savePreferences({...preferences(),language:e.target.value as 'ja'|'en'})}><option value="ja">日本語</option><option value="en">English</option></select></label>
    <p>{en?'Create device-only copies. Original data stays on Mobile. Direct transfer keeps conversations and models in this browser.':'端末限定のコピーを作ります。元のMobileデータは残ります。直接転送では会話とモデルをCloudへ送りません。'}</p>
    {location.pathname!=='/migration/'?<p><a href="/migration/">{en?'Open direct transfer':'直接転送の専用画面を開く'}</a></p>:<>
      <Button disabled={busy||location.origin!==APP_ORIGIN} onClick={async()=>{
        connection.current?.abort.abort();const abort=new AbortController();connection.current={abort};
        setBusy(true);setError('');setMessage('');setPreview(null);setManifest(null);setSelected([]);setProgress(en?'Allow transfer in the Mobile window.':'Mobileの画面で転送を許可してください。');
        const token=crypto.randomUUID().replaceAll('-',''),popup=window.open(MOBILE_ORIGIN+'/migration/#'+token,'_blank','popup,width=620,height=720');
        try{
          if(!popup)throw Error(en?'Allow popups or use a file below.':'ポップアップを許可するか、下のファイル方式を利用してください。');
          const reader=await connectMigration(popup,MOBILE_ORIGIN,token,abort.signal);connection.current={abort,reader};
          const info=validateManifest(await reader.request('manifest')),parsed=parseMigration(await reader.backup(info));
          if(owner!==deviceOwner()||abort.signal.aborted)throw Error('Account changed / アカウントが切り替わりました');
          previewOwner.current=owner;setPreview(parsed);setManifest(info);setProgress('');
        }catch(error){abort.abort();setError(String(error));setProgress('');}finally{setBusy(false);}
      }}>{en?'Connect to old Mobile':'以前のMobileに接続'}</Button>
      {location.origin!==APP_ORIGIN&&<p>{en?'Direct transfer is available on app.kyalulu.com. This preview supports file import.':'直接転送はapp.kyalulu.comで利用できます。このプレビューではファイルを取り込めます。'}</p>}
      <p>{en?'Keep both windows open. If they cannot connect, use a migration file.':'両方の画面を開いたままにしてください。接続できない場合は移行ファイルを利用できます。'}</p>
    </>}
    <p><a href="https://mobile.kyalulu.com/?migrate=1" target="_blank" rel="noreferrer">{en?'Export on the old Mobile':'以前のMobileで書き出す'}</a></p>
    <label>{en?'Migration file':'移行用ファイル'}<input type="file" accept="application/json,.json" disabled={busy} onChange={async e=>{
      const file=e.target.files?.[0];e.target.value='';setError('');setPreview(null);if(!file)return;
      connection.current?.abort.abort();connection.current=null;setManifest(null);setSelected([]);
      const fileOwner=owner;setBusy(true);
      try{if(file.size>40*1024**2)throw Error('40 MiB limit');const parsed=parseMigration(await file.text());if(fileOwner!==deviceOwner())throw Error('Account changed');previewOwner.current=fileOwner;setPreview(parsed);}catch(e){setError(String(e));}finally{setBusy(false);}
    }}/></label>
    {preview&&<><p>{preview.data.characters.length} {en?'characters':'キャラ'} · {preview.data.conversations.length} {en?'conversations':'件の会話'} · SHA-256 {preview.sha256.slice(0,16)}</p>
      {models.map(m=><label key={m.id} style={{display:'block'}}><input type="checkbox" disabled={busy} checked={selected.includes(m.id)} onChange={e=>setSelected(e.target.checked?[...selected,m.id]:selected.filter(id=>id!==m.id))}/>{m.name} · {formatBytes(m.files.reduce((n,f)=>n+f.bytes,0))}</label>)}
      {!!manifest&&manifest.models.length>models.length&&<p>{en?'Models with different registered revisions must be downloaded again.':'登録版が異なるモデルは再取得が必要です。'}</p>}
      <Button disabled={busy} onClick={async()=>{
        if(!await confirm({title:en?'Import a general-audience backup?':'一般向けのバックアップを取り込みますか？',description:en?'A device-only copy is created. Existing data is never replaced.':'端末限定のコピーを作ります。既存のデータは置き換えません。'}))return;
        setBusy(true);setError('');setMessage('');
        try{
          if(previewOwner.current!==deviceOwner())throw Error('Account changed / アカウントが切り替わりました');
          const result=await importMobile(preview.data,preview.sha256,previewOwner.current);
          if(previewOwner.current!==deviceOwner())throw Error('Account changed');
          for(const session of result.sessions)if(session.draft){const recovery=new ChatRecovery(localStorage,`device:${previewOwner.current}`,session.id);recovery.read();if(localStorage.getItem(recovery.key)===null)recovery.draft(session.draft);}
          setMessage(en?'Conversations imported. Original data is unchanged.':'会話を取り込みました。元のデータは変更していません。');
          const current=connection.current;
          if(selected.length&&!current?.reader)throw Error('Reconnect to transfer models / モデル転送には再接続してください');
          for(const model of models.filter(m=>selected.includes(m.id))){
            if(owner!==deviceOwner())throw Error('Account changed');
            await importModel(model,current!.abort.signal,(f,offset)=>current!.reader!.chunk({kind:'model',model:model.id,sha256:f.sha256,offset},f.bytes),(loaded,total)=>setProgress(model.name+': '+Math.round(loaded/total*100)+'%'));
          }
          setProgress('');connection.current?.reader?.close();
        }
        catch(e){setError(String(e));}finally{setBusy(false);}
      }}>{en?'Import':'取り込む'}</Button></>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
    {progress&&<p role="status">{progress}</p>}
    {busy&&<Button onClick={()=>{connection.current?.abort.abort();}}>{en?'Cancel transfer':'転送を中止'}</Button>}
    <p><a href="/device/#/chats">{en?'Open device-only chats':'端末限定の会話を開く'}</a></p>
  </div>;
}
