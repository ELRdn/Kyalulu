import { useEffect, useRef, useState } from 'react';
import { MODELS, readyModels, downloadModel, removeModel, modelBytes, formatBytes } from '../mobile/models';
import { useExecutionTarget, useLanguage, labels, preferences, savePreferences, useGenerationBusy } from '../lib/appContext';
import { Interests } from './UnifiedEntry';
import { RemoteConnections } from './RemoteSetup';
import Button from './ui/Button';
import { useConfirm } from './ui/Dialog';
import { Link } from 'react-router-dom';
import RuntimeSyncSettings from './RuntimeSyncSettings';
import { localTransferMessage } from '../lib/errors';

const stages:Record<string,string>={'保存済みファイルを検証中':'verifying','保存済みファイルを再利用':'reusing','ダウンロード中':'downloading','検証・保存完了':'complete'};
const stageLabels:Record<string,{ja:string;en:string}>={
  verifying:{ja:'保存済みファイルを検証中',en:'Verifying saved files'},reusing:{ja:'保存済みファイルを再利用',en:'Reusing saved files'},
  downloading:{ja:'ダウンロード中',en:'Downloading'},complete:{ja:'検証・保存完了',en:'Verified and saved'},
};

export default function DeviceSettings() {
  const target=useExecutionTarget(),language=useLanguage(),t=labels[language],en=language==='en',generation=useGenerationBusy();
  const [interests,setInterests]=useState(false),[ready,setReady]=useState(new Set<string>()),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [progress,setProgress]=useState({loaded:0,total:1,stage:''}),abort=useRef<AbortController|null>(null);
  const [dialog,confirm]=useConfirm();
  useEffect(()=>{if(target==='device')void readyModels().then(setReady).catch(e=>setError(String(e)));return()=>abort.current?.abort();},[target]);
  return <section className="k-section">{dialog}<h2 className="k-section__title">Kyalulu</h2>
    <label>{t.language}<select aria-label={t.language} value={language} onChange={e=>savePreferences({...preferences(),language:e.target.value as 'ja'|'en'})}><option value="ja">日本語</option><option value="en">English</option></select></label>
    <Button variant="secondary" onClick={()=>setInterests(v=>!v)}>{t.settings}</Button>
    {interests&&<Interests onDone={()=>setInterests(false)}/>}
    {target==='pc'&&<RemoteConnections/>}
    {target==='device'&&<RuntimeSyncSettings/>}
    {target==='device'&&<p><Link to="/research">{en?'On-device research and ratings':'端末内の比較・評価'}</Link></p>}
    {target==='device'&&<><p><Link to="/migration">{t.migration}</Link></p><h3>{t.prepare}</h3><div className="k-unified-models">{MODELS.map(model=><div className="k-unified-model" key={model.id}>
      <div><strong>{model.name}</strong><small>{formatBytes(modelBytes(model))} · {ready.has(model.id)?en?'Ready':'保存済み':model.runtime}</small></div>
      {busy===model.id?<Button variant="secondary" onClick={()=>abort.current?.abort()}>{en?'Cancel':'中止'}</Button>:<div className="k-unified-actions">
        <Button disabled={!!busy||generation||!model.files.length} onClick={async()=>{
          if(!await confirm({title:en?'Download this model?':'モデルをダウンロードしますか？',description:`${model.name} · ${formatBytes(modelBytes(model))} · Hugging Face`,confirmLabel:en?'Download':'ダウンロード',cancelLabel:en?'Cancel':'キャンセル'}))return;
          const controller=new AbortController();abort.current=controller;setBusy(model.id);setError('');
          try{await downloadModel(model,controller.signal,(loaded,total,stage)=>setProgress({loaded,total,stage:Object.hasOwn(stages,stage)?stages[stage]:stage}));setReady(await readyModels());}
          catch(e){if(!controller.signal.aborted)setError(String(e));}finally{setBusy('');}
        }}>{en?'Download':'ダウンロード'}</Button>
        {ready.has(model.id)&&<Button variant="ghost" disabled={!!busy||generation} onClick={async()=>{
          if(!await confirm({title:en?'Remove model?':'モデルを削除しますか？',description:en?'Conversations will be kept.':'会話は削除されません。',confirmLabel:en?'Remove':'削除',cancelLabel:en?'Cancel':'キャンセル',danger:true}))return;
          setBusy(model.id);try{await removeModel(model);setReady(await readyModels());}catch(e){setError(String(e));}finally{setBusy('');}
        }}>{en?'Remove':'削除'}</Button>}</div>}
      {busy===model.id&&<progress value={progress.loaded} max={progress.total} aria-label={Object.hasOwn(stageLabels,progress.stage)?stageLabels[progress.stage][language]:progress.stage}/>}
    </div>)}</div></>}
    {error&&<p role="alert">{localTransferMessage(error,language)}</p>}
  </section>;
}
