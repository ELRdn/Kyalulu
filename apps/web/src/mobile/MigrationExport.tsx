import { useEffect, useRef, useState } from 'react';
import { loadData, parseBackup } from './store';
import { migrationEnvelope, migrationHash } from './migration';
import { MODELS, fingerprint, readyModels, openModelFile } from './models';
import { APP_ORIGIN, MIGRATION_CHUNK, MIGRATION_LIMIT, serveMigration, trustedMigrationEvent } from './migrationChannel';
import Button from '../components/ui/Button';
import './migration.css';

export default function MigrationExport() {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [status,setStatus]=useState(''),consented=useRef(false);
  const token=location.hash.slice(1),direct=location.pathname==='/migration/'&&!!window.opener&&/^[a-f0-9]{32}$/.test(token);
  useEffect(()=>{
    let stop:(()=>void)|undefined,active=true,connected=false;
    const receive=async(event:MessageEvent)=>{
      if(!consented.current||connected||!trustedMigrationEvent(event,window.opener,APP_ORIGIN,token,'kyalulu-migration-connect')||event.ports.length!==1)return;
      connected=true;const port=event.ports[0];
      try{
        const data=parseBackup(JSON.stringify(await loadData()));
        const backup=new TextEncoder().encode(JSON.stringify(migrationEnvelope(data)));
        if(backup.length>MIGRATION_LIMIT)throw Error('40 MiB limit / ファイル方式で移行してください');
        const ready=await readyModels(),models=MODELS.filter(m=>ready.has(m.id)),files=new Map<string,File>();
        if(!active){port.close();return;}
        stop=serveMigration(port,{revision:1,backup:{bytes:backup.length,sha256:migrationHash(backup)},models:models.map(m=>({id:m.id,fingerprint:fingerprint(m)}))},async request=>{
          let file:Blob=new Blob([backup]);
          if(request.kind==='model'){
            const model=models.find(m=>m.id===request.model),descriptor=model?.files.find(f=>f.sha256===request.sha256);
            if(!model||!descriptor)throw Error('Unregistered model file');
            const key=model.id+':'+descriptor.sha256;
            if(!files.has(key))files.set(key,await openModelFile(model,descriptor));
            file=files.get(key)!;if(file.size!==descriptor.bytes)throw Error('Source model size changed');
          }
          if(request.offset>=file.size)throw Error('Invalid migration offset');
          return new Uint8Array(await file.slice(request.offset,request.offset+MIGRATION_CHUNK).arrayBuffer());
        },()=>{files.clear();if(active){setBusy(false);setStatus('接続を終了しました。必要なら統合アプリで再接続してください。 / Connection closed; reconnect in the app if needed.');}});
        setStatus('統合アプリで内容を確認してください。この画面は転送が終わるまで開いてください。 / Review in the app; keep this window open.');
      }catch(error){port.close();if(active){setError(String(error));setBusy(false);}}
    };
    window.addEventListener('message',receive);
    return()=>{active=false;window.removeEventListener('message',receive);stop?.();};
  },[token]);
  return <main className="k-migration"><h1>Kyaluluへの移行</h1>
    <p>以前のキャラ・会話・下書きを書き出します。元の保存データは削除しません。</p>
    <p>直接転送は同じブラウザの統合アプリだけに送ります。会話とモデルをCloudへアップロードしません。 / Direct transfer stays in this browser; nothing is uploaded to Cloud.</p>
    {direct&&<Button disabled={busy} onClick={()=>{
      consented.current=true;setBusy(true);setError('');
      window.opener.postMessage({type:'kyalulu-migration-ready',token},APP_ORIGIN);
      setStatus('統合アプリに接続中… / Connecting…');
    }}>会話・保存済みモデルの転送を許可 / Allow transfer</Button>}
    {!direct&&<p>直接転送は統合アプリの移行画面から開始してください。接続できない場合はファイル方式を使えます。 / Start direct transfer in the app, or export a file below.</p>}
    <Button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{
      const envelope=migrationEnvelope(await loadData()),url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download='kyalulu-mobile-migration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(e){setError(String(e));}finally{setBusy(false);}}}>移行用ファイルを書き出す</Button>
    <p>ファイル方式にモデルは含まれません。統合アプリで再取得してください。 / File exports omit models; download them again in the app.</p>
    <p><a href="https://app.kyalulu.com/migration/" rel="noreferrer">統合アプリで取り込む / Open import</a></p>
    <p><a href="/">以前のMobileへ戻る</a></p>{status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}
  </main>;
}
