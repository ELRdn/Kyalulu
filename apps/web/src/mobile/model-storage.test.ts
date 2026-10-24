import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { MobileModel, ModelStatus } from './types';
import { downloadModel, importModel, readyModels, fingerprint } from './models';
import * as store from './store';

const state={statuses:new Map<string,ModelStatus>()};
const bodies=['first valid shard','second valid shard'];
const model:MobileModel={id:'storage-test',name:'test',runtime:'gguf',repo:'test/test',source:'https://huggingface.co/test/test',
  revision:'a'.repeat(40),license:'MIT',temperature:1,topK:64,topP:.95,note:'',
  files:bodies.map((body,i)=>({path:`${i}.gguf`,url:`https://huggingface.co/test/test/resolve/${'a'.repeat(40)}/${i}.gguf`,bytes:body.length,
    sha256:createHash('sha256').update(body).digest('hex')}))};
let files:Map<string,File>;
let quota:number;
beforeEach(()=>{
  state.statuses.clear();files=new Map();quota=1024**3;
  vi.spyOn(store,'modelStatuses').mockImplementation(async()=>[...state.statuses.values()]);
  vi.spyOn(store,'saveModelStatus').mockImplementation(async(s)=>{state.statuses.set(s.id,s);return s.id;});
  vi.spyOn(store,'deleteModelStatus').mockImplementation(async(id)=>{state.statuses.delete(id);});
  const dir={
    getDirectoryHandle:async()=>dir,
    getFileHandle:async(name:string,options?:{create?:boolean})=>{
      if(!files.has(name)&&!options?.create)throw new DOMException('missing','NotFoundError');
      return {getFile:async()=>files.get(name),createWritable:async()=>{
        const chunks:Uint8Array<ArrayBuffer>[]=[];
        return {write:async(chunk:Uint8Array)=>{chunks.push(chunk.slice());},abort:async()=>{},
          close:async()=>{files.set(name,new File(chunks,name));}};
      }};
    },
    removeEntry:async(name:string)=>{files.delete(name);},
  };
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,options:any,action?:()=>Promise<void>)=>(action??options)()},storage:{getDirectory:async()=>dir,estimate:async()=>({quota,usage:0}),persist:async()=>true}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('imports verified model chunks without network and reuses valid shards after an interruption',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const read=vi.fn(async(f,offset)=>{
    if(f===model.files[1])throw Error('source closed');
    return new TextEncoder().encode(bodies[0]).slice(offset,offset+1024**2);
  });
  await expect(importModel(model,new AbortController().signal,read,()=>{})).rejects.toThrow('source closed');
  expect(files.has(model.files[0].sha256)).toBe(true);expect(state.statuses.size).toBe(0);
  const resumed=vi.fn(async(f,offset)=>new TextEncoder().encode(bodies[model.files.indexOf(f)]).slice(offset,offset+1024**2));
  await importModel(model,new AbortController().signal,resumed,()=>{});
  expect(resumed).toHaveBeenCalledTimes(1);expect(resumed.mock.calls[0][0]).toBe(model.files[1]);
  expect(state.statuses.get(model.id)?.fingerprint).toBe(fingerprint(model));expect(fetcher).not.toHaveBeenCalled();
});
it('never replaces an existing file or marks readiness on a corrupt model transfer',async()=>{
  const original=new File(['old damaged shard'],model.files[0].sha256);files.set(model.files[0].sha256,original);
  state.statuses.set(model.id,{id:model.id,fingerprint:fingerprint(model),verifiedAt:'old'});
  await expect(importModel(model,new AbortController().signal,async()=>new Uint8Array(model.files[0].bytes),()=>{})).rejects.toThrow('SHA-256');
  expect(files.get(model.files[0].sha256)).toBe(original);expect(state.statuses.size).toBe(0);
});
it('does not read source files when quota is insufficient and preserves complete verified models',async()=>{
  quota=32;const read=vi.fn();
  await expect(importModel(model,new AbortController().signal,read,()=>{})).rejects.toThrow('Storage full');expect(read).not.toHaveBeenCalled();
  for(const [i,f] of model.files.entries())files.set(f.sha256,new File([bodies[i]],f.sha256));
  await importModel(model,new AbortController().signal,read,()=>{});
  expect(read).not.toHaveBeenCalled();expect(state.statuses.get(model.id)?.fingerprint).toBe(fingerprint(model));
});

it('reuses only verified complete shards after interruption and commits readiness last',async()=>{
  const fetcher=vi.fn(async(url:string)=>new Response(bodies[model.files.findIndex(f=>f.url===url)]));
  vi.stubGlobal('fetch',fetcher);
  const abort=new AbortController();
  await expect(downloadModel(model,abort.signal,(n)=>{if(n>model.files[0].bytes)abort.abort();})).rejects.toThrow();
  expect(state.statuses.size).toBe(0);
  expect(files.has(model.files[0].sha256)).toBe(true);
  expect(files.has(model.files[1].sha256)).toBe(false);
  fetcher.mockClear();
  await downloadModel(model,new AbortController().signal,()=>{});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(model.files[1].url);
  expect(state.statuses.has(model.id)).toBe(true);
});

it('rejects same-size corruption without marking the model ready',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('X'.repeat(bodies[0].length))));
  await expect(downloadModel(model,new AbortController().signal,()=>{})).rejects.toThrow('SHA-256');
  expect(state.statuses.size).toBe(0);expect(files.size).toBe(0);
  expect((await readyModels()).size).toBe(0);
});

it('fails before fetching when storage quota is insufficient',async()=>{
  quota=32;const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(downloadModel(model,new AbortController().signal,()=>{})).rejects.toThrow('容量');
  expect(fetcher).not.toHaveBeenCalled();expect(state.statuses.size).toBe(0);
});

it('explains missing OPFS support without starting a download',async()=>{
  vi.stubGlobal('navigator',{storage:{}});const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  await expect(downloadModel(model,new AbortController().signal,()=>{})).rejects.toThrow('OPFS');
  expect(fetcher).not.toHaveBeenCalled();
});
