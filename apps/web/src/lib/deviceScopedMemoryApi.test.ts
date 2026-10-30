import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { harness } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),fail:false}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>{
  const store=await original<typeof import('./appStore')>();
  const transaction=(_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,
    {write:()=>{if(fixture.fail)throw Error('Fictional quota failure');}});
  return {...store,appTransaction:transaction,entity:(id:string,owner:string)=>transaction(['entities'],'readonly',(tx:any,done:any)=>store.readEntity(tx,owner,id,done)),
    allEntities:(owner:string)=>transaction(['entities'],'readonly',(tx:any,done:any)=>{
      const result:unknown[]=[],read=tx.objectStore('entities').openCursor({lower:[owner,'']});
      read.onsuccess=()=>{const cursor=read.result;if(!cursor){done(result);return;}
        store.readEntity(tx,owner,cursor.value.id,value=>{result.push(value);cursor.continue();});};
    })};
});
import { newEntity,entity,type AppEntity } from './appStore';
import { readDeviceMemoryDomain,commitDeviceMemoryDomain } from './deviceMemoryStore';
import { memoryIdentity,memoryBinding } from './deviceMemoryScopes';
import { deviceMemoryScope } from './deviceScopedMemory';
import { scopedMemoryRoute } from './deviceScopedMemoryApi';

beforeEach(()=>{fixture.owner='owner-a';fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.fail=false;
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
});
afterEach(()=>vi.unstubAllGlobals());
const resolve=async(settings:Record<string,any>)=>memoryIdentity(settings,{character_id:settings.version??'1',persona_id:null,world_id:null});
function record(sid:string,policy='local',mode:string|null='world',content='Tea is a favorite'){
  const memory={id:'memory-'+sid,scope:sid,type:'semantic',content,origin:'user',supported:null,status:'active',version:1,
    source_session_id:sid,source_message_ids:[1],created_at:'2026-10-30',updated_at:'2026-10-30'};
  const session=newEntity('conversation',sid,{storage_policy:policy,...(mode?{memory_scope_mode:mode}:{}),settings:{session_id:sid,character_id:'character'},
    messages:[{id:1,role:'user',content,after:{memories:[memory]}}],memories:[memory],memory_enabled:false});
  session.revision=1;fixture.records.set(JSON.stringify([session.owner,sid]),structuredClone(session));return session;
}
const conversation=async(sid:string,owner:string)=>{
  const value=await entity(sid,owner);if(!value||value.deleted)throw Object.assign(Error('Not found'),{status:404});return value;
};
const route=(path:string,method='GET',body:Record<string,any>={})=>{
  const url=new URL(path,'https://app.test');return scopedMemoryRoute(url.pathname,method,body,url,fixture.owner,conversation,resolve);
};
const data=async(path:string,method='GET',body:Record<string,any>={})=>(await route(path,method,body))!.json();
const saved=(sid:string)=>entity(sid,fixture.owner) as Promise<AppEntity>;
async function prepare(sid:string,policy='local'){
  record(sid,policy);return (await data('/api/memory/session/'+sid,'PUT',{enabled:true})).scope as string;
}

it('preserves legacy/raw/unknown-ID routes and does not bind a new world session on GET',async()=>{
  record('legacy','local',null);record('new');
  for(const path of ['/api/memory/session/legacy','/api/memory?scope=legacy','/api/memory/missing','/api/chat'])expect(await route(path)).toBeNull();
  expect(await data('/api/memory/session/new')).toEqual({session_id:'new',scope:'new',enabled:false});
  expect((await readDeviceMemoryDomain(fixture.owner,'local')).bindings).toEqual({});
  expect((await saved('new')).revision).toBe(1);
  expect(await route('/api/memory/events?scope=legacy')).toBeNull();
  expect(await route('/api/memory/search','POST',{scope:'legacy',query:'tea'})).toBeNull();
});

it('binds world sessions on toggle, returns policy addresses and lists distinct local/sync pools with legacy scopes',async()=>{
  const local=await prepare('a'),sync=await prepare('b','sync');record('legacy','local',null);
  expect(local).toMatch(/^work:.+\|device:local$/);expect(sync).toBe(local.replace('device:local','device:sync'));
  expect((await data('/api/memory/session/a')).scope).toBe(local);
  const scopes=(await data('/api/memory/scopes')).scopes;
  expect(scopes.map((s:any)=>s.scope).sort()).toEqual([local,sync,'legacy'].sort());
  expect(scopes.every((s:any)=>s.active===1&&s.total===1)).toBe(true);
});

it('reads and searches the real shared pool without projecting foreign memory IDs into other conversations',async()=>{
  const scope=await prepare('a');await prepare('b');
  const rows=(await data('/api/memory?scope='+encodeURIComponent(scope))).memories;
  expect(rows.map((m:any)=>m.id)).toEqual(['memory-a','memory-b']);expect(rows.every((m:any)=>m.scope===scope)).toBe(true);
  const search=await data('/api/memory/search','POST',{scope,query:'Tea',top_k:1,budget_tokens:300});
  expect(search.stored_count).toBe(2);expect(search.injected).toHaveLength(1);expect(search.block).toContain('Tea');
  for(const sid of ['a','b']){
    const session=await saved(sid);expect(session.payload.memories.map((m:any)=>m.source_session_id)).toEqual([sid]);
    expect(session.payload.messages[0].after.memories[0].source_session_id).toBe(sid);
  }
});

it('creates attributed manual memory, stamps its audit source and updates only its source projection',async()=>{
  const scope=await prepare('a');await prepare('b');const beforeA=await saved('a');
  const added=await data('/api/memory','POST',{scope,type:'semantic',content:'  More\n tea  ',source_session_id:'b'});
  expect(added.content).toBe('More tea');expect(added.scope).toBe(scope);
  const detail=await data('/api/memory/'+added.id);expect(detail.events[0].source_session_id).toBe('b');expect(detail.events[0].scope).toBe(scope);
  expect(await saved('a')).toEqual(beforeA);
  const session=await saved('b');expect(session.payload.memories.at(-1).source_session_id).toBe('b');
  expect(session.payload.messages[0].after.memories).toHaveLength(1);
});

it('allows a validated newly bound same-scope source and rejects a fabricated missing source',async()=>{
  const scope=await prepare('a');record('b');
  await expect(route('/api/memory','POST',{scope,type:'semantic',content:'Tea',source_session_id:'missing'})).rejects.toMatchObject({status:404});
  await data('/api/memory','POST',{scope,type:'semantic',content:'Coffee',source_session_id:'b'});
  const domain=await readDeviceMemoryDomain(fixture.owner,'local');expect(memoryBinding(domain,'b').scope).toBe(memoryBinding(domain,'a').scope);
  expect((await saved('b')).payload.memories.at(-1).content).toBe('Coffee');
});

it('keeps no-source additions global with null holders and out of every canonical conversation',async()=>{
  const scope=await prepare('a');const before=await saved('a');
  const added=await data('/api/memory','POST',{scope,type:'relationship',content:'Global setting'});
  const domain=await readDeviceMemoryDomain(fixture.owner,'local'),pool=domain.pools[memoryBinding(domain,'a').scope];
  expect(added.source_session_id).toBeNull();expect(pool.holders[JSON.stringify(added.id)]).toBeNull();
  expect(pool.events.at(-1)?.source_session_id).toBeNull();expect(await saved('a')).toEqual(before);
});

it.each(['wrong-policy','wrong-scope','pending','deleted','branch','recovery'])('rejects ineligible manual source: %s',async(reason)=>{
  const scope=await prepare('a'),source=record('b',reason==='wrong-policy'?'sync':'local');
  if(reason==='wrong-scope')source.payload.settings.character_id='other';
  if(reason==='pending')source.payload.pending_generation='active';
  if(reason==='deleted')source.deleted=true;
  if(reason==='branch')source.payload.branch_of='a';
  if(reason==='recovery')source.payload.recovery_from='a';
  fixture.records.set(JSON.stringify([fixture.owner,'b']),source);const before=structuredClone(fixture.meta);
  await expect(route('/api/memory','POST',{scope,type:'semantic',content:'No',source_session_id:'b'})).rejects.toMatchObject({status:reason==='deleted'?404:409});
  expect(fixture.meta).toEqual(before);
});

it('supports update, no-op update, deletion, include_deleted and newest-first detail/events',async()=>{
  const scope=await prepare('a');const memory=await data('/api/memory','POST',{scope,type:'semantic',content:'Old',source_session_id:'a'});
  const updated=await data('/api/memory/'+memory.id,'PATCH',{type:'episodic',content:'New'});
  expect(updated).toMatchObject({type:'episodic',content:'New',version:2,source_kind:'user_correction'});
  const revision=(await saved('a')).revision;
  await data('/api/memory/'+memory.id,'PUT',{content:'New'});expect((await saved('a')).revision).toBe(revision);
  await data('/api/memory/'+memory.id,'DELETE');
  const detail=await data('/api/memory/'+memory.id);expect(detail.status).toBe('deleted');expect(detail.events.map((e:any)=>e.op)).toEqual(['delete','update','create']);
  expect((await data('/api/memory?scope='+encodeURIComponent(scope))).memories).toHaveLength(1);
  expect((await data('/api/memory?include_deleted=true&scope='+encodeURIComponent(scope))).memories).toHaveLength(2);
  const events=await data('/api/memory/events?limit=1&scope='+encodeURIComponent(scope));expect(events.events.map((e:any)=>e.op)).toEqual(['delete']);
  await expect(route('/api/memory/'+memory.id,'PATCH',{content:'revive'})).rejects.toMatchObject({status:404});
});

it('filters deleted and differently stored sources from rows, search, events and direct detail',async()=>{
  const scope=await prepare('a');await prepare('b');
  const added=await data('/api/memory','POST',{scope,type:'semantic',content:'Private B fact',source_session_id:'b'});
  const b=await saved('b');b.payload.storage_policy='sync';fixture.records.set(JSON.stringify([fixture.owner,'b']),b);
  expect((await data('/api/memory?scope='+encodeURIComponent(scope))).memories.map((m:any)=>m.id)).toEqual(['memory-a']);
  expect((await data('/api/memory/search','POST',{scope,query:'Private B fact'})).stored_count).toBe(1);
  expect((await data('/api/memory/events?scope='+encodeURIComponent(scope))).events).toEqual([]);
  await expect(route('/api/memory/'+added.id)).rejects.toMatchObject({status:404});
  const a=await saved('a');a.deleted=true;fixture.records.set(JSON.stringify([fixture.owner,'a']),a);
  expect((await data('/api/memory?scope='+encodeURIComponent(scope))).memories).toEqual([]);
});

it('previews legacy migration without writes, validates revision and preserves originals on shared migration',async()=>{
  record('old','local',null);const before=structuredClone(fixture.records);
  const preview=await data('/api/memory/session/old/scope-preview');expect(preview.memories).toHaveLength(1);
  expect(fixture.meta.size).toBe(0);expect(fixture.records).toEqual(before);
  await expect(route('/api/memory/session/old/scope-migrate','POST',{expected_revision:'stale',share:true})).rejects.toMatchObject({status:409});
  const result=await data('/api/memory/session/old/scope-migrate','POST',{expected_revision:preview.preview_revision,share:true});
  expect(result.scope).toBe('char:character|persona:default|device:local');expect(result.copied).toBe(1);
  const domain=await readDeviceMemoryDomain(fixture.owner,'local');expect(domain.pools['session:old'].memories[0].id).toBe('memory-old');
  const session=await saved('old');expect(session.payload.memory_scope_mode).toBe('shared');expect(session.payload.memories[0].id).not.toBe('memory-old');
  expect(session.payload.memories[0].source_session_id).toBe('old');expect(session.payload.messages[0].after.memories[0].id).toBe('memory-old');
  expect((await data('/api/memory/session/old')).scope).toBe(result.scope);
});

it('migrates legacy sessions to world mode and rejects branch/recovery migration',async()=>{
  record('old','local',null);const preview=await data('/api/memory/session/old/scope-preview');
  const result=await data('/api/memory/session/old/scope-migrate','POST',{expected_revision:preview.preview_revision,share:false});
  expect(result.scope).toMatch(/^work:/);expect((await saved('old')).payload.memory_scope_mode).toBe('world');
  for(const flag of ['branch_of','recovery_from']){
    const session=record(flag);session.payload[flag]='old';fixture.records.set(JSON.stringify([fixture.owner,flag]),session);
    for(const [suffix,method] of [['scope-preview','GET'],['scope-migrate','POST']])
      await expect(route('/api/memory/session/'+flag+'/'+suffix,method,{expected_revision:'anything',share:true})).rejects.toMatchObject({status:409});
  }
});

it('clears the real shared pool and all live own projections while retaining authored snapshots',async()=>{
  const scope=await prepare('a');await prepare('b');
  await data('/api/memory','POST',{scope,type:'semantic',content:'Extra',source_session_id:'b'});
  const snapshots=await Promise.all(['a','b'].map(async sid=>(await saved(sid)).payload.messages));
  expect(await data('/api/memory/session/a/data','DELETE')).toEqual({ok:true,scope,affects_shared_sessions:true});
  for(const [i,sid] of ['a','b'].entries()){
    const session=await saved(sid);expect(session.payload.memories).toEqual([]);expect(session.payload.messages).toEqual(snapshots[i]);
  }
  expect((await data('/api/memory/events?scope='+encodeURIComponent(scope))).events).toEqual([]);
  expect((await data('/api/memory?scope='+encodeURIComponent(scope))).memories).toEqual([]);
});

it('rolls back shared clear atomically on quota failure',async()=>{
  await prepare('a');await prepare('b');const before=[structuredClone(fixture.records),structuredClone(fixture.meta),structuredClone(fixture.parts)];
  fixture.fail=true;await expect(route('/api/memory/session/a/data','DELETE')).rejects.toThrow('aborted');fixture.fail=false;
  expect([fixture.records,fixture.meta,fixture.parts]).toEqual(before);
});

it('fences mutations while domain generation is pending but permits inspection',async()=>{
  const scope=await prepare('a'),domain=await readDeviceMemoryDomain(fixture.owner,'local'),session=await saved('a');
  domain.pending={session_id:'a',generation_id:'gen'};session.payload.pending_generation='gen';
  await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:'a',revision:session.revision}],[session],
    {gen:{generation_id:'gen',session_id:'a',status:'pending'}});
  expect((await data('/api/memory?scope='+encodeURIComponent(scope))).memories).toHaveLength(1);
  await expect(route('/api/memory','POST',{scope,type:'semantic',content:'No'})).rejects.toMatchObject({status:409});
  await expect(route('/api/memory/session/a/data','DELETE')).rejects.toMatchObject({status:409});
});

it.each([
  ['/api/memory/scopes','POST',{}],['/api/memory/search','GET',{}],['/api/memory/events','DELETE',{}],
  ['/api/memory/session/a/data','GET',{}],['/api/memory/session/a/scope-preview','POST',{}],
  ['/api/memory/session/a/scope-migrate','GET',{}],['/api/memory/memory-a','POST',{}],
] as const)('rejects unsupported method %s %s',async(path,method,body)=>{
  await expect(route(path,method,body)).rejects.toMatchObject({status:405});
});

it.each([
  {content:' '.repeat(4)},{content:'x'.repeat(201)},{type:'invalid'},{source_kind:'invalid'},
  {source_quote:12},{source_quote:'x'.repeat(2001)},{source_revision:12},{source_session_id:''},
])('validates scoped manual additions: %j',async(invalid)=>{
  const scope=await prepare('a');await expect(route('/api/memory','POST',{scope,type:'semantic',content:'Valid',...invalid})).rejects.toMatchObject({status:400});
});

it('enforces search limits, integer event limits and boolean toggle/migration flags',async()=>{
  const scope=await prepare('a');
  for(const invalid of [{query:'x'.repeat(4001)},{top_k:0},{top_k:21},{budget_tokens:19},{budget_tokens:4001}])
    await expect(route('/api/memory/search','POST',{scope,query:'Tea',...invalid})).rejects.toMatchObject({status:400});
  await expect(route('/api/memory/events?limit=1.5&scope='+encodeURIComponent(scope))).rejects.toMatchObject({status:400});
  await expect(route('/api/memory/session/a','PUT',{enabled:1})).rejects.toMatchObject({status:400});
  await expect(route('/api/memory/session/a/scope-migrate','POST',{expected_revision:'any',share:'true'})).rejects.toMatchObject({status:400});
});

it('does not expose another owner through scoped addresses or memory IDs',async()=>{
  const scope=await prepare('a');fixture.owner='owner-b';
  expect(await route('/api/memory/memory-a')).toBeNull();
  await expect(route('/api/memory?scope='+encodeURIComponent(scope))).rejects.toMatchObject({status:409});
  expect(await route('/api/memory/scopes')).toBeNull();
});

it('rejects ambiguous memory IDs across policies while preserving scope-addressed access',async()=>{
  const local=await prepare('a'),b=record('b','sync');b.payload.memories[0].id='memory-a';
  fixture.records.set(JSON.stringify([fixture.owner,'b']),b);
  const sync=(await data('/api/memory/session/b','PUT',{enabled:true})).scope;
  await expect(route('/api/memory/memory-a','PATCH',{content:'Ambiguous'})).rejects.toMatchObject({status:409});
  expect((await data('/api/memory?scope='+encodeURIComponent(local))).memories[0].source_session_id).toBe('a');
  expect((await data('/api/memory?scope='+encodeURIComponent(sync))).memories[0].source_session_id).toBe('b');
});

it('requires explicit preview to cross asset versions and keeps the previous world pool intact',async()=>{
  const oldScope=await prepare('a'),a=await saved('a');a.payload.settings.version='2';a.revision++;
  fixture.records.set(JSON.stringify([fixture.owner,'a']),a);
  await expect(route('/api/memory/session/a','PUT',{enabled:false})).rejects.toMatchObject({status:409});
  const preview=await data('/api/memory/session/a/scope-preview');expect(preview.target_scope).not.toBe(oldScope);
  const result=await data('/api/memory/session/a/scope-migrate','POST',{expected_revision:preview.preview_revision});
  expect(result.scope).toBe(preview.target_scope);expect(result.copied).toBe(1);
  expect((await data('/api/memory?scope='+encodeURIComponent(oldScope))).memories[0].id).toBe('memory-a');
  expect((await saved('a')).payload.memories[0].id).not.toBe('memory-a');
});

it('clears one policy without altering the other policy pool or conversation',async()=>{
  await prepare('a');const sync=await prepare('b','sync'),before=await saved('b');
  await data('/api/memory/session/a/data','DELETE');
  expect(await saved('b')).toEqual(before);
  expect((await data('/api/memory?scope='+encodeURIComponent(sync))).memories).toHaveLength(1);
});
