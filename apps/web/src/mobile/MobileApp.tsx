import { useEffect, useRef, useState } from 'react';
import Button from '../components/ui/Button';
import Composer from '../components/ui/Composer';
import { Input, Textarea } from '../components/ui/Input';
import MessageContent from '../components/MessageContent';
import MobileAppStatus from '../components/MobileAppStatus';
import { ThemeProvider, useTheme } from '../lib/theme';
import AppErrorBoundary from '../components/AppErrorBoundary';
import { MODELS, downloadModel, formatBytes, modelBytes, readyModels, removeModel } from './models';
import { initialData, loadData, newConversation, parseBackup, saveData } from './store';
import { conversationTurns } from './context';
import { MobileRuntime } from './runtime';
import type { Character, Conversation, Measurement, MobileData } from './types';
import './mobile.css';

function exportJson(value:unknown,name:string) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function Mobile() {
  const {theme,toggle}=useTheme();
  const [data,setData]=useState<MobileData>(initialData);
  const dataRef=useRef(data);
  const saveQueue=useRef(Promise.resolve<unknown>(undefined));
  const [opened,setOpened]=useState(false);
  const [tab,setTab]=useState<'chats'|'characters'|'models'|'settings'>('chats');
  const [sessionId,setSessionId]=useState<string|null>(null);
  const [editing,setEditing]=useState<Character|null>(null);
  const [saved,setSaved]=useState(new Set<string>());
  const [error,setError]=useState('');
  const [loadState,setLoadState]=useState<'idle'|'loading'|'ready'|'generating'>('idle');
  const [loadedModel,setLoadedModel]=useState('');
  const [maintenance,setMaintenance]=useState(false);
  const [backend,setBackend]=useState('');
  const [download,setDownload]=useState<{id:string;loaded:number;total:number;stage:string}|null>(null);
  const [omitted,setOmitted]=useState(0);
  const [measurements,setMeasurements]=useState<Measurement[]>([]);
  const [storage,setStorage]=useState<{usage?:number;quota?:number;persisted?:boolean}>({});
  const runtime=useRef<MobileRuntime|null>(null);
  const downloading=useRef<AbortController|null>(null);
  const operation=useRef(false);
  const loadEpoch=useRef(0);
  const generationStopped=useRef(false);
  const streamSave=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const session=data.conversations.find(s=>s.id===sessionId);
  const selected=MODELS.find(m=>m.id===data.selectedModel)??MODELS[0];
  const locked=maintenance||loadState==='loading'||loadState==='generating';

  function commit(next:MobileData,persist=true) {
    dataRef.current=next;setData(next);
    if(persist)saveQueue.current=saveQueue.current.then(()=>saveData(next)).catch(e=>setError(e.message));
  }
  function updateConversation(id:string,change:(s:Conversation)=>Conversation,persist=true) {
    commit({...dataRef.current,conversations:dataRef.current.conversations.map(s=>s.id===id?change(s):s)},persist);
  }
  const refresh=async()=>{
    setSaved(await readyModels());
    setStorage({...await navigator.storage.estimate(),persisted:await navigator.storage.persisted?.()});
  };
  useEffect(()=>{
    let mounted=true;
    runtime.current=new MobileRuntime();
    void loadData().then(d=>{if(mounted){dataRef.current=d;setData(d);setOpened(true);}}).catch(e=>setError(e.message));
    void refresh().catch(e=>setError(e.message));
    const visible=()=>{if(document.visibilityState==='visible')void refresh().catch(e=>setError(e.message));else commit(dataRef.current);};
    document.addEventListener('visibilitychange',visible);
    return()=>{mounted=false;runtime.current?.reset();downloading.current?.abort();clearTimeout(streamSave.current);document.removeEventListener('visibilitychange',visible);};
  },[]);
  useEffect(()=>{
    const beforeUnload=(e:BeforeUnloadEvent)=>{if(locked||download){e.preventDefault();}};
    window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[locked,download]);
  async function selectModel(id:string) {
    if(operation.current||download)return;
    operation.current=true;setMaintenance(true);
    try{await runtime.current?.unload();setLoadState('idle');setLoadedModel('');commit({...dataRef.current,selectedModel:id});}
    catch(e){setError(String(e));}finally{operation.current=false;setMaintenance(false);}
  }
  async function load(cpu=false) {
    if(operation.current||download)return;
    const attempt=++loadEpoch.current;
    operation.current=true;setLoadState('loading');setError('');
    try {
      const result=await runtime.current!.load(selected.id,cpu);
      if(attempt!==loadEpoch.current)return;
      setLoadedModel(selected.id);setBackend(result.backend??'');setLoadState('ready');
    } catch(e){if(attempt===loadEpoch.current){setLoadState('idle');setLoadedModel('');setError(e instanceof Error?e.message:String(e));}}
    finally{if(attempt===loadEpoch.current)operation.current=false;}
  }
  async function acquire(id:string) {
    if(downloading.current||operation.current)return;
    const m=MODELS.find(m=>m.id===id)!;
    if(!window.confirm(`${m.name}\n${formatBytes(modelBytes(m))}をこのブラウザの端末ストレージへ保存します。Wi-Fiでの取得をおすすめします。開始しますか？`))return;
    const abort=new AbortController();downloading.current=abort;setError('');
    setDownload({id,loaded:0,total:modelBytes(m),stage:'保存先を確認中'});
    try{await downloadModel(m,abort.signal,(loaded,total,stage)=>setDownload({id,loaded,total,stage}));}
    catch(e){setError(abort.signal.aborted?'取得を中止しました。完成済みファイルは再利用できます。':e instanceof Error?e.message:String(e));}
    finally{downloading.current=null;setDownload(null);await refresh().catch(e=>setError(e.message));}
  }
  async function eraseModel(id:string) {
    if(operation.current||download)return;
    if(!window.confirm('この端末のモデルファイルを削除します。キャラと会話は残ります。'))return;
    operation.current=true;setMaintenance(true);
    try {
      if(loadedModel===id){await runtime.current?.unload();setLoadedModel('');setLoadState('idle');}
      await removeModel(MODELS.find(m=>m.id===id)!);await refresh();
    }catch(e){setError(String(e));}finally{operation.current=false;setMaintenance(false);}
  }
  function start(c:Character) {
    const s=newConversation(c,dataRef.current.selectedModel);
    commit({...dataRef.current,conversations:[s,...dataRef.current.conversations]});setSessionId(s.id);setOmitted(0);setTab('chats');
  }
  async function send() {
    if(!session?.draft.trim()||operation.current||loadState!=='ready'||loadedModel!==selected.id)return;
    operation.current=true;generationStopped.current=false;setLoadState('generating');setError('');setOmitted(0);
    const current=dataRef.current.conversations.find(s=>s.id===sessionId)!;
    const assistantId=crypto.randomUUID();
    const next:Conversation={...current,modelId:selected.id,draft:'',updatedAt:new Date().toISOString(),
      messages:[...current.messages,{id:crypto.randomUUID(),role:'user',content:current.draft.trim(),state:'complete'}]};
    let failed=false;
    updateConversation(next.id,()=>({...next,messages:[...next.messages,{id:assistantId,role:'assistant',content:'',state:'interrupted'}]}));
    try {
      const result=await runtime.current!.generate(conversationTurns(next),event=>{
        if(event.type==='context'){setOmitted(event.omitted??0);return;}
        if(event.type!=='delta'||!event.text)return;
        updateConversation(next.id,s=>({...s,messages:s.messages.map(m=>m.id===assistantId?{...m,content:m.content+event.text}:m)}),false);
        if(!streamSave.current)streamSave.current=setTimeout(()=>{streamSave.current=undefined;commit(dataRef.current);},500);
      });
      if(result.measurement)setMeasurements(m=>[...m,result.measurement!]);
      updateConversation(next.id,s=>({...s,messages:s.messages.map(m=>m.id===assistantId?{...m,state:generationStopped.current?'stopped':'complete'}:m)}));
    } catch(e){failed=true;setLoadedModel('');setError(e instanceof Error?e.message:String(e));commit(dataRef.current);}
    finally{clearTimeout(streamSave.current);streamSave.current=undefined;operation.current=false;setLoadState(failed?'idle':'ready');}
  }
  function stop(){generationStopped.current=true;runtime.current?.stop();}
  function cancelLoad(){++loadEpoch.current;runtime.current?.reset();operation.current=false;setLoadState('idle');setLoadedModel('');}
  function deleteConversation(id:string) {
    if(!window.confirm('この会話を端末から削除しますか？'))return;
    commit({...dataRef.current,conversations:dataRef.current.conversations.filter(s=>s.id!==id)});if(sessionId===id)setSessionId(null);
  }
  function saveCharacter(e:React.FormEvent) {
    e.preventDefault();if(!editing?.name.trim())return;
    const next={...editing,name:editing.name.trim()};
    const exists=dataRef.current.characters.some(c=>c.id===next.id);
    commit({...dataRef.current,characters:exists?dataRef.current.characters.map(c=>c.id===next.id?next:c):[...dataRef.current.characters,next]});setEditing(null);
  }
  async function restore(file:File) {
    if(operation.current||download)return;
    operation.current=true;setMaintenance(true);
    try {
      if(file.size>32*1024**2)throw Error('バックアップは32MiB以下にしてください。');
      const next=parseBackup(await file.text());
      if(!MODELS.some(m=>m.id===next.selectedModel))next.selectedModel=MODELS[0].id;
      if(!window.confirm('この端末のキャラと会話をバックアップで置き換えます。現在のデータは先に書き出してください。復元しますか？'))return;
      await runtime.current?.unload();commit(next);setSessionId(null);setLoadedModel('');setLoadState('idle');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{operation.current=false;setMaintenance(false);}
  }
  if(!opened)return <main className="m-app"><h1>Kyalulu Mobile</h1><p role={error?'alert':'status'}>{error||'端末のデータを開いています…'}</p></main>;
  return <div className="m-app">
    <MobileAppStatus local />
    <header className="m-header"><div><span className="m-brand">Kyalulu <small>Mobile</small></span><p>きみのスマホで、いつでも会話。</p></div><button type="button" className="m-theme" aria-label={`${theme==='light'?'ダーク':'ライト'}テーマにする`} onClick={toggle}>{theme==='light'?'☾':'☀'}</button></header>
    <nav className="m-nav" aria-label="メインメニュー">{(['chats','characters','models','settings'] as const).map((t,i)=><button key={t} type="button" aria-current={tab===t?'page':undefined} onClick={()=>setTab(t)}>{['会話','キャラ','モデル','保存・設定'][i]}</button>)}</nav>
    {error&&<div className="m-error" role="alert"><span>{error}</span><button type="button" onClick={()=>setError('')} aria-label="通知を閉じる">×</button></div>}
    <main>
      {tab==='settings'&&!locked&&!download&&<p><a href="?migrate=1">統合アプリへ移行する</a></p>}
      {tab==='chats'&&<>
        <section className="m-model-bar" aria-label="使用モデル"><label>使用モデル<select value={selected.id} disabled={locked||!!download} onChange={e=>void selectModel(e.target.value)}>{MODELS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <span role="status">{loadState==='ready'||loadState==='generating'?`${backend} · 読み込み済み`:loadState==='loading'?'モデルを初期化中…':saved.has(selected.id)?'端末に保存済み':'ダウンロードが必要です'}</span>
          {loadState==='loading'?<Button variant="secondary" onClick={cancelLoad}>読み込みを中止</Button>:loadState==='idle'&&saved.has(selected.id)?<><Button onClick={()=>void load()} disabled={!!download}>モデルを読み込む</Button>{selected.runtime==='gguf'&&<Button variant="secondary" onClick={()=>void load(true)} disabled={!!download}>CPUで読み込む</Button>}</>:!saved.has(selected.id)&&<Button onClick={()=>setTab('models')}>モデルを準備</Button>}
        </section>
        {!session?<section className="m-section"><h1>どのキャラと話す？</h1><div className="m-grid">{data.characters.map(c=><article className="m-card" key={c.id}><h2>{c.name}</h2><p>{c.intro||'新しい会話をはじめよう。'}</p><Button disabled={locked} onClick={()=>start(c)}>会話をはじめる</Button></article>)}</div>
          <h2>これまでの会話</h2>{!data.conversations.length&&<p className="m-muted">会話はこの端末に保存されます。</p>}
          <div className="m-sessions">{[...data.conversations].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(s=><div key={s.id}><button type="button" disabled={locked} onClick={()=>{setSessionId(s.id);setOmitted(0);}}><strong>{s.title}</strong><span>{s.messages.at(-1)?.content.slice(0,70)||'メッセージはまだありません'}</span></button><Button variant="ghost" size="sm" disabled={locked} onClick={()=>deleteConversation(s.id)}>削除</Button></div>)}</div>
        </section>:<section className="m-chat" aria-label={`${session.character.name}との会話`}>
          <div className="m-chat-title"><Button variant="ghost" disabled={locked} onClick={()=>setSessionId(null)}>← 会話一覧</Button><h1>{session.character.name}</h1></div>
          <p className="m-muted">キャラ設定は会話開始時の内容です。キャラを編集した後は、新しい会話で反映されます。</p>
          <div className="m-messages" aria-live="polite" aria-relevant="additions text">{session.messages.map(m=><article key={m.id} className={`m-message m-message--${m.role}`}><span className="m-message-name">{m.role==='user'?'あなた':session.character.name}</span>{m.role==='assistant'?<MessageContent allowImages={false} content={m.content|| (loadState==='generating'?'…':'応答を取得できませんでした。')} isStreaming={loadState==='generating'&&m===session.messages.at(-1)}/>:<p>{m.content}</p>}{m.state==='interrupted'&&loadState!=='generating'&&<small>生成が中断されました。この途中の応答は次の送信に含めません。</small>}{m.state==='stopped'&&<small>停止した応答</small>}</article>)}</div>
          {omitted>0&&<p role="status" className="m-notice">コンテキストに収めるため、以前のメッセージ{omitted}件を今回の入力から省略しました。保存履歴は残っています。</p>}
          <div className="m-composer"><Composer value={session.draft} onChange={draft=>updateConversation(session.id,s=>({...s,draft}))} onSend={()=>void send()} onStop={stop} streaming={loadState==='generating'} sendBlocked={loadState!=='ready'||loadedModel!==selected.id} placeholder={loadState==='ready'?'きみの言葉を入力してね…':'先にモデルを読み込んでください'}/></div>
        </section>}
      </>}
      {tab==='characters'&&<section className="m-section"><div className="m-section-title"><h1>きみのキャラクター</h1><Button disabled={locked} onClick={()=>setEditing({id:crypto.randomUUID(),name:'',prompt:'',intro:''})}>キャラを作る</Button></div>
        {editing?<form className="m-card m-form" onSubmit={saveCharacter}><label>名前<Input value={editing.name} maxLength={100} required onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label>キャラクター設定<Textarea value={editing.prompt} maxLength={32000} rows={8} onChange={e=>setEditing({...editing,prompt:e.target.value})}/></label><label>最初のメッセージ<Textarea value={editing.intro} maxLength={16000} rows={3} onChange={e=>setEditing({...editing,intro:e.target.value})}/></label><div className="m-actions"><Button type="submit" disabled={locked}>保存</Button><Button type="button" variant="secondary" onClick={()=>setEditing(null)}>戻る</Button></div></form>:<div className="m-grid">{data.characters.map(c=><article className="m-card" key={c.id}><h2>{c.name}</h2><p className="m-clamp">{c.prompt}</p><div className="m-actions"><Button disabled={locked} onClick={()=>start(c)}>話す</Button><Button variant="secondary" disabled={locked} onClick={()=>setEditing({...c})}>編集</Button><Button variant="ghost" disabled={locked||data.characters.length===1} onClick={()=>{if(window.confirm('キャラを削除しますか？ このキャラの会話は残ります。')){commit({...dataRef.current,characters:dataRef.current.characters.filter(x=>x.id!==c.id)});}}}>削除</Button></div></article>)}</div>}
      </section>}
      {tab==='models'&&<section className="m-section"><h1>スマホにAIを迎えよう</h1><p>最初の取得には通信が必要です。対応する端末では、準備後に同じブラウザでオフライン会話できます。ダウンロード容量と必要メモリは異なります。</p>
        <div className="m-grid">{MODELS.map(m=><article className="m-card" key={m.id}><div className="m-model-kind">{m.runtime==='gguf'?'GGUF':'ONNX q2f16'} · {saved.has(m.id)?'保存済み':m.files.length?'未保存':'配布準備中'}</div><h2>{m.name}</h2><p className="m-size">{m.files.length?formatBytes(modelBytes(m)):'サイズ未確定'}</p>{m.note&&<p>{m.note}</p>}<p className="m-muted">実機の速度・安定性・省RAM動作は検証中です。</p><div className="m-actions"><Button disabled={locked||!!download||!m.files.length} onClick={()=>saved.has(m.id)?void selectModel(m.id).then(()=>setTab('chats')):void acquire(m.id)}>{saved.has(m.id)?'このモデルを選ぶ':'ダウンロード'}</Button><Button variant="ghost" disabled={locked||!!download} onClick={()=>void eraseModel(m.id)}>端末から削除</Button></div>
          {download?.id===m.id&&<div role="status"><progress value={download.loaded} max={download.total}/><p>{download.stage} · {formatBytes(download.loaded)} / {formatBytes(download.total)}</p><Button variant="secondary" onClick={()=>downloading.current?.abort()}>中止</Button></div>}
          <details><summary>出所と保存情報</summary><p><a href={m.source} target="_blank" rel="noreferrer">元モデル</a> · <a href={`https://huggingface.co/${m.repo}/tree/${m.revision}`} target="_blank" rel="noreferrer">実行モデルの出所</a></p><p>{m.license} · 端末内のOPFSへ保存</p><p className="m-mono">revision: {m.revision}</p><p>{m.runtime==='gguf'?'テンソルを保持した分割版を使用します。PLEは削除しません。':'テキスト用のモデルとトークナイザーを保存します。画像・音声エンコーダーは取得しません。'}</p></details>
        </article>)}</div>
      </section>}
      {tab==='settings'&&<section className="m-section"><h1>この端末の保存・設定</h1><div className="m-card"><h2>端末内のデータ</h2><p>キャラと会話はIndexedDB、モデルはOPFSに保存します。別のブラウザや端末とは共有されません。ブラウザのデータ削除で失われるため、会話は定期的に書き出してください。</p><p>ブラウザ保存領域：{storage.usage!==undefined?formatBytes(storage.usage):'未測定'} / {storage.quota!==undefined?formatBytes(storage.quota):'上限未測定'}</p><p>永続保存：{storage.persisted?'許可済み':'未許可（ブラウザにより削除される場合があります）'}</p><div className="m-actions"><Button disabled={locked||!!download} onClick={()=>exportJson(dataRef.current,`kyalulu-mobile-${new Date().toISOString().slice(0,10)}.json`)}>バックアップを書き出す</Button><label className="m-file">バックアップから復元<input type="file" accept="application/json,.json" disabled={locked||!!download} onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);e.target.value='';}}/></label></div></div>
        <div className="m-card"><h2>動作情報</h2><p>コンテキスト2,048トークン · 最大出力256トークン · Thinking OFF · 同時生成1件</p><p>モデルの重み・GPU・KVキャッシュ・物理メモリは、それぞれ別の測定対象です。測定できない値を0として扱いません。</p><p>WebGPU API：{'gpu' in navigator?'あり（実行可否はモデル読み込み時に判定）':'なし'}</p><p>1GB未満の物理常駐量は未認定です。WASMヒープと重み用バッファは、物理常駐量と異なります。</p>{measurements.at(-1)&&<details><summary>直近のメモリ測定</summary><p>WASMヒープ：{measurements.at(-1)!.wasmBytes===null?'未測定':formatBytes(measurements.at(-1)!.wasmBytes!)}</p><p>重み用バッファ合計：{measurements.at(-1)!.weightBufferBytes==null?'未測定':formatBytes(measurements.at(-1)!.weightBufferBytes!)}</p><p>PLEの行読み込み：{measurements.at(-1)!.pleLazy===null?'未測定':measurements.at(-1)!.pleLazy?'有効':'対象外／未確認'}</p><p>GPU全体・KVキャッシュ・物理常駐量：未測定</p></details>}<Button variant="secondary" disabled={!measurements.length} onClick={()=>exportJson({version:1,createdAt:new Date().toISOString(),measurements},'kyalulu-mobile-measurements.json')}>今回の実測をJSONで保存</Button>{measurements.at(-1)&&<p>直近：初回トークン {(measurements.at(-1)!.firstTokenMs===null?'未測定':(measurements.at(-1)!.firstTokenMs!/1000).toFixed(2))}秒 · 生成 {(measurements.at(-1)!.generationMs/1000).toFixed(2)}秒</p>}</div>
        <div className="m-card"><h2>プライバシー</h2><p>会話を推論サーバーへ送信しません。モデル取得時はHugging Face、アプリ取得時はCloudflareへ接続します。解析タグと自動クラウド切替はありません。</p></div>
      </section>}
    </main>
    <footer className="m-footer">Kyalulu Mobile · 端末内で動くキャラクターAI<br/><a href="source/kyalulu-mobile-source.zip">対応ソース</a> · <a href="licenses/AGPL-3.0.txt">AGPL-3.0</a></footer>
  </div>;
}
export default function MobileApp(){return <AppErrorBoundary><ThemeProvider><Mobile/></ThemeProvider></AppErrorBoundary>;}
