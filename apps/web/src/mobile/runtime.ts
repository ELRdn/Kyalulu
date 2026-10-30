import type { ChatTurn, Measurement } from './types';

type Event={id:number;type:string;text?:string;omitted?:number;measurement?:Measurement;error?:string;backend?:string};
type Pending={resolve:(v:Event)=>void;reject:(e:Error)=>void;event?:(e:Event)=>void};
export class MobileRuntime {
  private worker:Worker|null=null;
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
  load(modelId:string,cpu=false,base=new URL(import.meta.env.BASE_URL,document.baseURI).href) {return this.call('load',{modelId,cpu,base});}
  generate(messages:ChatTurn[],event:(e:Event)=>void,settings:Record<string,unknown>={},responseGrammar?:string) {
    return this.call('generate',{messages,settings,...(responseGrammar?{responseGrammar}:{})},event);
  }
  stop(){this.worker?.postMessage({type:'stop'});}
  async unload(){if(this.worker)await this.call('unload',{});}
  reset(reason='推論を終了しました。') {
    this.worker?.terminate();this.worker=null;
    for(const p of this.pending.values())p.reject(Error(reason));this.pending.clear();
  }
}
