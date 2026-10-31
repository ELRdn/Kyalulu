import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { harness } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'research-a',entities:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0,switchAt:0}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),appTransaction:(_stores:string[],mode:string,action:any)=>{
  let writes=0;return harness(fixture.entities,fixture.meta,fixture.parts,JSON.stringify,mode,action,{write:()=>{
    writes++;if(writes===fixture.failAt)throw Error('Quota');if(writes===fixture.switchAt)fixture.owner='research-b';
  }});
}}));
import { newEntity } from './appStore';
import { readResearchExperiment,writeResearchExperiment,type ResearchExperiment } from './deviceResearchStore';
const id='10000000-0000-4000-8000-000000000001',owner='research-a';
const key='device-research:'+JSON.stringify(owner)+':experiment:'+id;
const value=():ResearchExperiment=>({revision:0,meta:{experiment_id:id,status:'running',metrics:{failure_rate:0}},turns:[{turn:1,assistant:'Keep result 茶🙂'}],raw_prompt:'Keep original prompt',
  session:newEntity('conversation','exp:'+id,{storage_policy:'local',messages:[{id:1,role:'user',content:'Unsent original 茶🙂'}],state:{turn:0},pending_generation:'pending'},owner)});
const snapshot=()=>structuredClone({meta:[...fixture.meta],parts:[...fixture.parts],entities:[...fixture.entities]});
beforeEach(()=>{fixture.owner=owner;fixture.entities.clear();fixture.meta.clear();fixture.parts.clear();fixture.failAt=0;fixture.switchAt=0;});
afterEach(()=>vi.unstubAllGlobals());

it('roundtrips legacy and segmented experiments with original extensions and removes only superseded parts',async()=>{
  const source={...value(),revision:3,extra:{keep:'legacy extension'}};fixture.meta.set(key,structuredClone(source));
  fixture.meta.set('sync:research-a:outbox',{request_id:'fixed',keep:'Unsent snapshot'});
  fixture.parts.set(JSON.stringify([owner,'unrelated','keep']),new Uint8Array([7]));
  expect(await readResearchExperiment(owner,id)).toEqual(source);
  const revision=await writeResearchExperiment(owner,id,source),header=fixture.meta.get(key);
  expect(header).toMatchObject({format:'device-research@1',revision:4});
  expect(header.session).toBeUndefined();expect(header.turns).toBeUndefined();expect(header.raw_prompt).toBeUndefined();
  expect(await readResearchExperiment(owner,id)).toEqual({...source,revision});
  const previousKeys=[...fixture.parts.keys()].filter(k=>k.includes(header.bodyParts.token));
  const changed={...source,revision,meta:{...source.meta,status:'completed'}};
  expect(await writeResearchExperiment(owner,id,changed)).toBe(5);
  expect(await readResearchExperiment(owner,id)).toEqual({...changed,revision:5});
  expect(previousKeys.every(k=>!fixture.parts.has(k))).toBe(true);
  expect(fixture.meta.get('sync:research-a:outbox')).toEqual({request_id:'fixed',keep:'Unsent snapshot'});
  expect(fixture.parts.get(JSON.stringify([owner,'unrelated','keep']))).toEqual(new Uint8Array([7]));
  expect(fixture.entities.size).toBe(0);
});
it.each(['legacy','segmented'])('rolls back quota and account changes without losing the %s source',async kind=>{
  const source=value();let revision=0;
  if(kind==='legacy')fixture.meta.set(key,structuredClone(source));else revision=await writeResearchExperiment(owner,id,source);
  const next={...source,revision,meta:{...source.meta,status:'completed'}};
  const before=snapshot();fixture.failAt=1;
  await expect(writeResearchExperiment(owner,id,next)).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.failAt=0;fixture.switchAt=1;
  await expect(writeResearchExperiment(owner,id,next)).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.owner=owner;fixture.switchAt=0;
  expect(await readResearchExperiment(owner,id)).toEqual({...source,revision});
  expect(await writeResearchExperiment(owner,id,next)).toBe(revision+1);
});
it('rejects stale revisions and mismatched owner/session scope before replacing any data',async()=>{
  const source=value(),revision=await writeResearchExperiment(owner,id,source),before=snapshot();
  await expect(writeResearchExperiment(owner,id,source)).rejects.toThrow();expect(snapshot()).toEqual(before);
  for(const session of [{...source.session,owner:'research-b'},{...source.session,id:'exp:other'},
    {...source.session,payload:{...source.session.payload,storage_policy:'sync'}}]){
    await expect(writeResearchExperiment(owner,id,{...source,revision,session})).rejects.toThrow();expect(snapshot()).toEqual(before);
  }
  fixture.owner='research-b';await expect(readResearchExperiment(owner,id)).rejects.toThrow('Account changed');
});
it.each(['missing','checksum','manifest','header'])('refuses %s corruption and preserves the original evidence',async fault=>{
  const source=value(),revision=await writeResearchExperiment(owner,id,source),header=fixture.meta.get(key);
  const partKey=JSON.stringify([owner,'research',id,header.bodyParts.token,0]);
  if(fault==='missing')fixture.parts.delete(partKey);
  if(fault==='checksum')fixture.parts.get(partKey)[5]^=1;
  if(fault==='manifest')header.bodyParts.size++;
  if(fault==='header')header.meta.status='tampered';
  const before=snapshot();await expect(readResearchExperiment(owner,id)).rejects.toThrow();expect(snapshot()).toEqual(before);
  await expect(writeResearchExperiment(owner,id,{...source,revision})).rejects.toThrow();expect(snapshot()).toEqual(before);
});
