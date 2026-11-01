/** Real app/API/IndexedDB; synthetic OPFS metadata and inference Worker, no weights. */
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from '../App';
import RuntimeGate from '../components/RuntimeGate';
import { ThemeProvider } from '../lib/theme';
import { deviceFetch } from '../lib/deviceApi';
import { allEntities } from '../lib/appStore';
import { preferences, savePreferences, rememberOwner, generationBusy } from '../lib/appContext';
import { MODELS, fingerprint } from '../mobile/models';
import { saveModelStatus } from '../mobile/store';
import '../index.css';

let calls=0,paused=false,pausedLoad=false,loading=false,terminations=0;
let heldCall=0,resumeGeneration:(()=>void)|undefined;
export const holdAtCall=(value:number)=>{heldCall=value;};
export const resume=()=>{resumeGeneration?.();resumeGeneration=undefined;};
export const pause=(value:boolean)=>{paused=value;};
export const pauseLoad=(value:boolean)=>{pausedLoad=value;};
export const owner=(value:string)=>rememberOwner(value);
export const language=(value:'ja'|'en')=>savePreferences({...preferences(),language:value});
export const state=async()=>({calls,busy:generationBusy(),entities:await allEntities()});
export const status=()=>({calls,busy:generationBusy(),loading,terminations});
export async function api(path:string,body?:unknown){
  const response=await deviceFetch(path,body===undefined?{}:{method:'POST',body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
export async function mount(node:HTMLElement,lang:'ja'|'en',theme:'light'|'dark') {
  localStorage.setItem('kyalulu-execution-target','device');localStorage.setItem('my-zeta-theme',theme);
  rememberOwner('device-research-fixture');language(lang);
  await prepareRuntime();
  const root=createRoot(node);root.render(<ThemeProvider><HashRouter><RuntimeGate><App /></RuntimeGate></HashRouter></ThemeProvider>);
  return ()=>root.unmount();
}
export async function prepareRuntime() {
  const models=MODELS.filter(model=>['kyalulu-iq3m','google-mobile-onnx'].includes(model.id));
  const directory={getDirectoryHandle:async()=>directory,getFileHandle:async(name:string)=>({getFile:async()=>{
    const file=models.flatMap(model=>model.files).find(f=>f.sha256===name);if(!file)throw Error('Unknown fictional file');return {size:file.bytes};
  }})};
  Object.defineProperty(navigator.storage,'getDirectory',{configurable:true,value:async()=>directory});
  for(const model of models)await saveModelStatus({id:model.id,fingerprint:fingerprint(model),verifiedAt:new Date().toISOString()});
  Object.defineProperty(globalThis,'Worker',{configurable:true,value:class {
    onmessage:((event:MessageEvent)=>void)|null=null;
    pending:any=null;
    admitting:any=null;
    emit(data:any){queueMicrotask(()=>this.onmessage?.(new MessageEvent('message',{data})));}
    postMessage(data:any){
      if(data.type==='load'&&pausedLoad){loading=true;this.pending=data;return;}
      if(data.type==='stop'){
        const active=this.pending??this.admitting;
        if(active)this.emit({id:active.id,type:'done',stopped:true,measurement:{}});
        this.pending=null;this.admitting=null;resumeGeneration=undefined;return;
      }
      if(data.type==='generate-admitted'){
        this.admitting=data;
        // Synthetic transport count only; no tokenizer or native budget proof.
        this.emit({id:data.id,type:'admission-count',mandatoryInputTokens:70});return;
      }
      if(data.type==='admission-window'){
        const admitted=this.admitting;if(!admitted||admitted.id!==data.id)return;
        this.admitting=null;
        if(['modelId','modelRevision','outputTokens'].some(key=>data.admission?.[key]!==admitted.admission[key])
          ||Object.hasOwn(data,'history')===Object.hasOwn(data,'error')
          ||(Object.hasOwn(data,'error')?typeof data.error!=='string':!Array.isArray(data.history))){
          this.emit({id:data.id,type:'error',error:'Invalid synthetic admission window'});return;
        }
        if(Object.hasOwn(data,'error')){this.emit({id:data.id,type:'error',error:data.error});return;}
        const runs=[...admitted.mandatory,...data.history].sort((a,b)=>a.run-b.run);
        if(runs.some((run,i)=>!Number.isSafeInteger(run.run)||run.run<0||run.run>=admitted.admission.originalRuns
          ||i>0&&run.run===runs[i-1].run)){
          this.emit({id:data.id,type:'error',error:'Invalid synthetic admission runs'});return;
        }
        this.emit({id:data.id,type:'context',omitted:admitted.admission.originalRuns-runs.length});
        data={...admitted,type:'generate',messages:runs.map(({role,content})=>({role,content}))};
      }
      if(data.type==='generate'){
        calls++;this.pending=data;if(paused)return;
        const reply=()=>{
          if(this.pending!==data)return;this.pending=null;
          const user=data.messages.filter((m:any)=>m.role==='user').at(-1).content;
          this.emit({id:data.id,type:'delta',text:JSON.stringify({reply:'Fixtureの応答です。',state_update:{location:'図書館',time:'昼',mood:'calm',active_scene:'読書',relationship_state:{stage:'friend',tone:'warm',unresolved_conflict:false}},memory_proposals:[{type:'semantic',content:user.slice(0,100),source_kind:'user_statement'}]})});
          this.emit({id:data.id,type:'done',measurement:{firstTokenMs:2,generationMs:5,tokensPerSecond:10,backend:'synthetic'}});
        };
        if(calls===heldCall){resumeGeneration=reply;return;}
        reply();
      }else this.emit({id:data.id,type:'done'});
    }
    terminate(){terminations++;loading=false;this.pending=null;this.admitting=null;resumeGeneration=undefined;}
  }});
}
