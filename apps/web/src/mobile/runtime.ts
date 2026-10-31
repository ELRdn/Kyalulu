import type { ChatTurn, Measurement, MobileModel } from './types';
import { MODELS } from './models';
import { admitGGUFTurns, validateTurns } from './context';
import { sampling } from './sampling';

type Event={id:number;type:string;text?:string;omitted?:number;measurement?:Measurement;error?:string;backend?:string};
type Pending={resolve:(v:Event)=>void;reject:(e:Error)=>void;event?:(e:Event)=>void};
export class MobileRuntime {
  private worker:Worker|null=null;
  private loadedModel:MobileModel|null=null;
  private pending=new Map<number,Pending>();
  private sequence=0;
  private ensure() {
    if(!this.worker) {
      this.worker=new Worker(new URL('./runtime.worker.ts',import.meta.url),{type:'module'});
      this.worker.onmessage=({data}:MessageEvent<Event>)=>{
        const p=this.pending.get(data.id);if(!p)return;
        if(data.type==='error'){this.pending.delete(data.id);p.reject(new Error(data.error));}
        else if(data.type==='done'){this.pending.delete(data.id);p.resolve(data);}
        else p.event?.(data);
      };
      this.worker.onerror=()=>this.reset('推論Workerが停止しました。メモリ不足やGPUの切断を確認し、モデルを読み直してください。');
      this.worker.onmessageerror=()=>this.reset('推論Workerとの通信に失敗しました。');
    }
    return this.worker;
  }
  private call(type:string,data:Record<string,unknown>,event?:(e:Event)=>void) {
    const worker=this.ensure(),id=++this.sequence;
    return new Promise<Event>((resolve,reject)=>{this.pending.set(id,{resolve,reject,event});worker.postMessage({id,type,...data});});
  }
  async load(modelId:string,cpu=false,base=new URL(import.meta.env.BASE_URL,document.baseURI).href) {
    this.loadedModel=null;
    const result=await this.call('load',{modelId,cpu,base});
    this.loadedModel=MODELS.find(model=>model.id===modelId)??null;return result;
  }
  async generate(messages:ChatTurn[],event:(e:Event)=>void,settings:Record<string,unknown>={},responseGrammar?:string) {
    const model=this.loadedModel;if(!model)throw Error('モデルを読み込んでください。');
    validateTurns(messages);
    const data={settings,...(responseGrammar?{responseGrammar}:{})};
    if(model.runtime==='gguf'){
      const {applied}=sampling(model,settings),fitted=admitGGUFTurns(messages,applied.max_tokens);
      return this.call('generate-admitted',{...data,messages:fitted.messages,admission:{modelId:model.id,
        modelRevision:model.distributionRevision??model.revision,outputTokens:applied.max_tokens,omitted:fitted.omitted}},event);
    }
    return this.call('generate',{...data,messages},event);
  }
  stop(){this.worker?.postMessage({type:'stop'});}
  async unload(){if(this.worker)await this.call('unload',{});this.loadedModel=null;}
  reset(reason='推論を終了しました。') {
    this.worker?.terminate();this.worker=null;this.loadedModel=null;
    for(const p of this.pending.values())p.reject(Error(reason));this.pending.clear();
  }
}
