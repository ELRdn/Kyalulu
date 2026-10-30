import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { harness } from './idbHarness.test-support';

const fixture=vi.hoisted(()=>({owner:'catalog-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),
  reads:[] as {name:string;key:any}[],writes:0,switchOnSource:null as string|null}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  allEntities:vi.fn(()=>{throw Error('Scope catalog must not restore allEntities');}),
  entity:vi.fn(()=>{throw Error('Scope catalog must not restore entity');}),
}));
import { appTransaction,newEntity,writeEntity,allEntities,entity,type AppEntity } from './appStore';
import { writeParts,type Parts } from './segmentedStorage';
import { readDeviceMemoryDomain,commitDeviceMemoryDomain } from './deviceMemoryStore';
import { bindMemoryScope,memoryBinding,memoryIdentity,ownScopeMemories,type MemoryPolicy } from './deviceMemoryScopes';
import { deviceMemoryScope } from './deviceScopedMemory';
import { scopedMemoryRoute } from './deviceScopedMemoryApi';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';

const OWNER='catalog-owner';
const identity=memoryIdentity({character_id:'character',world_id:'harbor'},{character_id:'1',persona_id:null,world_id:'1'});
const resolve=vi.fn(async()=>identity);
const conversation=vi.fn(async():Promise<AppEntity>=>{throw Error('Scope catalog must not call the conversation callback');});
const stored=(id:string,owner=OWNER)=>fixture.records.get(JSON.stringify([owner,id]));
const partKey=(id:string,ref:Parts,index:number,owner=OWNER)=>JSON.stringify([owner,'entity',id,ref.token,index]);
const physical=()=>({records:JSON.stringify([...fixture.records]),meta:JSON.stringify([...fixture.meta]),
  parts:[...fixture.parts].map(([key,bytes])=>[key,bytes.length,new Sha256().update(bytes).digest()])});

beforeEach(()=>{
  fixture.owner=OWNER;fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.reads=[];fixture.writes=0;fixture.switchOnSource=null;
  vi.clearAllMocks();
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
  vi.stubGlobal('indexedDB',{open:()=>{
    const open:any={result:{close:()=>{},transaction:(_stores:string[],mode:string)=>{
      let transaction:any;
      const complete=harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,(tx:any)=>{
        transaction=tx;
        // Keep the harness transaction alive until real appTransaction installs its handlers and action.
        tx.objectStore('meta').get('catalog-test:keepalive');
      },{write:()=>{fixture.writes++;},read:(_mode,name,key)=>{
        fixture.reads.push({name,key});
        if(name==='parts'&&key[1]==='entity'&&key[2]===fixture.switchOnSource){
          fixture.switchOnSource=null;fixture.owner='other-owner';
        }
      }});
      void complete.then(()=>transaction.oncomplete?.(),()=>transaction.onabort?.());
      return transaction;
    }}};
    queueMicrotask(()=>open.onsuccess?.());return open;
  }});
});
afterEach(()=>{
  expect.soft(allEntities).not.toHaveBeenCalled();expect.soft(entity).not.toHaveBeenCalled();
  expect.soft(conversation).not.toHaveBeenCalled();
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

function source(id:string,policy:MemoryPolicy='local',statuses:('active'|'deleted')[]=['active'],date='2026-10-20'){
  const memories=statuses.map((status,index)=>({id:'memory-'+id+'-'+index,scope:id,type:'semantic',content:'Fact '+id+' '+index,
    origin:'user',supported:null,status,source_session_id:id,source_message_ids:[1],version:1,created_at:date,updated_at:date}));
  return newEntity('conversation',id,{storage_policy:policy,settings:{session_id:id,character_id:'character'},memories,
    messages:Array.from({length:82},(_,index)=>({id:index+1,uuid:id+'-'+index,role:index%2?'assistant':'user',
      content:'Keep 茶🙂 history '.repeat(1100),before:{memories:index?memories:[]},after:{memories}}))},OWNER);
}
const persist=(record:AppEntity)=>appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,record,'put',done));
async function bound(id:string,policy:MemoryPolicy,statuses:('active'|'deleted')[],date:string){
  const session=source(id,policy,statuses,date);session.payload.memory_scope_mode='world';
  const domain=await readDeviceMemoryDomain(OWNER,policy),binding=bindMemoryScope(domain,session,identity);
  session.payload.memories=ownScopeMemories(domain.pools[binding.scope],id);
  await commitDeviceMemoryDomain(OWNER,policy,domain,[{id,revision:0}],[session]);
  return deviceMemoryScope(policy,memoryBinding(domain,id).scope);
}
function restart(){
  // Reopen persisted maps, with no in-memory seed objects available to the route.
  const snapshot=structuredClone({records:fixture.records,meta:fixture.meta,parts:fixture.parts});
  fixture.records=snapshot.records;fixture.meta=snapshot.meta;fixture.parts=snapshot.parts;
  fixture.owner=OWNER;fixture.reads=[];fixture.writes=0;
}
function catalog(){
  const owner=fixture.owner,url=new URL('https://app.test/api/memory/scopes');
  return scopedMemoryRoute(url.pathname,'GET',{},url,owner,conversation,resolve);
}
async function mixed(){
  const local=await bound('local-a','local',['active','deleted'],'2026-10-22');
  expect(await bound('local-b','local',['active'],'2026-10-21')).toBe(local);
  const sync=await bound('sync-a','sync',['deleted','active'],'2026-10-29');
  await persist(source('legacy','local',['active','deleted','active'],'2026-10-25'));
  const inline=source('inline','sync',['deleted'],'2026-10-23');inline.payload.messages=inline.payload.messages.slice(0,1);
  fixture.records.set(JSON.stringify([OWNER,inline.id]),structuredClone(inline));
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>{
    const changes=[{id:'legacy',kind:'conversation',base_revision:0,deleted:false,payload:{original:true}}];
    writeParts(tx,[OWNER,'outbox','fixed'],changes,changesParts=>{
      const put=tx.objectStore('meta').put({request_id:'fixed-unsent',changes:changes.map(row=>({...row,payload:{}})),count:1,changesParts},'sync:'+OWNER+':outbox');
      put.onsuccess=()=>done();
    });
  });
  for(const id of ['local-a','local-b','sync-a','legacy'])expect(stored(id).payloadParts.chunks).toBeGreaterThan(1);
  restart();return {local,sync};
}
function observeParsers(){
  const finish=JsonStream.prototype.finish,feed=JsonStream.prototype.feed;
  const completed:{id:string;retained:number;total:number|undefined}[]=[],peaks:number[]=[];
  vi.spyOn(JsonStream.prototype,'feed').mockImplementation(function(this:JsonStream,bytes:Uint8Array){
    const result=feed.call(this,bytes),root=(this as any).root;
    if(Array.isArray(root?.messages))peaks.push(root.messages.length);return result;
  });
  vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){
    const root=finish.call(this);
    if(Array.isArray(root?.messages)){
      completed.push({id:root.settings.session_id,retained:root.messages.length,total:this.totalMessages});
      fixture.reads.push({name:'parsed',key:root.settings.session_id});
    }
    return root;
  });
  return {completed,peaks};
}

it('handles empty and legacy-only catalogs directly without a fallback route',async()=>{
  for(const legacy of [false,true]){
    if(legacy)await persist(source('legacy','local',['active','deleted'],'2026-10-25'));
    restart();const before=physical(),response=await catalog();expect(response).not.toBeNull();
    expect(await response!.json()).toEqual({scopes:legacy?[{scope:'legacy',active:1,total:2,updated_at:'2026-10-25'}]:[]});
    expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
  }
});

it('lists mixed legacy and bound local/sync scopes with exact counts/sort and zero retained messages in every source parser',async()=>{
  const {local,sync}=await mixed(),before=physical(),parsers=observeParsers();
  const response=await catalog();expect(response).not.toBeNull();
  expect(await response!.json()).toEqual({scopes:[
    {scope:sync,active:1,total:2,updated_at:'2026-10-29'},
    {scope:'legacy',active:2,total:3,updated_at:'2026-10-25'},
    {scope:'inline',active:0,total:1,updated_at:'2026-10-23'},
    {scope:local,active:2,total:3,updated_at:'2026-10-22'},
  ]});
  expect(new Set(parsers.completed.map(p=>p.id))).toEqual(new Set(['local-a','local-b','sync-a','legacy']));
  expect(parsers.completed.every(p=>p.retained===0&&p.total===82)).toBe(true);
  expect(parsers.peaks.length).toBeGreaterThan(0);expect(Math.max(...parsers.peaks)).toBe(0);
  const cursors=fixture.reads.map((read,index)=>({...read,index})).filter(read=>read.name==='cursor');
  expect(cursors.map(read=>read.key)).toEqual(['inline','legacy','local-a','local-b','sync-a',null]);
  for(let index=0;index<cursors.length-1;index++){
    const current=cursors[index],next=cursors[index+1],ref=stored(current.key).payloadParts;
    if(!ref)continue;
    const between=fixture.reads.slice(current.index+1,next.index);
    expect(between.filter(read=>read.name==='parts'&&read.key[1]==='entity'&&read.key[2]===current.key).map(read=>read.key[4]))
      .toEqual(Array.from({length:ref.chunks},(_,part)=>part));
    expect(between).toContainEqual({name:'parsed',key:current.key});
  }
  expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
});

it('filters corrupt non-conversation, deleted and other-owner bodies before any part read',async()=>{
  const {local}=await mixed();
  const character=newEntity('character','00-character',{document:{name:'Unrelated'},text:'x'.repeat(1100000)},OWNER);
  await persist(character);
  const deleted=source('01-deleted');deleted.deleted=true;await persist(deleted);
  const foreign=source('legacy');foreign.owner='other-owner';await persist(foreign);
  for(const record of [character,deleted,foreign]){
    const ref=stored(record.id,record.owner).payloadParts;
    fixture.parts.delete(partKey(record.id,ref,ref.chunks-1,record.owner));
  }
  restart();const before=physical(),response=await catalog();expect(response).not.toBeNull();
  const scopes=(await response!.json()).scopes;
  expect(scopes).toHaveLength(4);expect(scopes.find((row:any)=>row.scope===local)).toMatchObject({active:2,total:3});
  expect(scopes.map((row:any)=>row.scope)).not.toContain('01-deleted');
  expect(fixture.reads.filter(read=>read.name==='parts'&&read.key[1]==='entity').every(read=>
    read.key[0]===OWNER&&!['00-character','01-deleted'].includes(read.key[2]))).toBe(true);
  expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
});

it.each(['missing','checksum'] as const)('rejects a legacy source with a %s final part and leaves entities/domains/outbox untouched',async damage=>{
  await mixed();const ref=stored('legacy').payloadParts as Parts,key=partKey('legacy',ref,ref.chunks-1);
  if(damage==='missing')fixture.parts.delete(key);
  else fixture.parts.get(key)[fixture.parts.get(key).length-1]^=1;
  restart();const before=physical();
  await expect(catalog()).rejects.toThrow();
  expect(fixture.reads).toContainEqual({name:'parts',key:[OWNER,'entity','legacy',ref.token,0]});
  expect(fixture.reads).toContainEqual({name:'parts',key:[OWNER,'entity','legacy',ref.token,ref.chunks-1]});
  expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
});

it('rejects an owner switch during legacy parsing, preserves storage and can reopen the original owner snapshot',async()=>{
  await mixed();const before=physical();fixture.switchOnSource='legacy';
  await expect(catalog()).rejects.toThrow();
  expect(fixture.owner).toBe('other-owner');expect(fixture.switchOnSource).toBeNull();
  expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
  const reads=fixture.reads.filter(read=>read.name==='parts'&&read.key[1]==='entity'&&read.key[2]==='legacy');
  expect(reads.map(read=>read.key[4])).toEqual([0]);
  fixture.owner=OWNER;fixture.switchOnSource=null;
  const response=await catalog();expect(response).not.toBeNull();expect((await response!.json()).scopes).toHaveLength(4);
  expect(physical()).toEqual(before);
});

it('validates the legacy source through its closing JSON after 82 messages even with a valid parts checksum',async()=>{
  await mixed();const ref=stored('legacy').payloadParts as Parts;
  const bytes=new Uint8Array(ref.size);let offset=0;
  for(let index=0;index<ref.chunks;index++){const part=fixture.parts.get(partKey('legacy',ref,index));bytes.set(part,offset);offset+=part.length;}
  // Keep all early memory metadata valid, but remove the closing object delimiter.
  expect(bytes.at(-1)).toBe('}'.charCodeAt(0));bytes[bytes.length-1]=' '.charCodeAt(0);
  const tail=fixture.parts.get(partKey('legacy',ref,ref.chunks-1));tail[tail.length-1]=' '.charCodeAt(0);
  ref.sha256=new Sha256().update(bytes).digest();
  restart();const before=physical(),parsers=observeParsers();
  await expect(catalog()).rejects.toThrow();
  const replacement=stored('legacy').payloadParts;
  expect(fixture.reads).toContainEqual({name:'parts',key:[OWNER,'entity','legacy',replacement.token,replacement.chunks-1]});
  expect(parsers.completed.some(parser=>parser.id==='legacy')).toBe(false);
  expect(fixture.writes).toBe(0);expect(physical()).toEqual(before);
});
