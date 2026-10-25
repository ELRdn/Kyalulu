import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),meta:new Map<string,any>(),sequence:0,turns:[] as any[],settings:{} as any,putFailure:undefined as number|undefined}));
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
  setMeta:async(key:string,value:unknown)=>{fixture.meta.set(key,structuredClone(value));},
  appTransaction:async(_stores:string[],_mode:string,action:any)=>new Promise((resolve,reject)=>{
    const records=structuredClone(fixture.records),metadata=structuredClone(fixture.meta);let aborted=false;
    const tx={abort:()=>{aborted=true;reject(Error('Transaction aborted'));},objectStore:(name:string)=>({
      get:(key:any)=>{const read={result:undefined as any,onsuccess:null as any};queueMicrotask(()=>{if(aborted)return;read.result=structuredClone((name==='entities'?records:metadata).get(name==='entities'?key.join(':'):key));try{read.onsuccess?.();}catch(error){aborted=true;reject(error);}});return read;},
      put:(value:any,key?:string)=>{if(fixture.putFailure!==undefined&&--fixture.putFailure===0)throw Error('Device quota exceeded');(name==='entities'?records:metadata).set(name==='entities'?value.owner+':'+value.id:key!,structuredClone(value));},
    })};
    action(tx,(value:any)=>{if(!aborted){fixture.records=records;fixture.meta=metadata;resolve(value);}});
  }),
  saveEntity:async(value:any,expected?:number,metadata={})=>{
    const key=value.owner+':'+value.id,previous=fixture.records.get(key);
    if(value.owner!==fixture.owner||expected!==undefined&&(previous?.revision??0)!==expected)throw Error('Owner/revision changed');
    const saved=structuredClone({...value,revision:(previous?.revision??0)+1});fixture.records.set(key,saved);
    for(const [key,item] of Object.entries(metadata))fixture.meta.set(key,structuredClone(item));return saved;
  },
}));
import { deviceFetch } from './deviceApi';
import exportCases from '../../../../tests/fixtures/device-exports.json';
import importCases from '../../../../tests/fixtures/device-imports.json';
import mediaCases from '../../../../tests/fixtures/device-media.json';
import { fromBase64 } from './portableBinary';
const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
  const response=await deviceFetch(path,{method,...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};
};
beforeEach(()=>{fixture.records.clear();fixture.meta.clear();fixture.owner='owner-a';fixture.sequence=0;fixture.turns=[];fixture.putFailure=undefined;vi.stubGlobal('location',{href:'https://device.test/device/'});vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No external calls allowed');}));});
afterEach(()=>{vi.unstubAllGlobals();});
const form=(raw:Uint8Array)=>{const value=new FormData();value.set('file',new File([new Uint8Array(raw)],'fake.html',{type:'text/html'}));return value;};
it('requires media rights, sniffs uploaded bytes and isolates asset retrieval by owner',async()=>{
  const sample=mediaCases.find(item=>item.name==='wav')!,raw=fromBase64(sample.base64),upload=form(raw);
  expect((await deviceFetch('/api/library/assets',{method:'POST',body:upload})).status).toBe(400);
  expect(fixture.meta.size).toBe(0);upload.set('rights_confirmed','true');
  const result=await deviceFetch('/api/library/assets',{method:'POST',body:upload}),asset=await result.json();
  expect(result.status).toBe(200);expect(asset).toMatchObject({media_type:'audio/wav',asset_id:sample.expected!.id,rights_confirmed:true,type:'audio'});
  const response=await deviceFetch('/api/library/assets/'+asset.asset_id);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(raw);expect(response.headers.get('Content-Type')).toBe('audio/wav');expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect((await deviceFetch('/api/library/assets/'+asset.asset_id,{method:'DELETE'})).status).toBe(405);
  fixture.owner='owner-b';expect((await deviceFetch('/api/library/assets/'+asset.asset_id)).status).toBe(409);expect(fetch).not.toHaveBeenCalled();
});
it('saves binary previews and assets together, requires fresh rights at commit, and retains exact original bytes',async()=>{
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1,height:1,close(){}})));
  const sample=importCases.find(item=>item.name==='png-and-audio-assets/charx')!,raw=fromBase64(sample.base64);
  fixture.putFailure=2;
  expect((await deviceFetch('/api/imports/preview',{method:'POST',body:form(raw)})).status).toBe(400);expect(fixture.meta.size).toBe(0);
  fixture.putFailure=undefined;
  const response=await deviceFetch('/api/imports/preview',{method:'POST',body:form(raw)}),preview=await response.json();expect(response.status).toBe(200);
  expect(preview).not.toHaveProperty('original');expect(preview).not.toHaveProperty('assets');
  const doc=preview.documents[0],audio=doc.assets.find((item:any)=>item.type==='audio');expect(audio.rights_confirmed).toBe(false);
  const body={request_id:'binary-fixture',selections:[{index:0,document:doc}]},path='/api/imports/'+preview.preview_id+'/commit';
  expect((await request(path,body)).status).toBe(400);expect(fixture.records.size).toBe(0);
  audio.rights_confirmed=true;const saved=await request(path,body);expect(saved.status).toBe(200);
  const original=await deviceFetch('/api/library/'+saved.body.items[0].id+'/export?format=original&download=true');expect(new Uint8Array(await original.arrayBuffer())).toEqual(raw);
});
it('discards image uploads and binary previews if the owner changes during decoding',async()=>{
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>{fixture.owner='owner-b';return {width:1,height:1,close(){}};}));
  const sample=mediaCases.find(item=>item.name==='png')!;
  expect((await deviceFetch('/api/library/assets',{method:'POST',body:form(fromBase64(sample.base64))})).status).toBe(409);expect(fixture.meta.size).toBe(0);
  fixture.owner='owner-a';const card=importCases.find(item=>item.name==='png-and-audio-assets/ccv3-png')!;
  expect((await deviceFetch('/api/imports/preview',{method:'POST',body:form(fromBase64(card.base64))})).status).toBe(409);expect(fixture.meta.size).toBe(0);expect(fetch).not.toHaveBeenCalled();
});
async function works(){
  const character=(await request('/api/library',{name:'Rei',data:{description:'Rei desc'}})).body;
  const profile=(await request('/api/library',{kind:'profile',name:'Profile',profile:{system_prompt:'Profile main',settings:{top_k:7,stop:['NO']}}})).body;
  const lore=(await request('/api/library',{kind:'lorebook',name:'Lore',data:{character_book:{entries:[{keys:['海'],content:'Known harbor'}]}}})).body;
  return {character,profile,lore,binding:{character:{id:character.id,revision:1},profile:{id:profile.id,revision:1},lorebooks:[{id:lore.id,revision:1}]}};
}
it('previews and downloads six real formats from the requested immutable Library revision',async()=>{
  const first=(await request('/api/library',{name:'Old 日本語',data:{description:'OLD'}})).body;
  const updated=await request('/api/library/'+first.id,{expected_revision:1,document:{...first.document,name:'New',data:{description:'NEW'}}},'PUT');
  expect(updated.status).toBe(200);
  for(const format of ['ccv2-json','ccv3-json','ccv2-png','ccv3-png','charx','backup']){
    const path='/api/library/'+first.id+'/export?revision=1&format='+format;
    const preview=await request(path);expect(preview.status).toBe(200);expect(preview.body.notices).toBeInstanceOf(Array);
    expect(preview.body.filename).toContain('Old_日本語');expect(preview.body.bytes).toBeGreaterThan(0);
    const file=await deviceFetch(path+'&download=true'),raw=new Uint8Array(await file.arrayBuffer());
    expect(file.status).toBe(200);expect(raw.length).toBe(preview.body.bytes);expect(file.headers.get('content-type')).toBe(preview.body.media_type);
    expect(file.headers.get('content-disposition')).toContain(encodeURIComponent(preview.body.filename));expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    if(format.endsWith('json'))expect(JSON.parse(new TextDecoder().decode(raw)).data).toMatchObject({name:'Old 日本語',description:'OLD'});
    else expect([...raw.subarray(0,4)]).toEqual(format.endsWith('png')?[137,80,78,71]:[80,75,3,4]);
  }
  expect((await request('/api/library/'+first.id+'/export?revision=99')).status).toBe(409);
  expect((await request('/api/library/'+first.id+'/export?format=unknown')).status).toBe(400);
  expect((await request('/api/library/'+first.id+'/export?download=false')).body.filename).toContain('New');
  expect((await request('/api/library/'+first.id+'/export?download=maybe')).status).toBe(400);
  fixture.owner='owner-b';expect((await request('/api/library/'+first.id+'/export')).status).toBe(404);expect(fetch).not.toHaveBeenCalled();
});
it('exports only verified owner-scoped asset bytes and preserves originals after later edits',async()=>{
  const example=exportCases[2],assets=Object.entries(example.assets);
  expect((await request('/api/library',example.document)).status).toBe(409);
  for(const [id,asset] of assets)fixture.meta.set('asset:owner-a:'+id,{raw:fromBase64(asset.base64!),mime:asset.mime});
  const created=(await request('/api/library',example.document)).body;
  expect((await request('/api/library/'+created.id+'/export?format=charx')).status).toBe(200);
  const [id,asset]=assets[0];fixture.meta.set('asset:owner-a:'+id,{raw:fromBase64(asset.base64!).subarray(1),mime:asset.mime});
  expect((await request('/api/library/'+created.id+'/export?format=charx')).body.error).toContain('checksum');
  const text=' \n'+JSON.stringify({name:'Imported',data:{description:'ORIGINAL'}})+'\n';
  const preview=(await request('/api/imports/text/preview',{text,filename:'原本.json'})).body;
  const imported=await request('/api/imports/'+preview.preview_id+'/commit',{request_id:'original-copy',selections:[{index:0,document:preview.documents[0]}]});
  expect(imported.status).toBe(200);const item=imported.body.items[0];expect(item.original_id).toBe(preview.source_hash);
  await request('/api/library/'+item.id,{expected_revision:1,document:{...item.document,name:'Edited'}},'PUT');
  const original=await deviceFetch('/api/library/'+item.id+'/export?format=original&download=true');
  expect(original.status).toBe(200);expect(await original.text()).toBe(text);expect(original.headers.get('content-disposition')).toContain(encodeURIComponent('原本.json'));
  fixture.meta.get('original:owner-a:'+item.original_id).raw[0]^=1;
  expect((await request('/api/library/'+item.id+'/export?format=original')).status).toBe(409);
  fixture.owner='owner-b';expect((await request('/api/library/'+item.id+'/export?format=original')).status).toBe(404);expect(fetch).not.toHaveBeenCalled();
});
it('commits selected histories and original bytes once, rejects changed replays, and preserves source provenance',async()=>{
  const preview=(await request('/api/imports/text/preview',{text:JSON.stringify({name:'History',data:{description:'one',personality:'calm'},source:{future:'SOURCE'},
    histories:[{name:'Imported history',messages:[{role:'user',content:'First',created_at:null,original_id:'forged',history_index:99,format:'unified'},{role:'assistant',content:'Second'}]}]})})).body;
  const source=preview.documents[0],doc={...source,source:{forged:'NEVER'},source_format:'forged'};
  fixture.records.set('owner-a:older-history',{owner:'owner-a',id:'older-history',kind:'conversation',payload:{messages:[{id:900,content:'OLDER'}]}});
  const body={request_id:'history-once',selections:[{index:0,document:doc,history_indices:[0]}]};
  const first=await request('/api/imports/'+preview.preview_id+'/commit',body);expect(first.status).toBe(200);
  expect(fixture.meta.get('import:owner-a:history-once')).toMatchObject(first.body);
  expect(fixture.meta.get('import:owner-a:history-once').request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(first.body.sessions).toHaveLength(1);expect(first.body.items[0].document.source).toEqual({future:'SOURCE'});
  const history=fixture.records.get('owner-a:'+first.body.sessions[0].session_id);
  expect(history.payload.messages.map((message:any)=>message.content)).toEqual(['First','Second']);
  expect(new Set(history.payload.messages.map((message:any)=>message.id)).size).toBe(2);
  expect(history.payload.messages.map((message:any)=>message.id)).toEqual([901,902]);
  expect(history.payload.messages.every((message:any)=>message.uuid&&message.imported_from.original_id===preview.source_hash)).toBe(true);
  expect(history.payload.messages[0].imported_from).toMatchObject({history_index:0,format:'portable'});
  expect(history.payload.settings.library_binding.character).toEqual({id:first.body.items[0].id,revision:1});
  const count=fixture.records.size;
  const retry=structuredClone(body);retry.selections[0].document.data=Object.fromEntries(Object.entries(doc.data).reverse());
  expect((await request('/api/imports/'+preview.preview_id+'/commit',retry)).body).toEqual(first.body);expect(fixture.records.size).toBe(count);
  retry.selections[0].document.name='CHANGED';expect((await request('/api/imports/'+preview.preview_id+'/commit',retry)).status).toBe(409);
  expect(fixture.records.size).toBe(count);expect(fetch).not.toHaveBeenCalled();
});
it('rolls back all import items, originals and receipts on quota failure and keeps prior dirty data',async()=>{
  await request('/api/chat/settings',{session_id:'unsent',system_prompt:'KEEP',temperature:.8},'PUT');
  fixture.records.get('owner-a:unsent').dirty=true;
  const preview=(await request('/api/imports/text/preview',{text:JSON.stringify({name:'One'})})).body;
  const stored=fixture.meta.get('preview:owner-a:'+preview.preview_id);stored.documents.push({...preview.documents[0],name:'Two'});
  const before=structuredClone(fixture.records),metadata=structuredClone(fixture.meta);
  const body={request_id:'quota',selections:stored.documents.map((document:any,index:number)=>({index,document}))};
  fixture.putFailure=2;
  expect((await request('/api/imports/'+preview.preview_id+'/commit',body)).status).toBe(400);
  expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(metadata);
  fixture.putFailure=undefined;
  const saved=await request('/api/imports/'+preview.preview_id+'/commit',body);expect(saved.body.items).toHaveLength(2);
  expect(fixture.records.get('owner-a:unsent').dirty).toBe(true);
});
it('updates only a selected matching Library revision and refuses unverifiable legacy receipts',async()=>{
  const original=(await request('/api/library',{name:'Before'})).body;
  const preview=(await request('/api/imports/text/preview',{text:JSON.stringify({name:'Replacement'})})).body;
  const body={request_id:'replace',selections:[{index:0,document:preview.documents[0],target_id:original.id,expected_revision:1}]};
  const saved=await request('/api/imports/'+preview.preview_id+'/commit',body);
  expect(saved.status).toBe(200);expect(saved.body.items[0]).toMatchObject({id:original.id,revision:2});
  expect((await request('/api/library/'+original.id+'?revision=1')).body.document.name).toBe('Before');
  expect((await request('/api/imports/'+preview.preview_id+'/commit',{...body,request_id:'stale'})).status).toBe(409);
  const legacy={items:[original],sessions:[]};fixture.meta.set('import:owner-a:legacy',legacy);
  expect((await request('/api/imports/'+preview.preview_id+'/commit',{...body,request_id:'legacy'})).status).toBe(409);
  expect(fixture.meta.get('import:owner-a:legacy')).toEqual(legacy);
});
it('rejects coercible non-string history roles without creating a partial import',async()=>{
  const preview=(await request('/api/imports/text/preview',{text:JSON.stringify({name:'Invalid role',histories:[{messages:[{role:['user'],content:'Invalid'}]}]})})).body;
  const before=structuredClone(fixture.records);
  const result=await request('/api/imports/'+preview.preview_id+'/commit',{request_id:'invalid-role',selections:[{index:0,document:preview.documents[0],history_indices:[0]}]});
  expect(result.status).toBe(400);expect(fixture.records).toEqual(before);expect(fixture.meta.has('import:owner-a:invalid-role')).toBe(false);
});
it('does not mutate Library data through read-only export or wrong import methods',async()=>{
  const first=(await request('/api/library',{name:'Unchanged'})).body;
  const before=structuredClone(fixture.records);
  for(const action of ['export','revisions'])expect((await request('/api/library/'+first.id+'/'+action,{expected_revision:1,document:{name:'WRONG'}},'PUT')).status).toBe(405);
  const preview=(await request('/api/imports/text/preview',{text:'{"name":"Import"}'})).body;
  expect((await request('/api/imports/'+preview.preview_id+'/commit',{request_id:'wrong-method',selections:[{index:0,document:preview.documents[0]}]},'PUT')).status).toBe(405);
  expect(fixture.records).toEqual(before);
});
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
