import { migrationHash } from './migration';

export const MIGRATION_CHUNK = 1024 ** 2;
export const MIGRATION_LIMIT = 40 * 1024 ** 2;
export const MOBILE_ORIGIN = 'https://mobile.kyalulu.com';
export const APP_ORIGIN = 'https://app.kyalulu.com';
export type MigrationManifest = { revision:1; backup:{bytes:number;sha256:string}; models:{id:string;fingerprint:string}[] };
export type ChunkRequest = {kind:'backup'|'model';model?:string;sha256?:string;offset:number};
export function validateManifest(value:any):MigrationManifest {
  if(value?.revision!==1||!Number.isSafeInteger(value.backup?.bytes)||value.backup.bytes<1||value.backup.bytes>MIGRATION_LIMIT||
    !/^[a-f0-9]{64}$/.test(value.backup.sha256)||!Array.isArray(value.models)||value.models.length>100||
    value.models.some((m:any)=>!m||typeof m.id!=='string'||!/^[a-z0-9-]{1,100}$/.test(m.id)||typeof m.fingerprint!=='string'||m.fingerprint.length>100000)||
    new Set(value.models.map((m:any)=>m.id)).size!==value.models.length)throw Error('Invalid migration manifest / 移行情報が不正です');
  return value;
}
export function trustedMigrationEvent(event:MessageEvent,source:Window|null,origin:string,token:string,type:string) {
  return source!==null&&/^[a-f0-9]{32}$/.test(token)&&event.source===source&&event.origin===origin&&event.data?.type===type&&event.data.token===token;
}
export class MigrationReader {
  private sequence=0;
  private pending?:{id:number;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
  private closed=false;
  constructor(private port:MessagePort,private signal:AbortSignal) {
    port.onmessage=event=>{
      const pending=this.pending;
      if(!pending||event.data?.id!==pending.id){this.close(Error('Migration reply out of order'));return;}
      clearTimeout(pending.timer);this.pending=undefined;
      if(typeof event.data.error==='string'){pending.reject(Error(event.data.error));this.close();}
      else pending.resolve(event.data.value);
    };
    port.onmessageerror=()=>this.close(Error('Invalid migration reply'));
    signal.addEventListener('abort',this.abort,{once:true});
    if(signal.aborted)this.abort();
  }
  private abort=()=>this.close(Error('Migration cancelled / 移行を中止しました'));
  request(op:'manifest'|'read',request?:ChunkRequest):Promise<any> {
    if(this.closed||this.signal.aborted)return Promise.reject(Error('Migration connection closed / 再接続してください'));
    if(this.pending)return Promise.reject(Error('Concurrent migration request'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,timer=setTimeout(()=>this.close(Error('Migration timed out / 移行元を開いて再接続してください')),30000);
      this.pending={id,resolve,reject,timer};
      try{this.port.postMessage({id,op,...request});}catch{this.close(Error('Migration send failed'));}
    });
  }
  async chunk(request:ChunkRequest,bytes:number) {
    const value=await this.request('read',request),expected=Math.min(MIGRATION_CHUNK,bytes-request.offset);
    if(!(value instanceof Uint8Array)||expected<=0||value.byteLength!==expected){this.close();throw Error('Migration chunk size mismatch');}
    return value;
  }
  async backup(manifest:MigrationManifest) {
    const bytes=new Uint8Array(manifest.backup.bytes);
    for(let offset=0;offset<bytes.length;offset+=MIGRATION_CHUNK)bytes.set(await this.chunk({kind:'backup',offset},bytes.length),offset);
    if(migrationHash(bytes)!==manifest.backup.sha256){this.close();throw Error('Migration SHA-256 mismatch');}
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  close(error=Error('Migration connection closed')) {
    if(this.closed)return;this.closed=true;
    this.signal.removeEventListener('abort',this.abort);
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=undefined;}
    this.port.postMessage({op:'close'});this.port.close();
  }
}
export function connectMigration(popup:Window,origin:string,token:string,signal:AbortSignal) {
  return new Promise<MigrationReader>((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);signal.removeEventListener('abort',abort);};
    const abort=()=>{cleanup();reject(Error('Migration cancelled / 移行を中止しました'));};
    const receive=(event:MessageEvent)=>{
      if(!trustedMigrationEvent(event,popup,origin,token,'kyalulu-migration-ready'))return;
      const channel=new MessageChannel();
      const reader=new MigrationReader(channel.port1,signal);
      try{popup.postMessage({type:'kyalulu-migration-connect',token},origin,[channel.port2]);cleanup();resolve(reader);}
      catch(error){reader.close();cleanup();reject(error);}
    };
    const timer=setTimeout(()=>{cleanup();reject(Error('Migration timed out / 移行元で転送を許可してください'));},300000);
    window.addEventListener('message',receive);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
export function serveMigration(port:MessagePort,manifest:MigrationManifest,read:(request:ChunkRequest)=>Promise<Uint8Array>,closed:()=>void) {
  let busy=false,stopped=false,last=0,timer:ReturnType<typeof setTimeout>;
  const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);port.close();closed();};
  const touch=()=>{clearTimeout(timer);timer=setTimeout(stop,300000);};touch();
  port.onmessage=async event=>{
    if(event.data?.op==='close'){stop();return;}
    const {id,op,...request}=event.data??{};
    if(busy||!Number.isSafeInteger(id)||id!==last+1){stop();return;}
    last=id;busy=true;touch();
    try{
      if(op==='manifest')port.postMessage({id,value:manifest});
      else if(op==='read'){
        if(!['backup','model'].includes(request.kind)||!Number.isSafeInteger(request.offset)||request.offset<0||request.offset%MIGRATION_CHUNK)throw Error('Invalid migration offset');
        const value=await read(request);
        if(value.byteLength<1||value.byteLength>MIGRATION_CHUNK)throw Error('Invalid migration chunk');
        port.postMessage({id,value},[value.buffer]);
      }else throw Error('Invalid migration request');
    }catch{port.postMessage({id,error:'Migration read failed / 元データを読み取れません。書き出し方式を利用してください。'});stop();}
    finally{busy=false;}
  };
  port.onmessageerror=stop;
  return stop;
}
