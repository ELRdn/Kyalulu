import { harness, decoded } from './idbHarness.test-support';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppEntity } from './appStore';

const fixture=vi.hoisted(()=>({entities:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),owner:'owner-a',busy:false,failAt:0,reads:[] as string[],
  readHook:undefined as undefined|((mode:string,kind:string,id:string|null)=>void)}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,generationBusy:()=>fixture.busy}));
vi.mock('./transport',()=>({cloudFetch:vi.fn()}));
// Unit transaction harness: queued requests, owner ranges, commit and abort; browser quota remains an E2E gate.
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:async()=>{throw Error('Bulk sync reads forbidden');},
  getMeta:async(key:string)=>{fixture.reads.push(key);return structuredClone(fixture.meta.get(key));},
  setMeta:async(key:string,value:any)=>{fixture.meta.set(key,structuredClone(value));},
  entity:async(id:string,owner:string)=>decoded(fixture.entities.get(JSON.stringify([owner,id])),fixture.parts),
  openEntity:async(id:string,owner:string)=>decoded(fixture.entities.get(JSON.stringify([owner,id])),fixture.parts),
  conversationInfo:async(id:string,owner:string)=>{const value=fixture.entities.get(JSON.stringify([owner,id]));return value&&{...value,selection:{cache_evicted:!!value.payload?.cache_evicted}};},
  conversationPage:async(id:string,owner:string,limit=50)=>{
    const key=JSON.stringify([owner,id]),value=decoded(fixture.entities.get(key),fixture.parts);if(!value)return;
    const {messages,...metadata}=value.payload,total=messages.length;
    return {owner,id,revision:value.revision,bodyToken:fixture.entities.get(key)?.payloadParts?.token??null,metadata,messages:messages.slice(-limit),total,start:Math.max(0,total-limit),end:total};
  },
  saveEntity:async(value:AppEntity,expected?:number)=>{
    const key=JSON.stringify([value.owner,value.id]),previous=fixture.entities.get(key);
    if(value.owner!==fixture.owner||expected!==undefined&&expected!==(previous?.revision??0))throw Error('Transaction aborted');
    const saved={...value,revision:(previous?.revision??0)+1,dirty:value.payload.storage_policy==='sync'};fixture.entities.set(key,structuredClone(saved));return saved;
  },
  trimOfflineCache:vi.fn().mockResolvedValue(undefined),
  appTransaction:(_stores:string[],mode:string,action:any)=>{
    let writes=0;return harness(fixture.entities,fixture.meta,fixture.parts,JSON.stringify,mode,action,{
      write:()=>{if(fixture.failAt&&++writes===fixture.failAt)throw Error('Quota');},
      read:(mode,name,k)=>{
        if(name==='meta')fixture.reads.push(String(k));
        if(name==='entities'){if(mode==='readonly')fixture.reads.push('entity:'+k[1]);fixture.readHook?.(mode,'get',k[1]);}
        if(name==='parts')fixture.readHook?.(mode,'part',String(k[1]));
        if(name==='cursor')fixture.readHook?.(mode,'cursor',k);
      },
    });
  },
}));

import { acknowledgeEntity, receiveSyncPage, runtimeConsent, syncNow, syncState, reconfirmDeletion, hydrateConversation, setSyncConsent } from './appSync';
import { offlineStub, trimOfflineCache,writeEntity,writeOutbox,appTransaction } from './appStore';
import { JsonStream } from './jsonStream';
import { cloudFetch } from './transport';
import { importMobile } from '../pages/Migration';
import { initialData, newConversation } from '../mobile/store';
import { deviceFetch } from './deviceApi';
import { Sha256 } from '../mobile/sha256';
import { stageSyncBatch } from './appSyncStage';
import { withLibrarySnapshots } from './appSyncData';
import * as syncData from './appSyncData';
import sharedHistory from '../../../../tests/fixtures/unified-history.json';
import { PortableDocumentSchema, CreatorDocumentSchema } from '../../../../packages/schemas/src';

const payload=()=>({storage_policy:'sync',rating:'general',settings:{session_id:'chat',library_binding:{character:{id:'character',revision:3}}},state:{session_id:'chat'},
  messages:[{id:1,uuid:'message',role:'user',content:'tea'}],memories:[],summaries:[],library_snapshots:{'character@3':{name:'Tea'}}});
const remote=(id='chat',revision=1)=>({id,kind:'conversation',revision,deleted:false,payload:payload()});
function local(id:string,owner='owner-a'):AppEntity {
  return {id,owner,kind:'conversation',revision:1,serverRevision:0,payload:{...payload(),settings:{session_id:id,library_binding:null}},dirty:false,deleted:false,pinned:false,opened:1};
}
const put=(e:AppEntity)=>fixture.entities.set(JSON.stringify([e.owner,e.id]),e);
const get=(id:string,owner='owner-a')=>decoded(fixture.entities.get(JSON.stringify([owner,id])),fixture.parts);
function outgoingServer(sent:any[],reject=false){
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    if(path==='/api/mobile/status')return Response.json({cloud_mode:true,authenticated:true,owner_scope:'owner-a'});
    if(init?.method==='POST'){
      const batch=JSON.parse(String(init.body));sent.push(batch);
      return reject?Response.json({error:'fixture rejected'},{status:409}):Response.json({changes:batch.changes.map((e:any)=>({id:e.id,revision:1,deleted:e.deleted}))});
    }
    return Response.json({changes:[],cursor:0,has_more:false});
  });
}
beforeEach(()=>{
  fixture.entities=new Map();fixture.parts.clear();fixture.meta=new Map([['sync:owner-a:consent',true]]);fixture.owner='owner-a';fixture.busy=false;fixture.failAt=0;fixture.reads=[];fixture.readHook=undefined;
  vi.stubGlobal('IDBKeyRange',{bound:(lower:any,upper:any)=>({lower,upper}),only:(value:any)=>({lower:value,upper:value})});
  vi.stubGlobal('navigator',{locks:{request:async(_name:string,optionsOrAction:any,action?:any)=>(typeof optionsOrAction==='function'?optionsOrAction:action)({name:_name})}});
});

it('sends only the first 50 dirty sync records in key order and counts device-only dirty records',async()=>{
  const sent:any[]=[];outgoingServer(sent);
  for(let index=54;index>=0;index--)put({...local('chat-'+String(index).padStart(2,'0')),dirty:true});
  put({...local('device-only'),dirty:true,payload:{...local('device-only').payload,storage_policy:'local'}});
  put({...local('foreign','owner-b'),dirty:true});
  await syncNow('owner-a');
  expect(sent).toHaveLength(1);expect(sent[0].changes.map((e:any)=>e.id)).toEqual(Array.from({length:50},(_,i)=>'chat-'+String(i).padStart(2,'0')));
  expect(syncState()).toMatchObject({phase:'saved',pending:6});expect(get('chat-50').dirty).toBe(true);
});

it('retains a different document pending conversation until execution is durably finished',async()=>{
  const sent:any[]=[];outgoingServer(sent);
  const pending={...local('pending'),dirty:true,payload:{...local('pending').payload,pending_generation:'active-worker',draft:'keep unsent draft'}};
  put(pending);put({...local('ready'),dirty:true});
  await syncNow('owner-a');
  expect(sent).toHaveLength(1);expect(sent[0].changes.map((e:any)=>e.id)).toEqual(['ready']);
  expect(get('pending')).toEqual(pending);expect(syncState()).toMatchObject({phase:'saved',pending:1});
  put({...pending,revision:2,payload:{...pending.payload,pending_generation:null}});
  await syncNow('owner-a');
  expect(sent).toHaveLength(2);expect(sent[1].changes.map((e:any)=>e.id)).toEqual(['pending']);
  expect(get('pending').payload.draft).toBe('keep unsent draft');expect(get('pending').dirty).toBe(false);
});

it.each([true,false])('prioritizes the first deletion beyond the cap and preserves exact confirmation (%s)',async confirmed=>{
  const sent:any[]=[];outgoingServer(sent,true);
  for(let index=0;index<55;index++)put({...local('chat-'+index),dirty:true});
  const first={...local('z-first'),dirty:true,deleted:true,revision:4,serverRevision:3};
  first.payload.delete_confirmation_revision=confirmed?4:3;put(first);
  put({...local('z-second'),dirty:true,deleted:true});
  await syncNow('owner-a');
  expect(sent[0].changes).toEqual([{id:'z-first',kind:'conversation',base_revision:3,payload:{},deleted:true,delete_confirmed:confirmed}]);
  expect(fixture.meta.get('sync:owner-a:outbox').revisions).toEqual({'z-first':4});expect(get('z-first')).toEqual(first);
  expect(fixture.reads.filter(key=>key.startsWith('entity:'))).toEqual([]);
});

it.each(['stored','embedded','invalid'])('resolves only selected current/historical references and keeps snapshot validation (%s)',async source=>{
  const sent:any[]=[];outgoingServer(sent,true);
  const selected={...local('chat'),dirty:true,payload:structuredClone(sharedHistory.payload)};
  const creator='created_'+'b'.repeat(32),library='historical-character';
  selected.payload.messages[1].before!.settings!.library_binding!.character!.id=library;
  selected.payload.messages[1].before!.state.world_id=creator+'@1';
  const p=selected.payload as Record<string,any>;
  p.library_snapshots[library+'@1']=structuredClone(p.library_snapshots['character@1']);
  p.creator_snapshots[creator+'@1']=structuredClone(p.creator_snapshots['created_'+'a'.repeat(32)+'@1']);
  const expectedLibrary=Object.fromEntries(Object.entries(p.library_snapshots).map(([id,value])=>[id,PortableDocumentSchema.parse(value)]));
  const expectedCreator=Object.fromEntries(Object.entries(p.creator_snapshots).map(([id,value]:[string,any])=>[id,{...value,document:CreatorDocumentSchema.parse(value.document)}]));
  for(const [id,kind,versions] of [
    ['character','character',{'1':p.library_snapshots['character@1'],'2':p.library_snapshots['character@2']}],
    [library,'character',{'1':p.library_snapshots[library+'@1']}],
    ['created_'+'a'.repeat(32),'world',{'1':p.creator_snapshots['created_'+'a'.repeat(32)+'@1'].document,'2':p.creator_snapshots['created_'+'a'.repeat(32)+'@2'].document}],
    [creator,'world',{'1':p.creator_snapshots[creator+'@1'].document}],
  ] as const)if(source!=='embedded')put({...local(id),kind,payload:{storage_policy:'local',versions}});
  if(source==='stored'){p.library_snapshots={};p.creator_snapshots={};}
  if(source==='invalid')p.settings.library_binding.character.revision=0;
  put(selected);put({...local('unrelated'),payload:{storage_policy:'local',versions:{invalid:'unused'}}});
  await syncNow('owner-a');
  expect(fixture.reads.filter(key=>key.startsWith('entity:')).sort()).toEqual(['character',library,'created_'+'a'.repeat(32),creator].map(id=>'entity:'+id).sort());
  if(source==='invalid'){expect(sent).toEqual([]);expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);return;}
  const outgoing=sent[0].changes[0].payload;
  expect(outgoing.library_snapshots).toEqual(expectedLibrary);expect(outgoing.creator_snapshots).toEqual(expectedCreator);
  expect(get('chat')).toEqual(selected);
});

it.each(['selection','reference','count','generation'])('aborts outgoing readonly work if captured context changes during %s',async phase=>{
  const sent:any[]=[];outgoingServer(sent);
  const selected={...local('chat'),dirty:phase!=='count'};
  selected.payload.settings.library_binding={character:{id:'character',revision:1}};put(selected);
  let changed=false,scans=0;
  fixture.readHook=(mode,kind,id)=>{
    if(mode==='readonly'&&kind==='cursor'&&id===null){scans++;return;}
    if(phase==='count'&&!scans)return;
    if(mode!=='readonly'||changed||kind!==(phase==='reference'?'get':'cursor'))return;
    changed=true;if(phase==='generation')fixture.busy=true;else fixture.owner='owner-b';
  };
  await syncNow('owner-a');
  expect(changed).toBe(true);expect(sent).toEqual([]);expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
  expect(get('chat')).toEqual(selected);expect(syncState().phase).not.toBe('saved');
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

it.each([false,true])('branches a %s segmented source above all owner IDs while preserving source, outbox and receipts',async segmented=>{
  const source={...local('chat'),opened:0,payload:structuredClone(sharedHistory.payload)};
  put(source);
  if(segmented)await (await import('./appStore')).appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const unrelated=local('unrelated');unrelated.payload.messages[0].id=900;put(unrelated);
  const foreign=local('foreign','owner-b');foreign.payload.messages[0].id=9000;put(foreign);
  fixture.meta.set('message-sequence:owner-a',3);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'fixed',changes:[{id:'chat',payload:{draft:'Unsent'}}]});
  fixture.meta.set('generation:owner-a:old',{status:'completed',reply:'Saved'});
  const beforeSource=structuredClone(get('chat')),beforeHeader=structuredClone(fixture.entities.get(JSON.stringify(['owner-a','chat'])));
  const beforeParts=structuredClone([...fixture.parts]),outbox=structuredClone(fixture.meta.get('sync:owner-a:outbox'));
  const response=await deviceFetch('/api/chat/sessions/chat/branch',{method:'POST',body:JSON.stringify({message_id:source.payload.messages[1].id})});
  expect(response.status,await response.clone().text()).toBe(200);const id=(await response.json()).session_id,copy=get(id);
  expect(copy.payload.messages.map((m:any)=>m.id)).toEqual([901,902]);expect(fixture.meta.get('message-sequence:owner-a')).toBe(902);
  expect(copy.payload.messages.map((m:any)=>m.uuid)).toEqual(source.payload.messages.slice(0,2).map((m:any)=>m.uuid));
  expect(copy.payload.state.session_id).toBe(id);expect(copy.payload.settings.system_prompt).toBe('OLD SYSTEM');
  expect(copy.payload.branch_of).toBe('chat');expect(copy.payload.fork_revision).toBe(source.revision);
  expect(get('chat')).toEqual(beforeSource);expect(fixture.entities.get(JSON.stringify(['owner-a','chat']))).toEqual(beforeHeader);
  for(const [key,value] of beforeParts)expect(fixture.parts.get(key)).toEqual(value);
  expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(outbox);expect(fixture.meta.get('generation:owner-a:old')).toEqual({status:'completed',reply:'Saved'});
  expect(get('unrelated')).toEqual(unrelated);expect(get('foreign','owner-b')).toEqual(foreign);
});

it.each([-1,'invalid',Number.MAX_SAFE_INTEGER])('rolls back branch allocation when owner sequence %s is invalid or exhausted',async sequence=>{
  put({...local('chat'),payload:structuredClone(sharedHistory.payload)});fixture.meta.set('message-sequence:owner-a',sequence);
  const beforeEntities=structuredClone([...fixture.entities]),beforeMeta=structuredClone([...fixture.meta]),beforeParts=structuredClone([...fixture.parts]);
  const response=await deviceFetch('/api/chat/sessions/chat/branch',{method:'POST',body:JSON.stringify({message_id:1})});
  expect(response.ok).toBe(false);expect([...fixture.entities]).toEqual(beforeEntities);expect([...fixture.meta]).toEqual(beforeMeta);expect([...fixture.parts]).toEqual(beforeParts);
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
  expect([...fixture.entities.values()].map(value=>decoded(value,fixture.parts)).filter(e=>e.kind==='character').map(e=>e.payload.document.name)).toContain('Unused');
  expect([...fixture.entities.values()].map(value=>decoded(value,fixture.parts)).every(e=>e.owner==='owner-a'&&e.payload.storage_policy==='local')).toBe(true);
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
it.each([false,true])('accepts a large non-branch receipt without retaining root messages (lineage=%s)',async withLineage=>{
  const source={...local('chat'),dirty:true,revision:7};
  // Two parts keep the unit focused; the actual browser matrix separately exercises five-part bodies.
  source.payload.messages=Array.from({length:80},(_,i)=>({id:i+1,uuid:'message-'+i,role:i%2?'assistant':'user',content:'茶🙂'.repeat(2000)}));
  source.payload.draft='Keep unsent draft';source.payload.extension={keep:'original'};
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const before=structuredClone([...fixture.parts]),lineage={root_id:'chat',fork_revision:2,source:{keep:'receipt provenance'}};
  expect(before.length).toBeGreaterThan(1);expect(before.reduce((size,[,bytes])=>size+bytes.byteLength,0)).toBeGreaterThan(1024*1024);
  fixture.meta.set('sync:owner-a:outbox',{request_id:'cached-large',withdrawn:0,revisions:{chat:6},changes:[{id:'chat',kind:'conversation',base_revision:2,payload:source.payload,deleted:false}],
    receipt:{changes:[{id:'chat',revision:4,deleted:false,...(withLineage?{lineage}:{})}]}});
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    expect(init?.method??'GET').toBe('GET');
    return Response.json(path==='/api/mobile/status'?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{cursor:0,changes:[],has_more:false});
  });
  const feed=JsonStream.prototype.feed;let maximum=0,observed=0;
  const spy=vi.spyOn(JsonStream.prototype,'feed').mockImplementation(function(this:JsonStream,bytes:Uint8Array){
    const result=feed.call(this,bytes),root=(this as any).root;
    if(Array.isArray(root?.messages)){observed++;maximum=Math.max(maximum,root.messages.length);}return result;
  });
  try{await syncNow('owner-a');}finally{spy.mockRestore();}
  expect(syncState().phase,syncState().error).toBe('saved');expect(observed).toBeGreaterThan(0);expect(maximum).toBe(0);
  const {memoryReferences,...saved}=get('chat');
  expect(saved).toEqual({...source,serverRevision:4,dirty:true,payload:{...source.payload,...(withLineage?{lineage}:{})}});
  expect(memoryReferences).toMatchObject({sources:[],memories:[]});
  if(!withLineage){
    expect([...fixture.parts.keys()]).toEqual(before.map(([key])=>key));
    // Native byte comparison avoids enumerating every typed-array index in deep equality.
    for(const [key,bytes] of before)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
  }
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
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
  current.payload.memories=[{id:'old-memory',uuid:'stable-memory',scope:'chat',type:'semantic',content:'UNSENT MEMORY',status:'active',source_message_ids:[1]}];put(current);
  fixture.meta.set('memory-events:'+JSON.stringify(['owner-a','chat']),[{id:1,scope:'chat',op:'create',memory_id:'old-memory',generation_id:'g',detail:{content:'UNSENT MEMORY'}}]);
  fixture.meta.set('memory-events:'+JSON.stringify(['owner-b','chat']),[{id:1,scope:'chat',op:'create',detail:'OTHER-ACCOUNT-MEMORY'}]);
  const tombstone={id:'chat',kind:'conversation',revision:2,deleted:true,payload:{}};
  await receiveSyncPage('owner-a',[tombstone],3);
  expect(get('chat').deleted).toBe(true);expect(JSON.stringify(get('chat').payload)).not.toContain('UNSENT');
  const recovery=[...fixture.entities.values()].map(value=>decoded(value,fixture.parts)).find(e=>e.payload.recovery_from==='chat');
  expect(recovery.payload.messages[0].content).toBe('UNSENT');expect(recovery.payload.storage_policy).toBe('local');expect(recovery.dirty).toBe(false);
  expect(fixture.meta.get('generation:owner-a:g')).toEqual({generation_id:'g',session_id:'chat',status:'deleted'});
  expect(fixture.meta.get('generation:owner-b:g').reply).toBe('OTHER-ACCOUNT');
  expect(fixture.meta.has('memory-events:'+JSON.stringify(['owner-a','chat']))).toBe(false);
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['owner-a',recovery.id]))).toEqual([{id:1,scope:recovery.id,source_scope:'chat',op:'create',memory_id:recovery.payload.memories[0].id,
    source_memory_id:'old-memory',generation_id:'g',detail:{content:'UNSENT MEMORY'}}]);
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['owner-b','chat']))[0].detail).toBe('OTHER-ACCOUNT-MEMORY');
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

it('stages the exact complete history and snapshots without retaining root messages',async()=>{
  const source:AppEntity={...local('chat'),dirty:true,revision:7,payload:structuredClone(sharedHistory.payload)};
  const originals=source.payload.messages;
  source.payload.messages=Array.from({length:80},(_,index)=>({...structuredClone(originals[index%originals.length]),id:index+1,uuid:'stage-'+index,content:'茶🙂'.repeat(2000)}));
  source.payload.draft='Keep initial unsent draft';
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const entities=structuredClone([...fixture.entities]),parts=structuredClone([...fixture.parts]),roots:number[]=[],counts:number[]=[];
  const finish=JsonStream.prototype.finish,spy=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){
    const value=finish.call(this);if(this.totalMessages!==undefined){roots.push(value.messages.length);counts.push(this.totalMessages);}return value;
  });
  let batch;
  try{batch=await stageSyncBatch('owner-a');}finally{spy.mockRestore();}
  expect(roots).toEqual([0,0]);expect(counts).toEqual([80,80]);
  expect(batch!.changesParts!.chunks).toBeGreaterThan(1);expect(batch!.changesParts!.size).toBeGreaterThan(1024*1024);
  expect(batch!.revisions).toEqual({chat:7});expect(batch!.changes.every(change=>Object.keys(change.payload).length===0)).toBe(true);
  const expected=[{id:'chat',kind:'conversation',base_revision:0,payload:withLibrarySnapshots(source.payload,[]),deleted:false}];
  const ref=batch!.changesParts!,raw=Buffer.concat(Array.from({length:ref.chunks},(_,index)=>Buffer.from(fixture.parts.get(JSON.stringify(['owner-a','outbox','fixed',ref.token,index])))));
  expect(Buffer.compare(raw,Buffer.from(JSON.stringify(expected)))).toBe(0);expect(new Sha256().update(raw).digest()).toBe(ref.sha256);
  expect([...fixture.entities]).toEqual(entities);
  for(const [key,bytes] of parts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
  expect(cloudFetch).not.toHaveBeenCalled();
});

it.each(['quota','owner','busy','consent','checksum'])('leaves the initial source intact when staging fails at %s',async fault=>{
  const source={...local('chat'),dirty:true};
  source.payload.messages=Array.from({length:80},(_,index)=>({id:index+1,uuid:'stage-'+index,role:'user',content:'茶🙂'.repeat(2000)}));
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  if(fault==='checksum'){
    const ref=fixture.entities.get(JSON.stringify(['owner-a','chat'])).payloadParts,key=JSON.stringify(['owner-a','entity','chat',ref.token,ref.chunks-1]);
    const bytes=fixture.parts.get(key);bytes[bytes.length-1]^=1;
  }
  const entities=structuredClone([...fixture.entities]),parts=structuredClone([...fixture.parts]);
  if(fault==='quota')fixture.failAt=2;
  if(fault==='consent')fixture.meta.set('sync:owner-a:consent',false);
  fixture.readHook=(mode,kind)=>{if(mode==='readwrite'&&kind==='get'){if(fault==='owner')fixture.owner='owner-b';if(fault==='busy')fixture.busy=true;}};
  if(fault==='consent')expect(await stageSyncBatch('owner-a')).toBeUndefined();
  else await expect(stageSyncBatch('owner-a')).rejects.toThrow();
  expect([...fixture.entities]).toEqual(entities);expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
  expect([...fixture.parts.keys()]).toEqual(parts.map(([key])=>key));
  for(const [key,bytes] of parts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
  expect(cloudFetch).not.toHaveBeenCalled();
});

it('keeps an existing fixed outbox instead of replacing it with a prepared batch',async()=>{
  put({...local('chat'),dirty:true});
  const existing={request_id:'older-frozen-request',withdrawn:0,revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:{original:'frozen'},deleted:false}]};
  fixture.meta.set('sync:owner-a:outbox',existing);
  expect(await stageSyncBatch('owner-a')).toEqual(existing);expect(fixture.parts.size).toBe(0);
  expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(existing);expect(get('chat').dirty).toBe(true);
});

it.each(['live','deleted-retained','tombstone'])('streams cached branch acknowledgments and memory events from %s',async mode=>{
  const sentPayload=structuredClone(sharedHistory.payload);
  for(const message of sentPayload.messages)message.content+='茶🙂'.repeat(40000);
  const current:AppEntity={...local('chat'),revision:8,serverRevision:2,dirty:true,deleted:mode!=='live',payload:structuredClone(sentPayload)};
  current.payload.messages[0].content='CURRENT LOCAL EDIT '+current.payload.messages[0].content;
  current.payload.memories[0].id='current-root-id';
  if(mode==='tombstone')current.payload={storage_policy:'sync',delete_confirmation_revision:8};
  const profile:AppEntity={...local('profile'),kind:'profile',revision:4,dirty:true,payload:{storage_policy:'sync',draft:'new profile edit'}};
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,current,'put',()=>writeEntity(tx,profile,'put',done)));
  const unrelated=local('unrelated');unrelated.payload.messages[0].id=900;put(unrelated);
  const foreign=local('foreign','owner-b');foreign.payload.messages[0].id=9_000_000;put(foreign);
  const event={id:1,scope:'chat',op:'update',memory_id:'current-root-id',source_scope:'kept-origin',detail:{candidates:[{id:'current-root-id',keep:true}]}};
  fixture.meta.set('memory-events:'+JSON.stringify(['owner-a','chat']),[event]);
  const lineage={root_id:'chat',fork_revision:2,source:{keep:'provenance'}};
  const pending={request_id:'branch-'+mode,withdrawn:0 as const,revisions:{profile:3,chat:7},
    changes:[{id:'profile',kind:'profile' as const,base_revision:0,payload:{storage_policy:'sync',old:'OTHER PAYLOAD '.repeat(50000)},deleted:false},
      {id:'chat',kind:'conversation' as const,base_revision:2,payload:sentPayload,deleted:false}],
    receipt:{changes:[{id:'profile',revision:1,deleted:false},{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true,lineage}]}};
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>writeOutbox(tx,'owner-a',pending,done));
  const sourceKey=JSON.stringify(['owner-a','chat']),original=structuredClone(fixture.entities.get(sourceKey));
  const originalParts=[...fixture.parts].filter(([key])=>{const parts=JSON.parse(key);return parts[1]==='entity'&&parts[2]==='chat';});
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    expect(init?.method??'GET').toBe('GET');
    return Response.json(path==='/api/mobile/status'?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{changes:[],cursor:0,has_more:false});
  });
  const finish=JsonStream.prototype.finish,roots:number[]=[],spy=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){
    const value=finish.call(this);
    if(Array.isArray(value?.messages))roots.push(value.messages.length);
    for(const change of Array.isArray(value)?value:value?.changes??[])if(Array.isArray(change.payload?.messages))roots.push(change.payload.messages.length);
    return value;
  });
  try{await syncNow('owner-a');}finally{spy.mockRestore();}
  expect(syncState().phase,syncState().error).toBe('saved');expect(roots.length).toBeGreaterThanOrEqual(2);expect(roots.every(count=>count===0)).toBe(true);
  const branch=get('fork'),expected=mode==='live'?current.payload:sentPayload;
  expect(branch).toMatchObject({revision:8,serverRevision:1,dirty:mode==='live',deleted:false});
  expect(branch.payload.messages.map((m:any)=>m.content)).toEqual(expected.messages.map((m:any)=>m.content));
  expect(branch.payload.messages.map((m:any)=>m.uuid)).toEqual(expected.messages.map((m:any)=>m.uuid));
  expect(branch.payload.messages.map((m:any)=>m.id)).toEqual([901,902,903,904]);
  expect(branch.payload).toMatchObject({branch_of:'chat',fork_revision:2,lineage,last_generation:null,settings:{session_id:'fork'},state:{session_id:'fork'}});
  expect(branch.payload.delete_confirmation_revision).toBeUndefined();
  const memory=branch.payload.memories.find((m:any)=>m.uuid===sentPayload.memories[0].uuid),memoryId=mode==='tombstone'?null:memory.id;
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['owner-a','fork']))).toEqual([{...event,scope:'fork',memory_id:memoryId,source_memory_id:'current-root-id',detail:{candidates:[{id:memoryId,source_id:'current-root-id',keep:true}]}}]);
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['owner-a','chat']))).toEqual([event]);
  expect(fixture.entities.get(sourceKey)).toEqual({...original,...(mode==='live'?{dirty:false}:{})});
  for(const [key,bytes] of originalParts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
  expect(get('unrelated')).toEqual(unrelated);expect(get('foreign','owner-b')).toEqual(foreign);
  expect(fixture.meta.has('sync:owner-a:outbox')).toBe(false);
});

it('rejects branch receipts for entity kinds that the Cloud never branches',async()=>{
  const source:AppEntity={...local('profile'),kind:'profile',dirty:true,payload:{storage_policy:'sync',private:'retain'}};
  put(source);
  const pending={request_id:'invalid-profile-branch',revisions:{profile:1},changes:[{id:'profile',kind:'profile',base_revision:0,payload:source.payload,deleted:false}],
    receipt:{changes:[{id:'fork',source_id:'profile',revision:1,deleted:false,branched:true}]}};
  fixture.meta.set('sync:owner-a:outbox',pending);
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    expect(init?.method??'GET').toBe('GET');
    return Response.json(path==='/api/mobile/status'?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{changes:[],cursor:0,has_more:false});
  });
  await syncNow('owner-a');
  expect(syncState().phase).toBe('error');expect(get('profile')).toEqual(source);expect(get('fork')).toBeUndefined();
  expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(pending);expect(fixture.parts.size).toBe(0);
});

it.each(['consent','outbox','revisions'])('rolls back branch settlement after a late same-transaction %s change',async change=>{
  const source={...local('chat'),dirty:true};
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const pending={request_id:'late-branch-control',revisions:{chat:1},changes:[{id:'chat',kind:'conversation',base_revision:0,payload:source.payload,deleted:false}],
    receipt:{changes:[{id:'fork',source_id:'chat',revision:1,deleted:false,branched:true}]}};
  fixture.meta.set('sync:owner-a:outbox',pending);
  const entities=structuredClone([...fixture.entities]),parts=structuredClone([...fixture.parts]),clone=structuredClone;let metadata:Map<string,any>|undefined,injected=false;
  const spy=vi.spyOn(globalThis,'structuredClone').mockImplementation((value:any,options?:StructuredSerializeOptions)=>{
    const copy=clone(value,options);if(value===fixture.meta)metadata=copy;return copy;
  });
  fixture.readHook=(mode,kind,id)=>{
    if(injected||mode!=='readwrite'||kind!=='part'||id!=='entity')return;
    injected=true;
    if(change==='consent')metadata!.set('sync:owner-a:consent',false);
    else if(change==='revisions')metadata!.set('sync:owner-a:outbox',{...metadata!.get('sync:owner-a:outbox'),revisions:{chat:2}});
    else metadata!.set('sync:owner-a:outbox',{...metadata!.get('sync:owner-a:outbox'),request_id:'different-fixed-request'});
  };
  vi.mocked(cloudFetch).mockImplementation(async(path,init)=>{
    expect(init?.method??'GET').toBe('GET');
    return Response.json(path==='/api/mobile/status'?{cloud_mode:true,authenticated:true,owner_scope:'owner-a'}:{changes:[],cursor:0,has_more:false});
  });
  try{await syncNow('owner-a');}finally{spy.mockRestore();}
  expect(injected).toBe(true);expect(syncState().phase).toBe('error');expect([...fixture.entities]).toEqual(entities);
  expect(fixture.meta.get('sync:owner-a:outbox')).toEqual(pending);expect(fixture.meta.get('sync:owner-a:consent')).toBe(true);
  expect([...fixture.parts.keys()]).toEqual(parts.map(([key])=>key));
  for(const [key,bytes] of parts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
});

it('projects only previous message identities for segmented receive while preserving old remapping',async()=>{
  let number=100;
  const prior=syncData.rebindConversation(syncData.receiveConversation(sharedHistory.payload,undefined,()=>++number),'chat');
  for(const message of prior.messages)message.content+='茶🙂'.repeat(100000);
  const source={...local('chat'),payload:prior,serverRevision:2};
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const unrelated=local('unrelated');unrelated.payload.messages[0].id=900;put(unrelated);
  const foreign=local('foreign','owner-b');foreign.payload.messages[0].id=9_000_000;put(foreign);
  const incoming=structuredClone(sharedHistory.payload);incoming.messages.push({id:5,uuid:'new-incoming-message',role:'user',content:'newer'} as any);
  const expected=syncData.rebindConversation(syncData.receiveConversation(incoming,prior,()=>901),'chat');
  const normalize=(payload:any)=>{
    const p=structuredClone(payload);for(const point of [p,...p.messages.flatMap((m:any)=>[m.before,m.after].filter(Boolean))])for(const memory of point.memories??[])memory.id=memory.uuid;
    return p;
  };
  const receive=syncData.receiveConversation,projected:any[]=[],roots:number[]=[],finish=JsonStream.prototype.finish;
  const receiver=vi.spyOn(syncData,'receiveConversation').mockImplementation((payload,previous,allocate)=>{projected.push(structuredClone(previous));return receive(payload,previous,allocate);});
  const parser=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){const p=finish.call(this);if(Array.isArray(p?.messages))roots.push(p.messages.length);return p;});
  try{await receiveSyncPage('owner-a',[{id:'chat',kind:'conversation',revision:3,deleted:false,payload:incoming}],7);}
  finally{receiver.mockRestore();parser.mockRestore();}
  expect(projected).toHaveLength(1);expect(projected[0].messages).toEqual(prior.messages.map((m:any)=>({id:m.id,uuid:m.uuid})));
  expect(projected[0].memories).toEqual(prior.memories);expect(roots.length).toBeGreaterThan(0);expect(roots.every(count=>count===0)).toBe(true);
  const saved=get('chat');expect(normalize(saved.payload)).toEqual(normalize(expected));expect(saved.payload.memories[0].id).toBe(prior.memories[0].id);
  expect(saved.payload.messages.map((m:any)=>m.id)).toEqual([101,102,103,104,901]);expect(saved).toMatchObject({revision:2,serverRevision:3,dirty:false});
  expect(fixture.meta.get('sync:owner-a:cursor')).toBe(7);expect(get('unrelated')).toEqual(unrelated);expect(get('foreign','owner-b')).toEqual(foreign);
});

it.each(['corrupt','missing'])('rolls back a receive page with a %s final previous-source part',async failure=>{
  const source={...local('chat'),serverRevision:2};source.payload.messages[0].content+='茶🙂'.repeat(500000);
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const header=fixture.entities.get(JSON.stringify(['owner-a','chat'])),ref=header.payloadParts;
  const part=JSON.stringify(['owner-a','entity','chat',ref.token,ref.chunks-1]);
  if(failure==='missing')fixture.parts.delete(part);else fixture.parts.get(part)[0]^=1;
  const entities=structuredClone([...fixture.entities]),parts=structuredClone([...fixture.parts]);
  await expect(receiveSyncPage('owner-a',[remote('chat',3)],8)).rejects.toThrow('aborted');
  expect([...fixture.entities]).toEqual(entities);expect(fixture.meta.has('sync:owner-a:cursor')).toBe(false);
  expect([...fixture.parts.keys()]).toEqual(parts.map(([key])=>key));
  for(const [key,bytes] of parts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
});

it('retains full unsent history when deletion follows a skipped update for the same page identity',async()=>{
  const source={...local('chat'),dirty:true,payload:structuredClone(sharedHistory.payload)};
  for(const message of source.payload.messages)message.content+='UNSENT 茶🙂'.repeat(50000);
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  await receiveSyncPage('owner-a',[remote('chat',2),{id:'chat',kind:'conversation',revision:3,deleted:true,payload:{}}],9);
  const recovery=[...fixture.entities.values()].map(value=>decoded(value,fixture.parts)).find(value=>value.id!=='chat'&&value.payload.recovery_from==='chat');
  expect(recovery?.payload.messages.map((m:any)=>m.content)).toEqual(source.payload.messages.map((m:any)=>m.content));
  expect(recovery?.payload).toMatchObject({storage_policy:'local',recovery_from:'chat',last_generation:null});
  expect(get('chat').deleted).toBe(true);expect(fixture.meta.get('sync:owner-a:cursor')).toBe(9);
});

it('skips an already received segmented payload reference using its header without reading body parts',async()=>{
  const source={...local('chat'),serverRevision:7};source.payload.messages[0].content+='茶🙂'.repeat(500000);
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  const original=structuredClone(fixture.entities.get(JSON.stringify(['owner-a','chat'])));let served=false,bodyReads=0;
  fixture.readHook=(_mode,kind,id)=>{if(kind==='part'&&id==='entity'){bodyReads++;throw Error('Unneeded body read');}};
  vi.mocked(cloudFetch).mockImplementation(async path=>{
    if(path==='/api/mobile/status')return Response.json({cloud_mode:true,authenticated:true,owner_scope:'owner-a'});
    expect(path).not.toContain('/parts/');
    const changes=served?[]:[{id:'chat',kind:'conversation',revision:7,deleted:false,payload_ref:{unread:true}}];served=true;
    return Response.json({changes,cursor:7,has_more:false});
  });
  await syncNow('owner-a');expect(syncState().phase,syncState().error).toBe('saved');expect(bodyReads).toBe(0);
  expect(fixture.entities.get(JSON.stringify(['owner-a','chat']))).toEqual(original);expect(fixture.meta.get('sync:owner-a:cursor')).toBe(7);
});
