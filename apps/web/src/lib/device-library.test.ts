import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),meta:new Map<string,any>(),sequence:0,turns:[] as any[],settings:{} as any}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,setGenerationBusy:vi.fn()}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class{
  async load(){} stop(){}
  async generate(turns:any,event:any,settings:any){fixture.turns=turns;fixture.settings=settings;event({type:'delta',text:JSON.stringify({reply:'fixture reply',state_update:{location:'港',time:'夜',mood:'calm',active_scene:'帰港',relationship_state:{stage:'friend',tone:'warm',unresolved_conflict:false}}})});return {measurement:{}};}
}}));
vi.mock('./appStore',async original=>({
  ...await original<typeof import('./appStore')>(),
  allEntities:async(owner:string)=>structuredClone([...fixture.records.values()].filter(e=>e.owner===owner)),
  entity:async(id:string,owner=fixture.owner)=>structuredClone(fixture.records.get(owner+':'+id)),
  openEntity:async(id:string,owner=fixture.owner)=>structuredClone(fixture.records.get(owner+':'+id)),
  getMeta:async(key:string)=>structuredClone(fixture.meta.get(key)),
  appTransaction:async()=>++fixture.sequence,
  saveEntity:async(value:any,expected?:number,metadata={})=>{
    const key=value.owner+':'+value.id,previous=fixture.records.get(key);
    if(value.owner!==fixture.owner||expected!==undefined&&(previous?.revision??0)!==expected)throw Error('Owner/revision changed');
    const saved=structuredClone({...value,revision:(previous?.revision??0)+1});fixture.records.set(key,saved);
    for(const [key,item] of Object.entries(metadata))fixture.meta.set(key,structuredClone(item));return saved;
  },
}));
import { deviceFetch } from './deviceApi';
const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
  const response=await deviceFetch(path,{method,...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
};
beforeEach(()=>{fixture.records.clear();fixture.meta.clear();fixture.owner='owner-a';fixture.sequence=0;fixture.turns=[];vi.stubGlobal('location',{href:'https://device.test/device/'});vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No external calls allowed');}));});
afterEach(()=>{vi.unstubAllGlobals();});
async function works(){
  const character=(await request('/api/library',{name:'Rei',data:{description:'Rei desc'}})).body;
  const profile=(await request('/api/library',{kind:'profile',name:'Profile',profile:{system_prompt:'Profile main',settings:{top_k:7,stop:['NO']}}})).body;
  const lore=(await request('/api/library',{kind:'lorebook',name:'Lore',data:{character_book:{entries:[{keys:['海'],content:'Known harbor'}]}}})).body;
  return {character,profile,lore,binding:{character:{id:character.id,revision:1},profile:{id:profile.id,revision:1},lorebooks:[{id:lore.id,revision:1}]}};
}
it('compiles selected library revisions and fails closed on missing, mistyped or adult references',async()=>{
  const {character,profile,lore,binding}=await works();
  expect((await request('/api/library')).body.items.map((i:any)=>i.document.kind).sort()).toEqual(['character','lorebook','profile']);
  const compiled=await request('/api/prompt/compile',{character_id:character.id,library_binding:binding});
  expect(compiled.status).toBe(200);expect(compiled.body.system_prompt).toContain('Profile main');expect(compiled.body.system_prompt).not.toContain('Known harbor');
  expect((await request('/api/prompt/compile',{character_id:character.id,library_binding:{...binding,profile:{id:character.id,revision:1}}})).status).toBe(409);
  expect((await request('/api/prompt/compile',{character_id:character.id,library_binding:{...binding,lorebooks:[{id:lore.id,revision:99}]}})).status).toBe(409);
  fixture.records.get('owner-a:'+profile.id).payload.versions['1'].nsfw=true;
  expect((await request('/api/prompt/compile',{character_id:character.id,library_binding:binding})).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps created World revisions immutable and applies selected cast, Lore, RPG and samplers to generation',async()=>{
  const {character,binding}=await works();
  const world={display_name:'Harbor',rules:'OLD RULE',cast:[{id:'captain',display_name:'船長',knowledge:'Only the harbor'}],rpg:{initial_hp:100,actions:[{id:'sail',label:'sail',trigger:'海',difficulty:1,hp_delta:-10}]}};
  const first=await request('/api/creator/world',world);expect(first.status).toBe(201);
  const second=await request('/api/creator/world/'+first.body.id,{...world,rules:'NEW RULE'},'PUT');expect(second.body.revision).toBe(2);
  expect((await request('/api/creator/world/'+first.body.id)).body.item.rules).toBe('OLD RULE');
  expect((await request('/api/creator/world/'+first.body.id,{...world,rules:'STALE'},'PUT')).status).toBe(409);
  const exported=await request('/api/creator/world/'+first.body.id+'/export');expect(exported.body).toMatchObject({format:'kyalulu-creator',version:1,document:{rules:'OLD RULE'}});
  await request('/api/chat/settings',{session_id:'chat',system_prompt:'',temperature:.8,character_id:character.id,library_binding:binding,world_id:first.body.id},'PUT');
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',model_id:'fixture',generation_id:'fixture-gen',messages:[{role:'user',content:'海'}],system_prompt:'ONE OFF',temperature:.25,top_p:.8,max_tokens:512})});
  const stream=await response.text();expect(stream).toContain('event: done');expect(stream).toContain('fixture reply');
  const content=fixture.turns.map(m=>m.content).join('\n');
  expect(content).toContain('OLD RULE');expect(content).not.toContain('NEW RULE');expect(content).toContain('Known harbor');expect(content).toContain('船長');expect(content).toContain('ONE OFF');
  expect(fixture.settings).toMatchObject({temperature:.25,top_p:.8,top_k:7,max_tokens:512});
  const saved=fixture.records.get('owner-a:chat');expect(saved.payload.state.rpg.hp).toBe(90);expect(saved.payload.state.rpg.rolls).toHaveLength(1);
  expect(saved.payload.last_generation.generation_config.unsupported).toEqual(['stop']);expect(saved.payload.settings.system_prompt).toBe('');
  fixture.owner='owner-b';expect((await request('/api/creator/world/'+first.body.id)).status).toBe(404);expect((await request('/api/worlds')).body.worlds.some((w:any)=>w.id===second.body.id)).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects ambiguous cast and invalid World properties before saving',async()=>{
  const member={id:'same',display_name:'A'};
  expect((await request('/api/creator/world',{display_name:'W',cast:[member,member]})).status).toBe(400);
  expect((await request('/api/creator/world',{display_name:'W',script:'never execute'})).status).toBe(400);expect(fixture.records.size).toBe(0);
});
it('never overwrites a synchronized immutable version when an editable head has not advanced',async()=>{
  const world=(await request('/api/creator/world',{display_name:'World'})).body;
  const source=fixture.records.get('owner-a:'+world.asset_id);source.payload.versions['2']={...source.payload.creator,rules:'SYNCED'};
  expect((await request('/api/creator/world/'+world.id,{display_name:'Overwrite'},'PUT')).status).toBe(409);
  expect(source.payload.versions['2'].rules).toBe('SYNCED');
  const character=(await request('/api/library',{name:'Character'})).body,record=fixture.records.get('owner-a:'+character.id);
  record.payload.versions['2']={...record.payload.document,name:'SYNCED'};
  expect((await request('/api/library/'+character.id,{expected_revision:1,document:{name:'Overwrite'}},'PUT')).status).toBe(409);
  expect(record.payload.versions['2'].name).toBe('SYNCED');
});
