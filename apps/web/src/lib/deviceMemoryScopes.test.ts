import { expect, it } from 'vitest';
import cases from '../../../../tests/fixtures/unified-memory-scopes.json';
import { newEntity } from './appStore';
import { memoryIdentity,worldMemoryScope,sharedMemoryScope,emptyMemoryDomain,bindMemoryScope,memoryBinding,
  ownScopeMemories,previewMemoryMigration,migrateMemoryDomain,eraseMemoryDomain,reconcileScopeMemories,memoryDomainKey,appendScopeEvent } from './deviceMemoryScopes';

const identity=(world='harbor',version='1.0.0')=>memoryIdentity({character_id:'character',world_id:world},
  {character_id:version,persona_id:null,world_id:'1.0.0'});
const memory=(id:string,sid:string|null=id)=>({id,type:'semantic' as const,content:'fact '+id,scope:sid??'',origin:'user',supported:null,status:'active',
  version:3,source_kind:'user_statement',source_session_id:sid,source_quote:'quote '+id,source_revision:'manual:3',source_message_ids:[1]});
const session=(sid:string,memories=[memory(sid)],mode='world')=>newEntity('conversation',sid,{storage_policy:'local',settings:{session_id:sid},
  memories,messages:[{id:1,uuid:'source-'+sid,role:'user',content:'source'}],memory_scope_mode:mode});
const project=(state:ReturnType<typeof emptyMemoryDomain>,record:ReturnType<typeof session>)=>{
  record.payload.memories=ownScopeMemories(state.pools[memoryBinding(state,record.id).scope],record.id);
};

it.each(cases.cases)('matches Python normalized identity and logical scope IDs: $name',c=>{
  const actual=memoryIdentity(c.settings,c.identity.versions);
  expect(actual).toEqual(c.identity);expect(worldMemoryScope(actual,c.settings.session_id)).toBe(c.world_scope);
  expect(sharedMemoryScope(actual,c.settings.session_id)).toBe(c.shared_scope);
});

it('retrieves from a common pool while canonical projections contain only their own message sources',()=>{
  const state=emptyMemoryDomain(),a=session('a'),b=session('b'),world=identity();
  const first=bindMemoryScope(state,a,world),second=bindMemoryScope(state,b,world);
  expect(second.scope).toBe(first.scope);expect(state.pools[first.scope].memories).toHaveLength(2);
  expect(ownScopeMemories(state.pools[first.scope],'a')).toEqual([{...memory('a'),scope:'a'}]);
  expect(ownScopeMemories(state.pools[first.scope],'b')).toEqual([{...memory('b'),scope:'b'}]);
});

it.each(['legacy','branch'])('preserves independent %s conversations across world changes',mode=>{
  const state=emptyMemoryDomain(),record=session('own',undefined,mode);if(mode==='branch')record.payload.branch_of='origin';
  const first=bindMemoryScope(state,record,identity());
  expect(first.scope).toBe('session:own');expect(first.mode).toBe(mode);
  expect(bindMemoryScope(state,record,identity('other')).scope).toBe(first.scope);
});

it('changes world identity without mixing old memories and retains the original pool',()=>{
  const state=emptyMemoryDomain(),record=session('own');
  const original=bindMemoryScope(state,record,identity()).scope;
  const next=bindMemoryScope(state,record,identity('other'));
  expect(next.scope).not.toBe(original);expect(ownScopeMemories(state.pools[next.scope],record.id)).toEqual([]);
  expect(state.pools[original].memories[0].content).toBe('fact own');
  project(state,record);expect(bindMemoryScope(state,record,identity()).scope).toBe(original);
  expect(ownScopeMemories(state.pools[original],record.id)).toHaveLength(1);
});

it('requires explicit preview after same-asset version drift even with memory disabled',()=>{
  const state=emptyMemoryDomain(),record=session('own');record.payload.memory_enabled=false;
  const old=bindMemoryScope(state,record,identity()).scope,newIdentity=identity('harbor','2.0.0');
  expect(()=>bindMemoryScope(state,record,newIdentity)).toThrow('Asset version changed');
  const before=structuredClone(state),preview=previewMemoryMigration(state,record,newIdentity);
  expect(state).toEqual(before);expect(preview.previous_identity.versions.character_id).toBe('1.0.0');
  migrateMemoryDomain(state,record,newIdentity,preview.preview_revision);project(state,record);
  expect(bindMemoryScope(state,record,newIdentity).scope).not.toBe(old);expect(state.pools[old].memories).toHaveLength(1);
});

it('retains originals, infers only attributable legacy ownership and rejects stale migration previews',()=>{
  const state=emptyMemoryDomain(),record=session('legacy',[memory('manual',null)],'legacy'),world=identity();
  record.payload.memories[0].source_message_ids=[];bindMemoryScope(state,record,world);
  const preview=previewMemoryMigration(state,record,world),before=structuredClone(state);
  expect(()=>migrateMemoryDomain(state,record,world,'stale')).toThrow('preview migration again');expect(state).toEqual(before);
  const result=migrateMemoryDomain(state,record,world,preview.preview_revision,true,()=> 'copied','2026-10-30T00:00:00Z');
  expect(result.copied).toBe(1);expect(state.pools['session:legacy'].memories[0].source_session_id).toBeNull();
  const copied=state.pools[result.scope].memories[0];
  expect(copied).toMatchObject({id:'copied',source_session_id:'legacy',version:1,source_quote:'quote manual',source_revision:'manual:3',source_message_ids:[]});
  project(state,record);expect(bindMemoryScope(state,record,identity('other')).scope).toBe(result.scope);
  const fresh=previewMemoryMigration(state,record,identity('other'));
  expect(migrateMemoryDomain(state,record,identity('other'),fresh.preview_revision,true).copied).toBe(0);
});

it('keeps foreign shared copies out of canonical exports and erases source copies across retained pools',()=>{
  const state=emptyMemoryDomain(),a=session('a'),b=session('b'),world=identity();
  bindMemoryScope(state,a,world);bindMemoryScope(state,b,world);
  const preview=previewMemoryMigration(state,a,world);
  migrateMemoryDomain(state,a,world,preview.preview_revision,true);project(state,a);
  expect(a.payload.memories).toHaveLength(1);expect(a.payload.memories[0].source_session_id).toBe('a');
  const target=state.pools[memoryBinding(state,'a').scope];expect(target.memories).toHaveLength(2);
  eraseMemoryDomain(state,'a');
  for(const pool of Object.values(state.pools))expect(pool.memories.every(m=>m.source_session_id==='b')).toBe(true);
  expect(()=>bindMemoryScope(state,a,world)).toThrow('Conversation deleted');
  expect(ownScopeMemories(state.pools[memoryBinding(state,'b').scope],'b')).toHaveLength(1);
});

it('rejects pending migration/erasure without mutating the source',()=>{
  const state=emptyMemoryDomain(),record=session('own'),world=identity();bindMemoryScope(state,record,world);
  const preview=previewMemoryMigration(state,record,world);state.pending={session_id:'other',generation_id:'active'};
  const before=structuredClone(state);
  expect(()=>migrateMemoryDomain(state,record,world,preview.preview_revision,true)).toThrow('Stop generation');
  expect(()=>eraseMemoryDomain(state,'own')).toThrow('Stop all generations');expect(state).toEqual(before);
});

it('requires explicit review when both incoming memories and world identity changed',()=>{
  const state=emptyMemoryDomain(),record=session('own'),world=identity();bindMemoryScope(state,record,world);
  record.payload.memories[0].content='received correction';
  expect(()=>bindMemoryScope(state,record,identity('different'))).toThrow('preview scope migration');
  const preview=previewMemoryMigration(state,record,identity('different'));
  expect(preview.memories[0].content).toBe('received correction');
  expect(state.pools[memoryBinding(state,record.id).scope].memories[0].content).toBe('fact own');
});

it.each(['__proto__','constructor'])('keeps arbitrary legacy session/memory keys inert: %s',id=>{
  const state=emptyMemoryDomain(),record=session(id,[memory(id,id)]),world=identity();
  bindMemoryScope(state,record,world);expect(memoryBinding(state,id).identity).toEqual(world);
  expect(ownScopeMemories(state.pools[memoryBinding(state,id).scope],id)[0].id).toBe(id);
  const before=structuredClone(state);record.payload.memories.push({...memory('forged'),source_session_id:'foreign'});
  expect(()=>reconcileScopeMemories(state,record)).toThrow('Foreign memory source');expect(state).toEqual(before);
});

it('partitions persisted domain keys by both owner and storage policy without separator collisions',()=>{
  expect(new Set([memoryDomainKey('a:b','local'),memoryDomainKey('a','local'),memoryDomainKey('a:b','sync')]).size).toBe(3);
});

it('erases audit text and historical diagnostic IDs after the canonical source row was removed',()=>{
  const state=emptyMemoryDomain(),a=session('a'),b=session('b'),world=identity();
  bindMemoryScope(state,a,world);bindMemoryScope(state,b,world);
  const pool=state.pools[memoryBinding(state,'a').scope];
  appendScopeEvent(pool,memoryBinding(state,'a').scope,'create','a',null,{content:'SOURCE SECRET'});
  // Also cover pre-attribution audit records reconciled before erasure.
  delete pool.events[0].source_session_id;
  a.payload.memories=[];reconcileScopeMemories(state,a);
  expect(pool.memories.map(m=>m.id)).toEqual(['b']);
  expect(pool.events[0].source_session_id).toBe('a');
  const result=eraseMemoryDomain(state,'a');
  expect(result.removed.has('a')).toBe(true);expect(JSON.stringify(state)).not.toContain('SOURCE SECRET');
  expect(ownScopeMemories(pool,'b')).toHaveLength(1);
});

it('retains equal facts from independent sources when either source is erased after shared migration',()=>{
  const state=emptyMemoryDomain(),world=identity(),a=session('a',undefined,'legacy'),b=session('b',undefined,'legacy');
  for(const record of [a,b]){
    record.payload.memories[0].content='same fact';bindMemoryScope(state,record,world);
    const preview=previewMemoryMigration(state,record,world);
    expect(migrateMemoryDomain(state,record,world,preview.preview_revision,true).copied).toBe(1);project(state,record);
  }
  const shared=memoryBinding(state,'b').scope;
  expect(state.pools[shared].memories.map(m=>m.source_session_id)).toEqual(['a','b']);
  const preview=previewMemoryMigration(state,b,world);
  expect(migrateMemoryDomain(state,b,world,preview.preview_revision,true).copied).toBe(0);
  eraseMemoryDomain(state,'a');
  expect(ownScopeMemories(state.pools[shared],'b')).toMatchObject([{content:'same fact',source_session_id:'b'}]);
});

it.each(['branch_of','recovery_from'])('does not merge an independent %s back into a shared pool',key=>{
  const state=emptyMemoryDomain(),record=session('independent');record.payload[key]='origin';
  bindMemoryScope(state,record,identity());const preview=previewMemoryMigration(state,record,identity()),before=structuredClone(state);
  expect(()=>migrateMemoryDomain(state,record,identity(),preview.preview_revision,true)).toThrow('must remain independent');expect(state).toEqual(before);
});
