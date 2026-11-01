import type { ChatTurn, Measurement, MobileModel } from './types';
import { MODELS } from './models';
import { materializeGGUFRuns, planGGUFContext, selectGGUFHistory, validateTurns } from './context';
import { sampling } from './sampling';

type Event={id:number;type:string;text?:string;omitted?:number;measurement?:Measurement;error?:string;backend?:string;stopped?:boolean;mandatoryInputTokens?:number;mandatoryCountError?:string};
type Pending={resolve:(v:Event)=>void;reject:(e:Error)=>void;event?:(e:Event)=>void};
export class MobileRuntime {
  private worker:Worker|null=null;
  private loadedModel:MobileModel|null=null;
  private pending=new Map<number,Pending>();
  private sequence=0;
  private active:{id:number;cancelled:boolean}|null=null;
  private idle(){if(this.pending.size||this.active)throw Error('処理中です。停止してから操作してください。');}
  private ensure() {
    if(!this.worker) {
      this.worker=new Worker(new URL('./runtime.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data}:MessageEvent<Event>)=>{
        const p=this.pending.get(data.id);if(!p)return;
        if(data.type==='error'){this.pending.delete(data.id);p.reject(new Error(data.error));}
        else if(data.type==='done'){this.pending.delete(data.id);p.resolve(data);}
        else {try{p.event?.(data);}catch(error){this.reset(error instanceof Error?error.message:String(error));}}
      };
      this.worker.onerror=()=>this.reset('推論Workerが停止しました。メモリ不足やGPUの切断を確認し、モデルを読み直してください。');
      this.worker.onmessageerror=()=>this.reset('推論Workerとの通信に失敗しました。');
    }
    return this.worker;
  }
  private call(type:string,data:Record<string,unknown>,event?:(e:Event)=>void,id=++this.sequence) {
    const worker=this.ensure();
    return new Promise<Event>((resolve,reject)=>{
      this.pending.set(id,{resolve,reject,event});
      try{worker.postMessage({id,type,...data});}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  async load(modelId:string,cpu=false,base=new URL(import.meta.env.BASE_URL,document.baseURI).href) {
    this.idle();
    this.loadedModel=null;
    const result=await this.call('load',{modelId,cpu,base});
    this.loadedModel=MODELS.find(model=>model.id===modelId)??null;return result;
  }
  async generate(messages:ChatTurn[],event:(e:Event)=>void,settings:Record<string,unknown>={},responseGrammar?:string,signal?:AbortSignal) {
    this.idle();signal?.throwIfAborted();
    const model=this.loadedModel;if(!model)throw Error('モデルを読み込んでください。');
    validateTurns(messages);
    const operation={id:++this.sequence,cancelled:false};
    this.active=operation;
    const stop=()=>this.stop();signal?.addEventListener('abort',stop,{once:true});
    try {
      if(model.runtime!=='gguf')return await this.call('generate',{settings,messages,...(responseGrammar?{responseGrammar}:{})},event,operation.id);
      const {applied}=sampling(model,settings),snapshot=structuredClone(settings),plan=planGGUFContext(messages,applied.max_tokens);
      const fence={modelId:model.id,modelRevision:model.distributionRevision??model.revision,outputTokens:applied.max_tokens};
      let continued=false;
      return await this.call('generate-admitted',{settings:snapshot,...(responseGrammar?{responseGrammar}:{}),
        mandatory:materializeGGUFRuns(plan,plan.mandatory),admission:{...fence,originalRuns:plan.runs.length,newestUserRun:plan.newestUserRun}},e=>{
        if(e.type!=='admission-count'){event(e);return;}
        if(operation.cancelled||this.active!==operation)return;
        if(continued)throw Error('Duplicate admission count');continued=true;
        let window:Record<string,unknown>;
        try {
          if(e.mandatoryCountError!==undefined&&!plan.legacy)throw Error(e.mandatoryCountError);
          window={history:materializeGGUFRuns(plan,selectGGUFHistory(plan,e.mandatoryInputTokens))};
        }catch(error){window={error:error instanceof Error?error.message:String(error)};}
        this.worker!.postMessage({id:operation.id,type:'admission-window',admission:fence,...window});
      },operation.id);
    } finally {
      signal?.removeEventListener('abort',stop);if(this.active===operation)this.active=null;
    }
  }
  stop(){if(this.active){this.active.cancelled=true;try{this.worker?.postMessage({type:'stop',id:this.active.id});}catch{this.reset('推論Workerとの通信に失敗しました。');}}}
  async unload(){this.idle();if(this.worker)await this.call('unload',{});this.loadedModel=null;}
  reset(reason='推論を終了しました。') {
    this.worker?.terminate();this.worker=null;this.loadedModel=null;
    this.active=null;
    for(const p of this.pending.values())p.reject(Error(reason));this.pending.clear();
  }
}
