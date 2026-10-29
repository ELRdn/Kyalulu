import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppEntity } from './appStore';

const fixture=vi.hoisted(()=>({entities:new Map<string,any>(),meta:new Map<string,any>(),owner:'owner-a',failAt:0,reads:[] as string[]}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,generationBusy:()=>false}));
vi.mock('./transport',()=>({cloudFetch:vi.fn()}));
// Unit transaction harness: queued requests, owner ranges, commit and abort; browser quota remains an E2E gate.
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:async(owner:string)=>[...fixture.entities.values()].filter(e=>e.owner===owner).map(e=>structuredClone(e)),
  getMeta:async(key:string)=>{fixture.reads.push(key);return structuredClone(fixture.meta.get(key));},
  setMeta:async(key:string,value:any)=>{fixture.meta.set(key,structuredClone(value));},
  entity:async(id:string,owner:string)=>structuredClone(fixture.entities.get(JSON.stringify([owner,id]))),
  openEntity:async(id:string,owner:string)=>structuredClone(fixture.entities.get(JSON.stringify([owner,id]))),
  saveEntity:async(value:AppEntity,expected?:number)=>{
    const key=JSON.stringify([value.owner,value.id]),previous=fixture.entities.get(key);
    if(value.owner!==fixture.owner||expected!==undefined&&expected!==(previous?.revision??0))throw Error('Transaction aborted');
    const saved={...value,revision:(previous?.revision??0)+1,dirty:value.payload.storage_policy==='sync'};fixture.entities.set(key,structuredClone(saved));return saved;
  },
  trimOfflineCache:vi.fn().mockResolvedValue(undefined),
  appTransaction:(_stores:string[],_mode:string,action:any)=>new Promise((resolve,reject)=>{
    const entities=structuredClone(fixture.entities),meta=structuredClone(fixture.meta);
    let pending=0,aborted=false,finished=false,value:any,writes=0;
    const finish=()=>{if(!pending&&!finished){finished=true;if(aborted)reject(Error('Transaction aborted'));else{fixture.entities=entities;fixture.meta=meta;resolve(value);}}};
    const enqueue=(read:()=>any)=>{
      const request:any={};pending++;
      queueMicrotask(()=>{try{if(!aborted){request.result=structuredClone(read());request.onsuccess?.();}}catch{aborted=true;}finally{pending--;finish();}});
      return request;
    };
    const tx={abort:()=>{aborted=true;},objectStore:(name:string)=>{
      const map=name==='entities'?entities:meta,key=(k:any)=>name==='entities'?JSON.stringify(k):k;
      return {get:(k:any)=>{if(name==='meta')fixture.reads.push(String(k));return enqueue(()=>map.get(key(k)));},getAllKeys:()=>enqueue(()=>[...map.keys()]),getAll:(range:any)=>enqueue(()=>[...entities.values()].filter(e=>e.owner===range.lower[0])),
        openCursor:(range:any)=>{
          const matches=[...entities.values()].filter(e=>e.owner===range.lower[0]).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
          const request:any={};let index=0;
          const next=()=>{pending++;queueMicrotask(()=>{try{if(!aborted){request.result=index<matches.length?{value:structuredClone(matches[index++]),continue:next}:null;request.onsuccess?.();}}catch{aborted=true;}finally{pending--;finish();}});};
          next();return request;
        },
        index:()=>({openKeyCursor:(range:any)=>{
          const matches=[...meta.entries()].filter(([,value])=>value?.request_id===range.lower[0]&&value?.withdrawn===range.lower[1]).map(([key])=>key).sort();
          const request:any={};let index=0;
          const next=()=>{pending++;queueMicrotask(()=>{try{if(!aborted){request.result=index<matches.length?{primaryKey:matches[index++],continue:next}:null;request.onsuccess?.();}}catch{aborted=true;}finally{pending--;finish();}});};
          next();return request;
        }}),
        add:(v:any)=>{if(map.has(key([v.owner,v.id])))throw Error('Duplicate');if(fixture.failAt&&++writes===fixture.failAt)throw Error('Quota');map.set(key([v.owner,v.id]),structuredClone(v));},
        put:(v:any,k:any)=>{if(fixture.failAt&&++writes===fixture.failAt)throw Error('Quota');map.set(name==='entities'?key([v.owner,v.id]):k,structuredClone(v));},delete:(k:any)=>map.delete(key(k))};
    }};
    try{action(tx,(v:any)=>{value=v;});finish();}catch{aborted=true;finish();}
  }),
}));

import { acknowledgeEntity, receiveSyncPage, runtimeConsent, syncNow, syncState, reconfirmDeletion, hydrateConversation, setSyncConsent } from './appSync';
import { offlineStub, trimOfflineCache } from './appStore';
import { cloudFetch } from './transport';
import { importMobile } from '../pages/Migration';
import { initialData, newConversation } from '../mobile/store';
import { deviceFetch } from './deviceApi';
import { Sha256 } from '../mobile/sha256';
import sharedHistory from '../../../../tests/fixtures/unified-history.json';

const payload=()=>({storage_policy:'sync',rating:'general',settings:{session_id:'chat',library_binding:{character:{id:'character',revision:3}}},state:{session_id:'chat'},
  messages:[{id:1,uuid:'message',role:'user',content:'tea'}],memories:[],summaries:[],library_snapshots:{'character@3':{name:'Tea'}}});
const remote=(id='chat',revision=1)=>({id,kind:'conversation',revision,deleted:false,payload:payload()});
function local(id:string,owner='owner-a'):AppEntity {
  return {id,owner,kind:'conversation',revision:1,serverRevision:0,payload:{...payload(),settings:{session_id:id,library_binding:null}},dirty:false,deleted:false,pinned:false,opened:1};
}
const put=(e:AppEntity)=>fixture.entities.set(JSON.stringify([e.owner,e.id]),e);
const get=(id:string,owner='owner-a')=>fixture.entities.get(JSON.stringify([owner,id]));
beforeEach(()=>{
  fixture.entities=new Map();fixture.meta=new Map([['sync:owner-a:consent',true]]);fixture.owner='owner-a';fixture.failAt=0;fixture.reads=[];
  vi.stubGlobal('IDBKeyRange',{bound:(lower:any,upper:any)=>({lower,upper}),only:(value:any)=>({lower:value,upper:value})});
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,action:()=>any)=>action()}});
});

it('keeps a large browser outbox through a lost part receipt and resumes without duplicating the first part',async()=>{
  const current=local('chat');current.dirty=true;
  current.payload.messages=Array.from({length:28},(_,index)=>({id:index+1,uuid:'large-'+index,role:'user',content:'large fixture '.repeat(6000)}));
  put(current);
  const transfer='11111111-1111-4111-8111-111111111111',requests:string[]=[],parts:number[]=[];
  let next=0,lost=false,committed=false;
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    const value=init?.body?JSON.parse(String(init.body)):null;
    if(path==='/api/cloud/app/sync/transfers'){
      requests.push(value.request_id);expect(value.size).toBeGreaterThan(2_000_000);
      return new Response(JSON.stringify({transfer_id:transfer,next,chunk_bytes:1024*1024}));
    }
    if(path.includes('/parts/')){
      const index=Number(path.split('/').at(-1));parts.push(index);
      const raw=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
      expect(new Sha256().update(raw).digest()).toBe(value.sha256);next=index+1;
      if(!lost){lost=true;throw Error('fixture part response lost');}
      return new Response(JSON.stringify({next}));
    }
    if(path.endsWith('/commit')){committed=true;return new Response(JSON.stringify({changes:[{id:'chat',revision:1,deleted:false}]}));}
    return new Response(JSON.stringify({changes:[],cursor:committed?1:0,has_more:false}));
  });
  await syncNow('owner-a');
  const pending=fixture.meta.get('sync:owner-a:outbox');expect(pending).toBeTruthy();expect(get('chat').dirty).toBe(true);
  await syncNow('owner-a');
  expect(new Set(requests).size).toBe(1);expect(parts.filter(index=>index===0)).toHaveLength(1);
  expect(get('chat').dirty).toBe(false);expect(get('chat').payload.messages).toHaveLength(28);
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
});

it('stops a large browser body at the next part after consent is withdrawn',async()=>{
  const current=local('chat');current.dirty=true;
  current.payload.messages=Array.from({length:28},(_,index)=>({id:index+1,uuid:'large-'+index,role:'user',content:'large fixture '.repeat(6000)}));
  put(current);const parts:string[]=[];
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(path==='/api/cloud/app/sync/transfers')return new Response(JSON.stringify({transfer_id:'11111111-1111-4111-8111-111111111111',next:0,chunk_bytes:1024*1024}));
    if(path.includes('/parts/')){parts.push(path);await setSyncConsent('owner-a',false);return new Response(JSON.stringify({next:1}));}
    expect(path).not.toContain('/commit');
    return new Response(JSON.stringify({changes:[],cursor:0,has_more:false}));
  });
  await syncNow('owner-a');
  expect(parts).toHaveLength(1);expect(get('chat').dirty).toBe(true);
  expect(fixture.meta.get('sync:owner-a:outbox').withdrawn).toBe(true);expect(syncState().phase).toBe('off');
});

it.each([undefined,false,0])('checks only index keys during a large upload (legacy flag=%s)',async flag=>{
  const current=local('chat');current.dirty=true;
  current.payload.messages=Array.from({length:28},(_,index)=>({id:index+1,uuid:'guard-'+index,role:'user',content:'large fixture '.repeat(6000)}));
  put(current);
  const batch={request_id:'guard-large',withdrawn:flag,revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:structuredClone(current.payload),deleted:false}]};
  fixture.meta.set('sync:owner-a:outbox',batch);
  fixture.meta.set('sync:owner-0:outbox',{request_id:batch.request_id,withdrawn:0,private:'OTHER ACCOUNT BODY'});
  const counts:number[]=[],chunks:Uint8Array[]=[];let atBegin=0;
  const bodyReads=()=>fixture.reads.filter(key=>key==='sync:owner-a:outbox').length;
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(path==='/api/cloud/app/sync/transfers'){
      expect(fixture.meta.get('sync:owner-a:outbox').withdrawn).toBe(0);atBegin=bodyReads();
      return new Response(JSON.stringify({transfer_id:'11111111-1111-4111-8111-111111111111',next:0,chunk_bytes:1024*1024}));
    }
    if(path.includes('/parts/')){
      counts.push(bodyReads());const part=JSON.parse(String(init?.body));chunks.push(Uint8Array.from(atob(part.data),c=>c.charCodeAt(0)));
      return new Response(JSON.stringify({next:chunks.length}));
    }
    if(path.endsWith('/commit')){counts.push(bodyReads());return new Response(JSON.stringify({changes:[{id:'chat',revision:1,deleted:false}]}));}
    return new Response(JSON.stringify({changes:[],cursor:0,has_more:false}));
  });
  await syncNow('owner-a');
  expect(counts).toHaveLength(4);expect(counts.every(count=>count===atBegin)).toBe(true);
  const raw=new Uint8Array(chunks.reduce((size,chunk)=>size+chunk.length,0));let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
  expect(JSON.parse(new TextDecoder().decode(raw))).toEqual({request_id:batch.request_id,changes:batch.changes});
  expect(fixture.meta.get('sync:owner-0:outbox').private).toBe('OTHER ACCOUNT BODY');
});

it.each(['withdrawn','replacement','account'])('fences a large body when an older writer changes %s between parts',async change=>{
  const current=local('chat');current.dirty=true;
  current.payload.messages=Array.from({length:28},(_,index)=>({id:index+1,uuid:'guard-'+index,role:'user',content:'large fixture '.repeat(6000)}));
  put(current);let sent=0;
  vi.mocked(cloudFetch).mockImplementation(async path=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(path==='/api/cloud/app/sync/transfers')return new Response(JSON.stringify({transfer_id:'11111111-1111-4111-8111-111111111111',next:0,chunk_bytes:1024*1024}));
    if(path.includes('/parts/')){
      sent++;const pending=fixture.meta.get('sync:owner-a:outbox');
      if(change==='account')fixture.owner='owner-b';
      else fixture.meta.set('sync:owner-a:outbox',change==='withdrawn'?{...pending,withdrawn:true}:{...pending,request_id:'replacement'});
      return new Response(JSON.stringify({next:sent}));
    }
    expect(path).not.toContain('/commit');return new Response(JSON.stringify({changes:[],cursor:0,has_more:false}));
  });
  await syncNow('owner-a');
  expect(sent).toBe(1);expect(get('chat','owner-a').dirty).toBe(true);expect(fixture.meta.has('sync:owner-a:outbox')).toBe(true);
});

it.each([[false,7,0],[true,7,1],[false,8,1]] as const)('fetches referenced bytes only for missing or newer content (evicted=%s revision=%s)',async(evicted,revision,expected)=>{
  const current=local('chat');current.serverRevision=7;
  const raw=new TextEncoder().encode(JSON.stringify(current.payload)),sha=new Sha256().update(raw).digest();
  put(evicted?offlineStub(current):current);let served=false,parts=0;
  vi.mocked(cloudFetch).mockImplementation(async path=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(path.includes('/parts/')){parts++;return new Response(JSON.stringify({data:btoa(String.fromCharCode(...raw)),sha256:sha}));}
    const changes=served?[]:[{id:'chat',kind:'conversation',revision,deleted:false,payload_ref:{id:'chat',revision,transfer_id:'11111111-1111-4111-8111-111111111111',size:raw.length,sha256:sha,chunks:1,chunk_bytes:1024*1024}}];
    served=true;return new Response(JSON.stringify({changes,cursor:9,has_more:false}));
  });
  await syncNow('owner-a');
  expect(parts).toBe(expected);expect(get('chat').payload.messages).toHaveLength(1);
  expect(get('chat').payload.cache_evicted).toBeFalsy();expect(fixture.meta.get('sync:owner-a:cursor')).toBe(9);
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

it.each([[1,0,1,[]],[2,1,2,['tea']],[3,1,3,['tea']]] as const)('branches shared history at message %s using its exact saved state',async(point,turn,count,memories)=>{
  const source=local('chat');source.payload=structuredClone(sharedHistory.payload);put(source);fixture.meta.set('message-sequence:owner-a',100);
  const response=await deviceFetch('/api/chat/sessions/chat/branch',{method:'POST',body:JSON.stringify({message_id:point})});
  expect(response.status).toBe(200);const body=await response.json(),copy=get(body.session_id);
  expect(copy.payload.state.turn).toBe(turn);expect(copy.payload.messages).toHaveLength(count);
  expect(copy.payload.memories.map((memory:any)=>memory.content)).toEqual(memories);
  expect(copy.payload.messages.every((message:any)=>message.id>100)).toBe(true);
  expect(copy.payload.settings.system_prompt).toBe(point===3?'NEW SYSTEM':'OLD SYSTEM');
  expect(copy.payload.settings.library_binding.character.revision).toBe(point===3?2:1);
  expect(copy.payload.settings.world_id.endsWith(point===3?'@2':'@1')).toBe(true);
  expect(get('chat').payload.memories[0].content).toBe('coffee');
});
it('hydrates all historical revisions and can compile settings from an earlier branch',async()=>{
  const payload=structuredClone(sharedHistory.payload);
  await receiveSyncPage('owner-a',[{id:'chat',kind:'conversation',revision:1,deleted:false,payload}],1);
  expect(Object.keys(get('character').payload.versions).sort()).toEqual(['1','2']);
  expect(Object.keys(get('created_'+'a'.repeat(32)).payload.versions).sort()).toEqual(['1','2']);
  const point=get('chat').payload.messages[1].id;
  const result=await deviceFetch('/api/chat/sessions/chat/branch',{method:'POST',body:JSON.stringify({message_id:point})});
  expect(result.status).toBe(200);const copy=get((await result.json()).session_id);
  const compiled=await deviceFetch('/api/chat/settings',{method:'PUT',body:JSON.stringify(copy.payload.settings)});
  expect(compiled.status,await compiled.text()).toBe(200);expect(copy.payload.settings.system_prompt).toBe('OLD SYSTEM');
});
it('rolls back the entire page when a historical fixed library revision is missing',async()=>{
  const payload:any=structuredClone(sharedHistory.payload);delete payload.library_snapshots['character@1'];
  await expect(receiveSyncPage('owner-a',[{id:'chat',kind:'conversation',revision:1,deleted:false,payload}],1)).rejects.toThrow('aborted');
  expect(fixture.entities.size).toBe(0);expect(fixture.meta.get('sync:owner-a:cursor')).toBeUndefined();
});

it('allocates after an unrelated local history while ignoring another owner high-water mark',async()=>{
  const unrelated=local('unrelated');unrelated.payload.messages[0].id=900;
  const foreign=local('foreign','owner-b');foreign.payload.messages[0].id=9000;
  put(unrelated);put(foreign);fixture.meta.set('message-sequence:owner-a',3);
  await receiveSyncPage('owner-a',[remote()],1);
  expect(get('chat').payload.messages[0].id).toBe(901);
  expect(get('unrelated')).toEqual(unrelated);expect(get('foreign','owner-b')).toEqual(foreign);
});

it.each([
  [true,{messages:{}}],[true,{messages:[null]}],[true,{settings:{library_binding:{lorebooks:1}}}],
  [false,{messages:{}}],[false,{messages:[null]}],[false,{settings:{library_binding:{lorebooks:1}}}],
] as const)('keeps skipped remote payloads from invalidating an unsent/newer local record (dirty=%s)',async(dirty,payload)=>{
  const current=local('chat');current.dirty=dirty;current.serverRevision=9;put(current);
  await receiveSyncPage('owner-a',[{...remote(),payload:{...remote().payload,...payload}}],18);
  expect(get('chat')).toEqual(current);expect(fixture.meta.get('sync:owner-a:cursor')).toBe(18);
});

it('rejects a recovery UUID collision with an unrelated record without retiring the unsent original',async()=>{
  const pending=local('chat');pending.dirty=true;put(pending);
  const id='11111111-1111-4111-8111-111111111111',unrelated=local(id);put(unrelated);
  const original=structuredClone(fixture.entities);
  const random=vi.spyOn(crypto,'randomUUID').mockReturnValue(id);
  try{
    await expect(receiveSyncPage('owner-a',[{id:'chat',kind:'conversation',revision:2,deleted:true,payload:{}}],1)).rejects.toThrow('aborted');
    expect(fixture.entities).toEqual(original);expect(fixture.meta.get('sync:owner-a:cursor')).toBeUndefined();
  }finally{random.mockRestore();}
});

it('imports unused characters and per-conversation snapshots once while retaining drafts and stopped history',async()=>{
  const data=initialData();data.characters.push({...data.characters[0],id:'unused',name:'Unused'});
  const original={...data.characters[0],name:'Historical character'},session=newConversation(original,'kyalulu-iq3m');
  session.draft='未送信';session.messages.push({id:'stopped',role:'assistant',content:'途中',state:'stopped'});data.conversations=[session];
  const first=await importMobile(data,'hash'),repeat=await importMobile(data,'hash');
  expect(repeat).toEqual({...first,repeated:true});expect(fixture.entities.size).toBe(4);
  const conversation=get(first.sessions[0].id);
  expect(conversation.payload.migrated_draft).toBe('未送信');expect(conversation.payload.messages.at(-1).imported_state).toBe('stopped');
  expect(get(conversation.payload.settings.character_id).payload.document.name).toBe('Historical character');
  expect([...fixture.entities.values()].filter(e=>e.kind==='character').map(e=>e.payload.document.name)).toContain('Unused');
  expect([...fixture.entities.values()].every(e=>e.owner==='owner-a'&&e.payload.storage_policy==='local')).toBe(true);
});
it('rolls back the whole migration and receipt on failed storage and isolates the importing owner',async()=>{
  const data=initialData();data.conversations=[newConversation(data.characters[0],'kyalulu-iq3m')];fixture.failAt=2;
  await expect(importMobile(data,'hash')).rejects.toThrow('aborted');expect(fixture.entities.size).toBe(0);expect(fixture.meta.has('mobile-import:owner-a:hash')).toBe(false);
  fixture.failAt=0;const first=await importMobile(data,'hash');fixture.owner='owner-b';
  await expect(importMobile(data,'hash','owner-a')).rejects.toThrow('aborted');
  const second=await importMobile(data,'hash');expect(second.repeated).toBe(false);expect(second.sessions[0].id).not.toBe(first.sessions[0].id);
  expect(get(first.sessions[0].id,'owner-a').owner).toBe('owner-a');expect(get(second.sessions[0].id,'owner-b').owner).toBe('owner-b');
});

it('receives two conversations with overlapping IDs, hydrates libraries and advances the sequence atomically',async()=>{
  put(local('private'));
  await receiveSyncPage('owner-a',[remote(),remote('other')],9);
  expect(get('private').payload.messages[0].id).toBe(1);
  expect(get('chat').payload.messages[0].id).toBe(2);expect(get('other').payload.messages[0].id).toBe(3);
  expect(get('character').payload.versions['3'].name).toBe('Tea');
  expect(fixture.meta.get('message-sequence:owner-a')).toBe(3);expect(fixture.meta.get('sync:owner-a:cursor')).toBe(9);
});
it('hydrates pinned creator revisions atomically and rejects conflicting snapshot contents',async()=>{
  const id='created_'+'c'.repeat(32),value=remote();
  (value.payload.settings as any).world_id=id+'@3';
  (value.payload as any).creator_snapshots={[id+'@3']:{kind:'world',document:{display_name:'Harbor',rules:'KEEP'}}};
  await receiveSyncPage('owner-a',[value],1);expect(get(id).payload.versions['3'].rules).toBe('KEEP');
  const broken=structuredClone(value);broken.id='other';(broken.payload as any).creator_snapshots[id+'@3'].document.rules='CHANGED';
  await expect(receiveSyncPage('owner-a',[broken],2)).rejects.toThrow('aborted');expect(get('other')).toBeUndefined();expect(fixture.meta.get('sync:owner-a:cursor')).toBe(1);
});
it('keeps newer local edits and another account separate from a received page',async()=>{
  const dirty=local('chat');dirty.dirty=true;dirty.payload.messages[0].content='unsent';put(dirty);put(local('other','owner-b'));
  await receiveSyncPage('owner-a',[remote(),remote('other')],2);
  expect(get('chat').payload.messages[0].content).toBe('unsent');
  expect(get('other','owner-b').payload.messages[0].id).toBe(1);expect(get('other').owner).toBe('owner-a');
});
it('rolls back hydration and cursor on a quota failure or a changed immutable revision',async()=>{
  fixture.failAt=2;
  await expect(receiveSyncPage('owner-a',[remote()],1)).rejects.toThrow('aborted');
  expect(fixture.entities.size).toBe(0);expect(fixture.meta.has('sync:owner-a:cursor')).toBe(false);
  fixture.failAt=0;await receiveSyncPage('owner-a',[remote()],1);
  const broken=remote('other');broken.payload.library_snapshots['character@3']={name:'Changed'};
  await expect(receiveSyncPage('owner-a',[broken],2)).rejects.toThrow('aborted');
  expect(get('other')).toBeUndefined();expect(fixture.meta.get('sync:owner-a:cursor')).toBe(1);
});
it('rejects an account change or revoked device consent before adopting data',async()=>{
  fixture.owner='owner-b';await expect(receiveSyncPage('owner-a',[remote()],1)).rejects.toThrow('aborted');
  fixture.owner='owner-a';fixture.meta.set('sync:owner-a:consent',false);
  await expect(receiveSyncPage('owner-a',[remote()],1)).rejects.toThrow('aborted');expect(fixture.entities.size).toBe(0);
});
it('does not overwrite device-only conversations with synced payloads',async()=>{
  const privateChat=local('chat');privateChat.payload.storage_policy='local';put(privateChat);
  await expect(receiveSyncPage('owner-a',[remote()],1)).rejects.toThrow('aborted');expect(get('chat').payload.storage_policy).toBe('local');
});
it('acknowledges only the uploaded revision and retains edits made while the request was in flight',()=>{
  const current=local('chat');current.revision=8;current.payload.messages[0].content='edited after upload';
  const batch={request_id:'request',revisions:{chat:7},changes:[{id:'chat',kind:'conversation' as const,base_revision:2,payload:payload(),deleted:false}]};
  const ack=acknowledgeEntity(current,{id:'chat',revision:3,deleted:false},batch);
  expect(ack.dirty).toBe(true);expect(ack.payload.messages[0].content).toBe('edited after upload');
  const lineage={version:1,status:'verified',common_messages:1,common_message_uuid:'user'};
  const branch=acknowledgeEntity(current,{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true,lineage},batch);
  expect(branch.payload.lineage).toEqual(lineage);
  expect(branch.dirty).toBe(true);expect(branch.payload.settings.session_id).toBe('fork');expect(current.id).toBe('chat');
});
it('pins the expected authenticated account on consent writes and rejects late responses',async()=>{
  vi.mocked(cloudFetch).mockResolvedValue(new Response(JSON.stringify({revision:1,selected:['chat'],accepted:true})));
  await runtimeConsent('owner-a',{revision:0,selected:['chat'],consent:true});
  expect(vi.mocked(cloudFetch).mock.calls[0][1]?.headers).toMatchObject({'X-Kyalulu-Owner':'owner-a'});
  vi.mocked(cloudFetch).mockImplementation(async()=>{fixture.owner='owner-b';return new Response(JSON.stringify({revision:2,selected:[],accepted:false}));});
  await expect(runtimeConsent('owner-a',{revision:1,selected:[],consent:false})).rejects.toThrow('Account changed');
});
it('adopts a branch acknowledgment without deleting the source or losing edits made during upload',async()=>{
  const current=local('chat');current.revision=7;current.serverRevision=2;current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:cursor',9);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'durable',revisions:{chat:7},changes:[{id:'chat',kind:'conversation',base_revision:2,payload:current.payload,deleted:false}]});
  const cursors:string[]=[];
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    expect(new Headers(init?.headers).get('X-Kyalulu-Owner')).toBe('owner-a');
    if(init?.method==='POST'){
      const edited=structuredClone(get('chat'));edited.revision=8;edited.payload.messages[0].content='edited during upload';put(edited);
      return new Response(JSON.stringify({changes:[{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true}]}));
    }
    cursors.push(path);
    const original=remote('chat',3);original.payload.settings.library_binding=null as any;original.payload.messages[0].content='Cloud continuation';
    return new Response(JSON.stringify({cursor:10,has_more:false,changes:[original]}));
  });
  await syncNow('owner-a');
  expect(cursors.some(path=>path.includes('cursor=0'))).toBe(true);expect(get('chat').payload.messages[0].content).toBe('Cloud continuation');
  expect(get('fork').payload.messages[0].content).toBe('edited during upload');expect(get('fork').dirty).toBe(true);
  expect(get('fork').payload.messages[0].id).not.toBe(get('chat').payload.messages[0].id);
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
});

it.each([false,true])('checks unrelated identities and numeric IDs while adopting a branch acknowledgment (collision=%s)',async collision=>{
  const current=local('chat');current.dirty=true;put(current);
  const unrelated=local(collision?'fork':'unrelated');unrelated.payload.messages[0].id=900;put(unrelated);
  const original=structuredClone(fixture.entities);
  const pending={request_id:'selected-ack',withdrawn:0,revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]};
  fixture.meta.set('sync:owner-a:outbox',pending);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    return new Response(JSON.stringify(init?.method==='POST'?{changes:[{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true}]}:{changes:[],cursor:0,has_more:false}));
  });
  await syncNow('owner-a');
  if(collision){
    expect(fixture.entities).toEqual(original);expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(pending);
    expect(syncState().phase).toBe('error');
  }else{
    expect(get('fork').payload.messages[0].id).toBe(901);expect(get('unrelated')).toEqual(unrelated);
    expect(get('chat').payload.messages[0].content).toBe(current.payload.messages[0].content);
    expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
  }
});
it('retains the outbox and local edits if consent is revoked while an acknowledgment is arriving',async()=>{
  const current=local('chat');current.dirty=true;put(current);
  const outbox={request_id:'durable',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]};
  fixture.meta.set('sync:owner-a:outbox',outbox);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(init?.method!=='POST')return new Response(JSON.stringify({changes:[],cursor:0,has_more:false}));
    await setSyncConsent('owner-a',false);
    return new Response(JSON.stringify({changes:[{id:'chat',revision:1,deleted:false}]}));
  });
  await syncNow('owner-a');
  expect(get('chat').dirty).toBe(true);expect(fixture.meta.get('sync:owner-a:outbox')).toEqual({...outbox,withdrawn:true});
  expect(syncState().phase).toBe('off');
});
it('withdraws queued browser data durably and only sends its request ID while consent is off',async()=>{
  const current=local('chat');current.dirty=true;put(current);
  const batch={request_id:'never-upload-again',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]};
  fixture.meta.set('sync:owner-a:outbox',batch);await setSyncConsent('owner-a',false);
  expect(fixture.meta.get('sync:owner-a:outbox').withdrawn).toBe(true);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    expect(path).toBe('/api/cloud/app/sync/cancel/never-upload-again');expect(init?.body).toBe('{}');
    expect(new Headers(init?.headers).get('X-Kyalulu-Owner')).toBe('owner-a');
    return new Response(JSON.stringify({state:'canceled'}));
  });
  await syncNow('owner-a');expect(cloudFetch).toHaveBeenCalledTimes(2);
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);expect(get('chat').dirty).toBe(true);
  expect(syncState()).toMatchObject({phase:'off',pending:0});
  vi.mocked(cloudFetch).mockClear();await syncNow('owner-a');expect(cloudFetch).not.toHaveBeenCalled();
});
it('retains an applied withdrawal receipt across disabled runs and adopts it after renewed consent without resending the body',async()=>{
  const current=local('chat');current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'already-applied',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]});
  await setSyncConsent('owner-a',false);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(path.endsWith('/cancel/already-applied'))return new Response(JSON.stringify({state:'applied',result:{changes:[{id:'chat',revision:1,deleted:false}]}}));
    expect(init?.method).not.toBe('POST');return new Response(JSON.stringify({changes:[],cursor:0,has_more:false}));
  });
  await syncNow('owner-a');expect(fixture.meta.get('sync:owner-a:outbox').receipt.changes).toHaveLength(1);
  expect(get('chat').serverRevision).toBe(0);expect(syncState()).toMatchObject({phase:'off',pending:1});
  vi.mocked(cloudFetch).mockClear();await syncNow('owner-a');expect(cloudFetch).not.toHaveBeenCalled();
  const edited=structuredClone(get('chat'));edited.revision=2;edited.payload.messages[0].content='new unsent edit';put(edited);
  await setSyncConsent('owner-a',true);await syncNow('owner-a');
  expect(vi.mocked(cloudFetch).mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
  expect(get('chat')).toMatchObject({serverRevision:1,dirty:true});expect(get('chat').payload.messages[0].content).toBe('new unsent edit');
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
});
it('keeps withdrawal pending on quota failure or late account changes without touching local data',async()=>{
  const current=local('chat');current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'receipt-uncertain',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]});
  await setSyncConsent('owner-a',false);const pending=structuredClone(fixture.meta.get('sync:owner-a:outbox'));fixture.failAt=1;
  vi.mocked(cloudFetch).mockImplementation(async path=>new Response(JSON.stringify(path==='/api/mobile/status'
    ?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{state:'applied',result:{changes:[{id:'chat',revision:1,deleted:false}]}})));
  await syncNow('owner-a');expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(pending);expect(get('chat').serverRevision).toBe(0);
  fixture.failAt=0;
  vi.mocked(cloudFetch).mockImplementation(async path=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    fixture.owner='owner-b';return new Response(JSON.stringify({state:'canceled'}));
  });
  await syncNow('owner-a');expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(pending);
});
it.each([
  {id:'chat',revision:1,deleted:'false'},
  {id:'other',source_id:'chat',revision:1,deleted:true},
  {id:'chat',revision:0,deleted:false},
  {id:'chat',revision:1,deleted:false,branched:'yes'},
])('rejects malformed withdrawal receipts before storing or erasing data: %j',async ack=>{
  const current=local('chat');current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'malformed',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:current.payload,deleted:false}]});
  await setSyncConsent('owner-a',false);
  vi.mocked(cloudFetch).mockImplementation(async path=>new Response(JSON.stringify(path==='/api/mobile/status'
    ?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{state:'applied',result:{changes:[ack]}})));
  await syncNow('owner-a');expect(fixture.meta.get('sync:owner-a:outbox').receipt).toBeUndefined();
  expect(get('chat')).toEqual(current);expect(syncState()).toMatchObject({phase:'off',pending:1});
});
it('does not replace a withdrawn deletion with a newly confirmed request',async()=>{
  const current=local('chat');current.deleted=true;current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:remote:chat',{revision:4,deleted:false,count:2});
  const batch={request_id:'withdrawn',withdrawn:true,changes:[{id:'chat'}]};fixture.meta.set('sync:owner-a:outbox',batch);
  await expect(reconfirmDeletion('owner-a','chat',1,4)).rejects.toThrow('aborted');
  expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(batch);expect(get('chat').revision).toBe(1);
});
it('keeps the displayed state off when consent is withdrawn during final cache maintenance',async()=>{
  vi.mocked(cloudFetch).mockImplementation(async path=>new Response(JSON.stringify(path==='/api/mobile/status'
    ?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{changes:[],cursor:0,has_more:false})));
  vi.mocked(trimOfflineCache).mockImplementationOnce(async()=>{await setSyncConsent('owner-a',false);});
  await syncNow('owner-a');expect(syncState()).toMatchObject({phase:'off',pending:0});
});
it('preserves unsent edits locally when a remote tombstone wins and scrubs retired generation records',async()=>{
  const current=local('chat');current.dirty=true;current.payload.messages[0].content='UNSENT';put(current);
  fixture.meta.set('generation:owner-a:g',{generation_id:'g',session_id:'chat',status:'completed',reply:'PRIVATE-REPLY'});
  fixture.meta.set('generation:owner-b:g',{generation_id:'g',session_id:'chat',status:'completed',reply:'OTHER-ACCOUNT'});
  const tombstone={id:'chat',kind:'conversation',revision:2,deleted:true,payload:{}};
  await receiveSyncPage('owner-a',[tombstone],3);
  expect(get('chat').deleted).toBe(true);expect(JSON.stringify(get('chat').payload)).not.toContain('UNSENT');
  const recovery=[...fixture.entities.values()].find(e=>e.payload.recovery_from==='chat');
  expect(recovery.payload.messages[0].content).toBe('UNSENT');expect(recovery.payload.storage_policy).toBe('local');expect(recovery.dirty).toBe(false);
  expect(fixture.meta.get('generation:owner-a:g')).toEqual({generation_id:'g',session_id:'chat',status:'deleted'});
  expect(fixture.meta.get('generation:owner-b:g').reply).toBe('OTHER-ACCOUNT');
  await receiveSyncPage('owner-a',[tombstone],3);expect(fixture.entities.size).toBe(2);
});
it('requires a fresh explicit confirmation of the exact local and downloaded Cloud revisions',async()=>{
  const current=local('chat');current.deleted=true;current.dirty=true;put(current);
  fixture.meta.set('sync:owner-a:remote:chat',{revision:4,deleted:false,count:2});
  fixture.meta.set('sync:owner-a:outbox',{request_id:'old-confirmation',changes:[{id:'chat'}]});
  await expect(reconfirmDeletion('owner-a','chat',1,3)).rejects.toThrow('aborted');
  expect(get('chat').revision).toBe(1);
  await reconfirmDeletion('owner-a','chat',1,4);
  const outbox=fixture.meta.get('sync:owner-a:outbox');
  expect(outbox.request_id).not.toBe('old-confirmation');
  expect(outbox.changes).toEqual([{id:'chat',kind:'conversation',base_revision:4,payload:{},deleted:true,delete_confirmed:true}]);
  expect(get('chat').payload.delete_confirmation_revision).toBe(2);
});
it('does not turn an unconfirmed queued deletion into a confirmed request',async()=>{
  const current=local('chat');current.deleted=true;current.dirty=true;put(current);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(init?.method!=='POST')return new Response(JSON.stringify({cursor:0,changes:[],has_more:false}));
    const body=JSON.parse(String(init.body));expect(body.changes[0].delete_confirmed).toBe(false);
    return new Response(JSON.stringify({error:'sync_delete_confirmation_required'}),{status:409});
  });
  await syncNow('owner-a');expect(syncState().phase).toBe('error');expect(get('chat').payload.messages).toHaveLength(1);
});
it('does not transfer a deletion confirmation to a branch created by an older upload',async()=>{
  const current=local('chat');current.revision=2;current.deleted=true;current.dirty=true;current.payload.delete_confirmation_revision=2;put(current);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'old-upload',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:local('chat').payload,deleted:false}]});
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return new Response(JSON.stringify({cloud_mode:true,authenticated:true,owner_scope:'owner-a'}));
    if(init?.method==='POST')return new Response(JSON.stringify({changes:[{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true}]}));
    const original=remote('chat',1);original.payload.settings.library_binding=null as any;
    return new Response(JSON.stringify({cursor:1,has_more:false,changes:[original]}));
  });
  await syncNow('owner-a');
  expect(get('chat').deleted).toBe(true);expect(get('chat').dirty).toBe(true);
  expect(get('fork').deleted).toBe(false);expect(get('fork').dirty).toBe(false);
  expect(get('fork').payload.delete_confirmation_revision).toBeUndefined();
});
it('rehydrates an evicted revision without renumbering messages or rewinding the sync cursor',async()=>{
  const cached=local('chat');cached.serverRevision=1;cached.payload.messages[0].id=71;put(offlineStub(cached));
  fixture.meta.set('sync:owner-a:cursor',50);
  vi.mocked(cloudFetch).mockResolvedValue(new Response(JSON.stringify(remote('chat',1))));
  const loaded=await hydrateConversation('chat','owner-a');
  expect(loaded.payload.cache_evicted).toBeUndefined();expect(loaded.payload.messages[0].id).toBe(71);
  expect(fixture.meta.get('sync:owner-a:cursor')).toBe(50);
  await receiveSyncPage('owner-a',[remote('other')],2);expect(fixture.meta.get('sync:owner-a:cursor')).toBe(50);
});
it('refuses on-demand downloads after consent revocation and leaves the offline stub intact',async()=>{
  const cached=local('chat');cached.serverRevision=1;put(offlineStub(cached));fixture.meta.set('sync:owner-a:consent',false);
  await expect(hydrateConversation('chat','owner-a')).rejects.toThrow('enable sync');
  expect(cloudFetch).not.toHaveBeenCalled();expect(get('chat').payload.cache_evicted).toBe(true);
});
