import { PortableDocumentSchema, DeviceGenerationOutputSchema, RuntimeStateSchema, LibraryBindingSchema, CreatorDocumentSchema, CastMemberSchema, ConversationSettingsSchema } from '../../../../packages/schemas/src';
import catalog from '../mobile/app-catalog.generated.json';
import { MobileRuntime } from '../mobile/runtime';
import { MODELS, readyModels } from '../mobile/models';
import { allEntities, entity, openEntity, saveEntity, newEntity, getMeta, setMeta, appTransaction, writeEntity, scrubGenerationRecords, memoryEventsKey, trimOfflineCache, type AppEntity } from './appStore';
import { deviceOwner, setGenerationBusy } from './appContext';
import { estimateTokens, retrieveMemories, renderMemoryBlock, prepareRpg, memoryDecisions, evidenced, refreshSummaries, type DeviceMemory } from './deviceCore';
import { receiveConversation, rebindConversation } from './appSyncData';
import { hydrateConversation } from './appSync';
import { compilePortable, assemblePortable } from './devicePrompt';
import { sampling } from '../mobile/sampling';
import { exportPortable, type ExportAsset } from './deviceExport';
import { Sha256 } from '../mobile/sha256';
import { commitDeviceImport, deviceSourceMatches } from './deviceImport';
import { parseDeviceImport } from './deviceParseImport';
import { acceptDeviceMedia, readDeviceAsset, saveDeviceAsset, validateDeviceDocumentAssets } from './deviceAssets';
import { deviceResearchRoute, deviceResearchBusy, type ResearchTurn } from './deviceResearch';

let runtime:MobileRuntime|undefined, loaded='';
let running:string|null=null;
const encoder=new TextEncoder();
const contentHash=(raw:Uint8Array)=>new Sha256().update(raw).digest();
const outputSchema=DeviceGenerationOutputSchema;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>Object.assign(Error(message),{status});
type MemoryEvent={id:number;scope:string;op:string;memory_id:string|null;generation_id:string|null;detail:unknown;created_at:string};
async function memoryEvents(owner:string,sessionId:string) {
  const events=await getMeta<MemoryEvent[]>(memoryEventsKey(owner,sessionId));
  if(events!==undefined&&(!Array.isArray(events)||events.some((e,i)=>!e||e.id!==i+1||e.scope!==sessionId)))throw fail('Saved memory history is invalid',409);
  return events??[];
}
function addMemoryEvent(events:MemoryEvent[],scope:string,op:string,memoryId:string|null,generationId:string|null,detail:unknown=null) {
  events.push({id:events.length+1,scope,op,memory_id:memoryId,generation_id:generationId,detail,created_at:new Date().toISOString()});
}
const builtin=catalog.characters as Record<string,any>[];
const docFor=(c:Record<string,any>)=>PortableDocumentSchema.parse({name:c.display_name??c.name,data:{description:c.description??'',personality:c.personality??'',first_mes:c.intro??''},speaking_style:c.speaking_style??'',nsfw:!!c.nsfw});
const blank=(id:string)=>newEntity('conversation',id,{storage_policy:'local',rating:'general',settings:{session_id:id,system_prompt:'',temperature:.8},
  messages:[],memories:[],summaries:[],state:RuntimeStateSchema.parse({session_id:id}),memory_enabled:false});
async function conversation(id:string,owner=deviceOwner()) {
  let record=await openEntity(id,owner);
  if(record?.payload.cache_evicted){
    try{record=await hydrateConversation(id,owner);await trimOfflineCache(owner);}
    catch(error){throw fail(String(error),503);}
  }
  if(owner!==deviceOwner())throw fail('Account changed / アカウントが切り替わりました',409);
  if(record?.deleted)throw fail('Conversation deleted / 会話は削除されています',404);
  return record??blank(id);
}
async function nextId(owner=deviceOwner()) {
  const key='message-sequence:'+owner;
  return appTransaction<number>(['meta'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('meta'),r=store.get(key);
    r.onsuccess=()=>{const id=(r.result??0)+1;if(owner!==deviceOwner()||!Number.isSafeInteger(id)){tx.abort();return;}store.put(id,key);done(id);};
  });
}
function libraryView(e:AppEntity,revision?:number) {
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))throw fail('Invalid library revision');
  const item=revision!==undefined?e.payload.versions?.[String(revision)]:e.payload.document;
  if(!item)throw fail('Saved revision not found',409);
  return {id:e.id,revision:revision??e.payload.current_revision??e.revision,document:item,original_id:e.payload.original_id??null};
}
async function libraryDocument(ref:{id:string;revision:number},kind:string,owner:string) {
  const e=await entity(ref.id,owner);
  if(!e||e.deleted)throw fail('Saved library revision is missing',409);
  const document=PortableDocumentSchema.parse(libraryView(e,ref.revision).document);
  if(document.kind!==kind)throw fail('Wrong library document kind',409);
  if(document.nsfw)throw fail('Adult verification required',403);
  return document;
}
async function documentFor(settings:Record<string,any>,owner=deviceOwner()) {
  const ref=settings.library_binding?.character;
  if(ref) {if(ref.id!==settings.character_id)throw fail('Invalid character binding',409);return libraryDocument(ref,'character',owner);}
  if(settings.character_id){const saved=await entity(settings.character_id,owner);if(saved?.payload.document)return libraryDocument({id:saved.id,revision:saved.payload.current_revision??saved.revision},'character',owner);}
  const c=builtin.find(c=>c.id===settings.character_id);
  if(settings.character_id&&!c)throw fail('Saved character is missing',409);
  return c?docFor(c):PortableDocumentSchema.parse({name:'Kyalulu',data:{personality:'You are Kyalulu, a friendly fictional AI character. Respond to what the user actually says. Never invent their actions or biography.'}});
}
function creatorView(e:AppEntity,revision=e.payload.current_revision??e.revision) {
  const document=e.payload.versions?.[String(revision)];if(!e.payload.creator||!document)throw fail('Saved setting revision is missing',409);
  return {...document,id:e.id+'@'+revision,asset_id:e.id,kind:e.kind,revision,version:'1.0.'+(revision-1),created_at:e.payload.dates?.[revision]??''};
}
async function settingFor(kind:'persona'|'world',id:string|undefined,owner:string) {
  if(!id)return null;
  const match=id.match(/^(created_[0-9a-f]{32})@([1-9]\d*)$/);
  if(match){const value=await entity(match[1],owner);if(value&&!value.deleted&&value.kind===kind)return creatorView(value,Number(match[2]));}
  const value=(kind==='world'?catalog.worlds:catalog.personas as Record<string,any>[]).find((s:any)=>s.id===id);
  if(!value)throw fail('Saved '+kind+' revision is missing',409);return value;
}
async function compiled(settings:Record<string,any>,history:{role:string;content:string}[]=[],owner=deviceOwner()) {
  const binding=LibraryBindingSchema.parse(settings.library_binding??{}),d=await documentFor({...settings,library_binding:binding},owner),lorebooks:Record<string,any>[]=[];
  if(binding.profile){const profile=await libraryDocument(binding.profile,'profile',owner);d.profile=profile.profile;d.notices.push(...profile.notices);if(profile.data.character_book)lorebooks.push(profile.data.character_book as Record<string,any>);}
  for(const ref of binding.lorebooks){const lore=await libraryDocument(ref,'lorebook',owner);lorebooks.push(lore.data.character_book as Record<string,any>??{});d.notices.push(...lore.notices);}
  const persona=await settingFor('persona',settings.persona_id,owner),world=await settingFor('world',settings.world_id,owner);
  return compilePortable({document:d,character_version:binding.character?'1.0.'+binding.character.revision:builtin.find(c=>c.id===settings.character_id)?.version??null,
    library_binding:binding,lorebooks,persona,world,extra_system_prompt:settings.system_prompt??settings.extra_system_prompt??''},history);
}
async function generate(body:Record<string,any>,signal?:AbortSignal,scope?:ResearchTurn) {
  const owner=deviceOwner(),currentOwner=()=>{if(owner!==deviceOwner())throw fail('Account changed',409);};
  if(running||deviceResearchBusy()&&!scope)throw fail('A generation is already running',409);
  const id=String(body.session_id??'default'),generationId=body.generation_id;
  if(typeof generationId!=='string'||generationId.length>200||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>200
    ||body.messages.some((m:any)=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>128000))throw fail('Invalid generation request');
  if(body.allow_nsfw)throw fail('Adult verification is required',403);
  const existing=scope?null:await getMeta<any>('generation:'+owner+':'+generationId);currentOwner();
  if(existing)throw fail('Generation already exists; reconcile its saved status',409);
  const model=MODELS.find(m=>m.id===body.model_id);
  if(!model||!(await readyModels()).has(model.id))throw fail('Prepare this model in Settings / 設定からモデルを準備してください',409);
  currentOwner();
  if(running||deviceResearchBusy()&&!scope)throw fail('A generation is already running',409);
  running=generationId;setGenerationBusy(true);
  try {
    runtime??=new MobileRuntime();
    if(loaded!==model.id){
      const engine=runtime;loaded='';const stopLoad=()=>engine.reset('Generation stopped while loading the model');
      signal?.throwIfAborted();signal?.addEventListener('abort',stopLoad,{once:true});
      try{await engine.load(model.id,false,new URL('/',location.href).href);signal?.throwIfAborted();loaded=model.id;}
      catch(error){engine.reset('Model loading failed or stopped');throw error;}
      finally{signal?.removeEventListener('abort',stopLoad);}
    }
    currentOwner();
    const session=scope?.session??await conversation(id,owner),p=session.payload;
    if(session.owner!==owner||session.id!==id)throw fail('Invalid generation scope',409);
    const save=scope?async(value:AppEntity,_revision:number,_metadata:Record<string,unknown>)=>scope.save(value):saveEntity;
    const last=body.messages.at(-1);
    if(last.role!=='user')throw fail('A user message is required');
    const userId=body.regenerate_message_id?p.messages.at(-2)?.id:scope?(p.message_sequence??0)+1:await nextId(owner),assistantId=scope?userId+1:await nextId(owner);
    let messages=[...p.messages];
    let baseState=p.state,baseMemories=p.memories;
    if(body.regenerate_message_id){
      const previous=messages.at(-1);
      if(previous?.id!==body.regenerate_message_id||previous.role!=='assistant'||messages.at(-2)?.content!==last.content)throw fail('Only the latest reply may be regenerated',409);
      if(!previous.before)throw fail('Historical state is unavailable for regeneration',409);
      baseState=previous.before.state;baseMemories=previous.before.memories;messages=messages.slice(0,-1);
    }
    if(!body.regenerate_message_id)messages.push({id:userId,uuid:crypto.randomUUID(),role:'user',content:last.content,created_at:new Date().toISOString(),model_id:model.id});
    const prompt=scope?.prompt??await compiled({...p.settings,system_prompt:body.system_prompt??p.settings.system_prompt},messages,owner);currentOwner();
    const requested={...prompt.sections.generation_settings,temperature:body.temperature??p.settings.temperature??model.temperature};
    for(const key of ['seed','max_tokens','top_p'])if(body[key]!==undefined)(requested as Record<string,unknown>)[key]=body[key];
    if(scope?.requested)Object.assign(requested,scope.requested);
    const generationConfig=sampling(model,requested);
    const frozenSettings=ConversationSettingsSchema.parse({...p.settings,session_id:id,system_prompt:body.system_prompt??p.settings.system_prompt??'',temperature:requested.temperature});
    const retrievalStart=performance.now();
    const retrieved=retrieveMemories(p.memory_enabled?baseMemories:[],last.content,scope?.memoryOptions);
    const trace=p.memory_enabled?{...retrieved,enabled:true,scope:id,stored_count:baseMemories.filter((m:DeviceMemory)=>m.status==='active').length,
      retrieval_ms:Math.round((performance.now()-retrievalStart)*100)/100}:null;
    const memories=trace?.injected.map(id=>trace.candidates.find(m=>m.id===id)!)??[];
    const events=scope||!trace?[]:await memoryEvents(owner,id);currentOwner();
    const world=prompt.sections.portable_snapshot.world;
    const cast=(world?.cast??[]).map((member:unknown)=>CastMemberSchema.parse(member));
    if(cast.length>12||new Set(cast.map((member:any)=>member.id)).size!==cast.length)throw fail('Invalid cast configuration');
    const rpg=world?.rpg?prepareRpg(world.rpg,baseState.rpg??{},last.content,generationId):baseState.rpg;
    const system='Never choose the user\'s thoughts, actions or speech.\nState: '+JSON.stringify({...baseState,rpg})+
      (cast.length?'\nCast: label each speaker by name; keep their knowledge and relationships separate. Never choose the user\'s thoughts or actions.\n'+JSON.stringify(cast):'')+
      (world?.rpg?'\nServer-owned RPG outcome: narrate these results; never invent rolls or change HP, skills or inventory. Reject actions forbidden by the world rules.\n'+JSON.stringify(rpg):'')+
      renderMemoryBlock(memories)+
      '\nReturn JSON only: {"reply":"your in-character reply","state_update":{"location":"","time":"","mood":"","active_scene":"","relationship_state":{"stage":"stranger","tone":"neutral","unresolved_conflict":false}},"memory_proposals":[]}. Memory proposals: at most 3, each {type:semantic|episodic|relationship,content,source_kind:user_statement|user_correction|work_setting|story_event}. Never invent user facts.';
    const pending={generation_id:generationId,session_id:id,status:'pending',assistant_id:null,user_id:body.regenerate_message_id?null:userId};
    let current=await save({...session,payload:{...p,messages,pending_generation:generationId,...(scope?{message_sequence:assistantId}:{})}},session.revision,{['generation:'+owner+':'+generationId]:pending});
    let closed=false;
    const stream=new ReadableStream<Uint8Array>({start(controller) {
      let ended=false,raw='';
      const send=(event:string,data:unknown)=>{if(!ended&&!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
      const abort=()=>runtime?.stop();signal?.addEventListener('abort',abort,{once:true});
      void (async()=>{
        try {
          signal?.throwIfAborted();
          const input=assemblePortable(prompt,messages.filter((m:any)=>!['stopped','interrupted'].includes(m.imported_state)).map((m:any)=>({role:m.role,content:m.content})),system);
          const result=await runtime!.generate(input as import('../mobile/types').ChatTurn[],event=>{
            if(event.type==='delta'){raw+=event.text??'';send('progress',{stage:'generation',elapsed_ms:0});}
          },requested);
          if(deviceOwner()!==owner)throw fail('Account changed');
          if((result as any).stopped||signal?.aborted)throw fail('Generation stopped');
          let parsed;
          try { parsed=outputSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))); }
          catch {throw fail('The model returned an invalid structured response. No memory or story state was applied. / モデルの応答形式が不正です。記憶・状態は変更していません。');}
          const state={...baseState,...parsed.state_update,rpg,turn:(baseState.turn??0)+1};
          const now=new Date().toISOString();
          const stored:DeviceMemory[]=baseMemories.map((memory:DeviceMemory)=>trace?.injected.includes(memory.id)
            ?{...memory,access_count:(memory.access_count??0)+1,last_accessed:now}:memory);
          if(trace){
            addMemoryEvent(events,id,'retrieve',null,generationId,{candidates:trace.candidates.map(({id,score,decision})=>({id,score,decision})),injected_tokens:trace.injected_tokens,retrieval_ms:trace.retrieval_ms});
            for(const memoryId of trace.injected)addMemoryEvent(events,id,'inject',memoryId,generationId);
          }
          const decisions=(p.memory_enabled?memoryDecisions(parsed.memory_proposals,baseMemories,last.content,parsed.reply,String(current.revision)):[]).map(proposal=>{
            if(proposal.action!=='store')return proposal;
            const memoryId=crypto.randomUUID(),sourceIds=proposal.source_kind==='story_event'?[assistantId]:[userId];
            stored.push({...proposal,id:memoryId,scope:id,origin:'model',status:'active',version:1,
              source_session_id:scope?baseState.session_id:id,source_turn:state.turn,source_generation_id:generationId,source_message_ids:sourceIds,
              created_at:now,updated_at:now,access_count:0,last_accessed:null});
            addMemoryEvent(events,id,'create',memoryId,generationId,{type:proposal.type,content:proposal.content,origin:'model'});
            return {...proposal,memory_id:memoryId,source_message_ids:sourceIds};
          });
          const memory=trace?{...trace,proposals:parsed.memory_proposals,decisions,evidenced:memories.filter(m=>evidenced(m.content,parsed.reply)).map(m=>m.id)}:null;
          messages.push({id:assistantId,uuid:crypto.randomUUID(),role:'assistant',content:parsed.reply,created_at:new Date().toISOString(),model_id:model.id,
            before:{state:baseState,memories:baseMemories,settings:structuredClone(frozenSettings)},after:{state,memories:stored,settings:structuredClone(frozenSettings)}});
          const done={...pending,status:'completed',assistant_id:assistantId,full:parsed.reply,reply:parsed.reply,state,telemetry:{...result.measurement,memory,
            ...(scope?{first_reply_ms:result.measurement?.firstTokenMs??null,tokens_per_second:result.measurement?.tokensPerSecond??null}:{})},
            generation_config:{...generationConfig,requested:{model_id:model.id,...generationConfig.requested},applied:{model_id:model.id,...generationConfig.applied}},validation:{ok:true,retries:0,errors:[]},
            compiled:prompt,raw_prompt:JSON.stringify(input),state_before:baseState,memory,
            token_budget:{total_prompt_tokens:input.reduce((sum,m)=>sum+estimateTokens(m.content),0),estimated:true}};
          current=await save({...current,payload:{...current.payload,messages,memories:stored,state,last_generation:done,pending_generation:null,
            summaries:refreshSummaries(messages,p.summaries,id)}},current.revision,{['generation:'+owner+':'+generationId]:done,
              ...(!scope&&trace?{[memoryEventsKey(owner,id)]:events}:{})});
          send('done',done);
        } catch(error) {
          let saveError='';
          try{current=await save({...current,payload:{...current.payload,pending_generation:null}},current.revision,{['generation:'+owner+':'+generationId]:{...pending,status:'failed'}});}
          catch{saveError=' Device save failed; the pending record is retained / 保存できないため未完了の記録を保持しています。';}
          send('error',{error:(error instanceof Error?error.message:String(error))+saveError});
        } finally {signal?.removeEventListener('abort',abort);running=null;setGenerationBusy(false);if(!ended&&!closed){ended=true;controller.close();}}
      })();
    },cancel(){closed=true;runtime?.stop();}});
    return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store'}});
  } catch(error) {running=null;setGenerationBusy(false);throw error;}
}

export async function deviceFetch(input:string,init:RequestInit={}) :Promise<Response> {
  const owner=deviceOwner();
  try {const response=await route(input,init,owner);if(owner!==deviceOwner())throw fail('Account changed',409);return response;}
  catch(error){return json({error:error instanceof Error?error.message:String(error)},(error as any)?.status??400);}
}
async function route(input:string,init:RequestInit,owner:string) :Promise<Response> {
  init.signal?.throwIfAborted();
  const url=new URL(input,'https://device.invalid'),path=decodeURIComponent(url.pathname),method=(init.method??'GET').toUpperCase();
  let body:Record<string,any>={};
  if(typeof init.body==='string'){if(init.body.length>32*1024*1024)throw fail('Request too large',413);body=JSON.parse(init.body);}
  if(/^\/api\/(experiments|ratings|leaderboard|benchmarks)(?:\/|$)/.test(path))return deviceResearchRoute(path,method,body,url,owner,init.signal??undefined,generate,compiled);
  if(path==='/api/library/assets'&&method==='POST') {
    if(!(init.body instanceof FormData))throw fail('Choose a media file');
    const file=init.body.get('file');if(!(file instanceof File)||file.size>32*1024*1024)throw fail('Choose a file up to 32 MiB');
    const asset=await acceptDeviceMedia(new Uint8Array(await file.arrayBuffer()));
    if(!asset.mime.startsWith('image/')&&init.body.get('rights_confirmed')!=='true')throw fail('Media requires rights confirmation');
    await saveDeviceAsset(owner,asset);
    return json({name:file.name,type:asset.mime.startsWith('video/')?'video':asset.mime.startsWith('audio/')?'audio':'icon',uri:'',media_type:asset.mime,asset_id:asset.id,rights_confirmed:init.body.get('rights_confirmed')==='true'});
  }
  const media=path.match(/^\/api\/library\/assets\/([a-f0-9]{64})$/);
  if(media){
    if(method!=='GET')throw fail('Media requires GET',405);
    const asset=await readDeviceAsset(owner,media[1]);
    return new Response(new Uint8Array(asset.raw),{headers:{'Content-Type':asset.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  const readRecords=async()=>{
    const records=(await allEntities(owner)).filter(e=>!e.deleted);
    if(owner!==deviceOwner())throw fail('Account changed',409);
    return records;
  };
  if(owner!==deviceOwner())throw fail('Account changed',409);
  if(path==='/api/mobile/status')return json({cloud_mode:false,remote_mode:false,authenticated:true,administrative:false,device_mode:true});
  if(path==='/api/health')return json({status:'ok',version:'0.1.0',runtime:'browser'});
  if(path==='/api/capabilities')return json({schema_version:1,mode:'local',model_selection:'local',features:{regenerate:true,suggestions:false,stored_context:false,progress:true,branch:true,permanent_delete:true,summaries:true,world_memory:true,story_rules:true,community:false,media_playback:true,media_generation:false}});
  if(path==='/api/models') {const ready=await readyModels();return json({models:MODELS.map(m=>({id:m.id,display_name:m.name,provider_type:'browser',provider_model:m.id,quantization:m.runtime,context_length:2048,available:ready.has(m.id),unavailable_reason:ready.has(m.id)?null:'Download required'}))});}
  if(path==='/api/providers/health')return json({health:[{id:'browser',provider:'browser',status:'ok'}]});
  if(path==='/api/diagnostics')return json({ready:true,checks:[{id:'browser',ok:true,message:'On-device runtime',hint:null,detail:null}]});
  if(path==='/api/commands')return json(method==='GET'?{commands:[]}:{ok:false,command:'',output:'Use Settings to manage on-device models',refresh_models:false});
  if(path==='/api/characters')return json({characters:[...builtin.map(c=>({...c,portrait_url:c.id==='senior_cool'?'/icons/rei-senpai.png':c.id==='butler'?'/icons/shion-butler-1.png':c.id==='mocha_sfw'?'/icons/mocha-1.png':null})),
    ...(await readRecords()).filter(e=>e.kind==='character'&&!e.payload.document?.nsfw).map(e=>({id:e.id,display_name:e.payload.document.name,description:String(e.payload.document.data.description??e.payload.document.data.personality??''),intro:e.payload.document.data.first_mes??'',tags:e.payload.document.data.tags??[],version:String(e.payload.current_revision??e.revision),library_revision:e.payload.current_revision??e.revision}))]});
  if(path==='/api/personas')return json({personas:[...catalog.personas,...(await readRecords()).filter(e=>e.kind==='persona'&&e.payload.creator).map(e=>creatorView(e))]});
  if(path==='/api/worlds')return json({worlds:[...catalog.worlds,...(await readRecords()).filter(e=>e.kind==='world'&&e.payload.creator).map(e=>creatorView(e))]});
  if(path==='/api/prompt/compile')return json(await compiled(body,[],owner));
  const creator=path.match(/^\/api\/creator\/(persona|world)(?:\/(created_[0-9a-f]{32}@[1-9]\d*)(\/export)?)?$/);
  if(creator){
    const kind=creator[1] as 'persona'|'world',reference=creator[2],match=reference?.match(/^(.*)@(\d+)$/),value=match?await entity(match[1],owner):undefined;
    if(reference&&(!value||value.deleted||value.kind!==kind))throw fail('Saved setting not found',404);
    if(method==='GET'){
      if(!reference)return json({items:(await readRecords()).filter(e=>e.kind===kind&&e.payload.creator).map(e=>creatorView(e))});
      const item=creatorView(value!,Number(match![2]));
      if(creator[3]){const document=CreatorDocumentSchema.parse(Object.fromEntries(Object.keys(CreatorDocumentSchema.innerType().shape).map(key=>[key,item[key]])));return json({format:'kyalulu-creator',version:1,kind,document});}
      return json({item,versions:Object.keys(value!.payload.versions).map(r=>creatorView(value!,Number(r))).sort((a,b)=>b.revision-a.revision)});
    }
    if(!['POST','PUT'].includes(method)||method==='PUT'&&!reference||method==='POST'&&reference)throw fail('Invalid creator operation',405);
    if(value&&(value.payload.current_revision??value.revision)!==Number(match![2]))throw fail('Setting revision changed',409);
    if(value?.payload.snapshot_only)throw fail('Synced revisions are immutable; create a separate editable copy',409);
    const document=CreatorDocumentSchema.parse(body),revision=value?(value.payload.current_revision??value.revision)+1:1,id=value?.id??'created_'+crypto.randomUUID().replaceAll('-','');
    if(value?.payload.versions?.[revision])throw fail('A synchronized version already exists; create a separate copy',409);
    const payload={...value?.payload,creator:document,storage_policy:'local',current_revision:revision,versions:{...value?.payload.versions,[revision]:document},dates:{...value?.payload.dates,[revision]:new Date().toISOString()}};
    const saved=await saveEntity(value?{...value,payload}:newEntity(kind,id,payload,owner),value?.revision);return json(creatorView(saved,revision),value?200:201);
  }
  if(path==='/api/chat/stream')return generate(body,init.signal??undefined);
  if(path==='/api/chat/sessions'){
    const records=await readRecords(),sessions=records.filter(e=>e.kind==='conversation');
    return json({sessions:sessions.map(e=>{
    const p=e.payload,c=builtin.find(c=>c.id===p.settings.character_id),last=p.messages.at(-1);
    const preview=p.cache_evicted?p.cache_preview:{count:p.messages.length,last_at:last?.created_at??null,last_preview:last?.content??''};
    return {session_id:e.id,...preview,character_id:p.settings.character_id,character_name:c?.display_name??records.find(r=>r.id===p.settings.character_id)?.payload.document?.name??p.title??null,
      world_id:p.settings.world_id,nsfw:false,sync_recovery:!!p.recovery_from,offline_available:!p.cache_evicted};
    }).sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)))});
  }
  if(path==='/api/chat/settings') {
    const session=await conversation(body.session_id??url.searchParams.get('session_id')??'default',owner);
    if(method==='GET')return json(session.payload.settings);
    if(running)throw fail('Stop generation before editing',409);
    if(typeof body.system_prompt!=='string'||body.system_prompt.length>128000)throw fail('Invalid system prompt');
    if(typeof body.temperature!=='number'||!Number.isFinite(body.temperature)||body.temperature<0||body.temperature>2)throw fail('Invalid temperature');
    const binding=LibraryBindingSchema.parse(body.library_binding??{});
    if(!binding.character&&body.character_id){const saved=await entity(body.character_id,owner);if(saved?.payload.document?.kind==='character')binding.character={id:saved.id,revision:saved.payload.current_revision??saved.revision};}
    const settings=ConversationSettingsSchema.parse({...body,library_binding:binding});await compiled(settings,[],owner);
    await saveEntity({...session,payload:{...session.payload,settings}},session.revision);return json({ok:true});
  }
  if(path==='/api/chat/history') {
    const session=await conversation(url.searchParams.get('session_id')??'default',owner);
    if(method==='GET')return json({history:session.payload.messages});
    if(running)throw fail('Stop generation before editing',409);
    await saveEntity({...session,payload:{...session.payload,messages:[]}},session.revision);return json({ok:true});
  }
  if(/^\/api\/chat\/history\/\d+$/.test(path)) {
    if(running)throw fail('Stop generation before editing',409);
    const id=Number(path.split('/').at(-1)),found=(await readRecords()).find(s=>s.kind==='conversation'&&s.payload.messages.some((m:any)=>m.id===id));
    if(!found)throw fail('Message not found',404);
    const session=await conversation(found.id,owner);
    if(method!=='DELETE'&&(typeof body.content!=='string'||!body.content.trim()||body.content.length>128000))throw fail('Invalid message');
    const messages=method==='DELETE'?session.payload.messages.filter((m:any)=>m.id!==id):session.payload.messages.map((m:any)=>m.id===id?{...m,content:body.content}:m);
    await saveEntity({...session,payload:{...session.payload,messages}},session.revision);return json({ok:true});
  }
  if(path==='/api/chat/intro/inject') {
    const session=await conversation(url.searchParams.get('session_id')??'default',owner);
    if(session.payload.messages.length)return json({injected:false});
    const d=await documentFor(session.payload.settings,owner),intro=d.data.first_mes??d.data.intro??'';
    if(!intro)return json({injected:false});
    const message={id:await nextId(owner),uuid:crypto.randomUUID(),role:'assistant',content:intro,model_id:'intro',created_at:new Date().toISOString()};
    await saveEntity({...session,payload:{...session.payload,messages:[message]}},session.revision);return json({injected:true,intro});
  }
  const generation=path.match(/^\/api\/chat\/generations\/([^/]+)(\/cancel)?$/);
  if(generation) {
    const key='generation:'+owner+':'+generation[1],status=await getMeta<any>(key);
    if(!status||status.session_id!==url.searchParams.get('session_id'))throw fail('Generation not found',404);
    if(generation[2]&&running===generation[1])runtime?.stop();
    if(status.status==='pending'&&running!==generation[1]){status.status='failed';await setMeta(key,status);}
    return json(status);
  }
  const branch=path.match(/^\/api\/chat\/sessions\/([^/]+)\/(branch|data)$/);
  if(branch) {
    if(running)throw fail('Stop generation before editing',409);
    const source=await conversation(branch[1],owner);
    if(branch[2]==='data'){
      if(source.payload.storage_policy==='sync')await saveEntity({...source,deleted:true,payload:{...source.payload,delete_confirmation_revision:source.revision+1}},source.revision,{[memoryEventsKey(owner,source.id)]:[]});
      else await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
        const store=tx.objectStore('entities'),read=store.get([source.owner,source.id]);
        read.onsuccess=()=>{
          if(deviceOwner()!==source.owner||read.result?.revision!==source.revision){tx.abort();return;}
          writeEntity(tx,{...source,deleted:true,dirty:false,revision:source.revision+1,payload:{storage_policy:'local'}});
          scrubGenerationRecords(tx,source.owner,source.id);done();
        };
      });
      return json({ok:true});
    }
    const index=source.payload.messages.findIndex((m:any)=>m.id===body.message_id);
    if(index<0)throw fail('Branch point not found');
    const point=source.payload.messages[index],snapshot=point.role==='assistant'?point.after:source.payload.messages[index+1]?.before??source.payload.messages.slice(0,index).reverse().find((m:any)=>m.after)?.after;
    if(!snapshot)throw fail('Historical state is unavailable for branching',409);
    const id=crypto.randomUUID(),payload=structuredClone(source.payload),turn=snapshot?.state.turn??0;
    payload.messages=payload.messages.slice(0,index+1);payload.memories=structuredClone(snapshot?.memories??[]);payload.state=structuredClone(snapshot?.state??RuntimeStateSchema.parse({session_id:id}));
    if(snapshot.settings)payload.settings=structuredClone(snapshot.settings);
    payload.summaries=payload.summaries.filter((s:any)=>s.source_message_ids?.every((mid:number)=>payload.messages.some((m:any)=>m.id===mid)));
    payload.branch_of=source.id;payload.fork_revision=source.revision;payload.settings.session_id=id;payload.state.session_id=id;payload.state.turn=turn;
    payload.last_generation=null;
    await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('entities'),meta=tx.objectStore('meta'),read=store.get([owner,source.id]);
      read.onsuccess=()=>{
        if(read.result?.revision!==source.revision||owner!==deviceOwner()){tx.abort();return;}
        const sequence=meta.get('message-sequence:'+owner);
        sequence.onsuccess=()=>{
          try {
            let number=sequence.result??0;
            const copy=rebindConversation(receiveConversation(payload,undefined,()=>++number),id);
            writeEntity(tx,{...newEntity('conversation',id,copy),owner,revision:1,dirty:copy.storage_policy==='sync'},'add');
            meta.put(number,'message-sequence:'+owner);done();
          }catch{tx.abort();}
        };
      };
    });return json({session_id:id});
  }
  const context=path.match(/^\/api\/chat\/context\/([^/]+)(?:\/summaries\/([^/]+))?$/);
  if(context) {
    const session=await conversation(context[1],owner);
    if(method==='GET')return json({history_revision:String(session.revision),summaries:session.payload.summaries,scope:session.id});
    if(running)throw fail('Stop generation before editing',409);
    const summary=session.payload.summaries.find((s:any)=>s.id===context[2]);
    if(!summary)throw fail('Summary not found',404);
    if(String(summary.revision)!==String(body.expected_revision))throw fail('Summary changed',409);
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>128000)throw fail('Invalid summary');
    summary.text=body.text;summary.revision+=1;summary.method='manual';await saveEntity(session,session.revision);return json(summary);
  }
  if(path==='/api/chat/debug') {
    const session=await conversation(url.searchParams.get('session_id')??'default',owner),p=session.payload;
    return json({session_id:session.id,settings:p.settings,compiled:p.last_generation?.compiled??await compiled(p.settings,[],owner),history_count:p.messages.length,approx_turn:p.state.turn,
      relationship:p.state.relationship_state.stage,state:p.state,generation:p.last_generation??null,memory:p.last_generation?.memory??p.last_generation?.telemetry?.memory??null,
      memory_session:{enabled:p.memory_enabled===true,scope:session.id}});
  }
  const memorySession=path.match(/^\/api\/memory\/session\/([^/]+)(\/data|\/scope-preview|\/scope-migrate)?$/);
  if(memorySession) {
    const suffix=memorySession[2];
    if(!(suffix==='/data'?method==='DELETE':suffix==='/scope-preview'?method==='GET':suffix==='/scope-migrate'?method==='POST':['GET','PUT'].includes(method)))throw fail('Invalid memory operation',405);
    const session=await conversation(memorySession[1],owner);
    if(memorySession[2]==='/scope-preview')return json({scope:session.id,target_scope:session.id,preview_revision:String(session.revision),memories:session.payload.memories,identity:{session_id:session.id}});
    if(memorySession[2]==='/scope-migrate')throw fail('On-device memories remain isolated to their conversation',409);
    if(method!=='GET') {
      if(running)throw fail('Stop generation before editing',409);
      if(suffix==='/data')session.payload.memories=[];
      else {if(typeof body.enabled!=='boolean')throw fail('Choose whether memory is enabled');session.payload.memory_enabled=body.enabled;}
      await saveEntity(session,session.revision,suffix==='/data'?{[memoryEventsKey(owner,session.id)]:[]}:{});
    }
    return json(suffix==='/data'?{ok:true,scope:session.id,affects_shared_sessions:false}:{session_id:session.id,scope:session.id,enabled:session.payload.memory_enabled});
  }
  if(path==='/api/memory/scopes'){
    if(method!=='GET')throw fail('Memory scopes require GET',405);
    const scopes=(await readRecords()).filter(s=>s.kind==='conversation'&&s.payload.memories.length).map(s=>({scope:s.id,
      active:s.payload.memories.filter((m:DeviceMemory)=>m.status==='active').length,total:s.payload.memories.length,
      updated_at:s.payload.memories.map((m:DeviceMemory)=>m.updated_at??'').sort().at(-1)??null}));
    return json({scopes:scopes.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))});
  }
  if(path==='/api/memory/events'){
    if(method!=='GET')throw fail('Memory events require GET',405);
    const scope=url.searchParams.get('scope'),limit=Number(url.searchParams.get('limit')??200);
    if(!scope||!Number.isInteger(limit))throw fail('Choose a memory scope and integer limit');
    return json({events:(await memoryEvents(owner,scope)).slice().reverse().slice(0,Math.min(Math.max(limit,1),1000))});
  }
  if(path==='/api/memory/search'){
    if(method!=='POST')throw fail('Memory search requires POST',405);
    if(typeof body.scope!=='string'||!body.scope||typeof body.query!=='string'||Array.from(body.query).length>4000
      ||body.top_k!==undefined&&(!Number.isInteger(body.top_k)||body.top_k<1||body.top_k>20)
      ||body.budget_tokens!==undefined&&(!Number.isInteger(body.budget_tokens)||body.budget_tokens<20||body.budget_tokens>4000))throw fail('Invalid memory search');
    const session=await conversation(body.scope,owner),started=performance.now();
    const trace=retrieveMemories(session.payload.memories,body.query,{top_k:body.top_k??5,budget_tokens:body.budget_tokens??300});
    const block=renderMemoryBlock(trace.injected.map(id=>trace.candidates.find(m=>m.id===id)!));
    return json({...trace,scope:session.id,stored_count:session.payload.memories.filter((m:DeviceMemory)=>m.status==='active').length,retrieval_ms:Math.round((performance.now()-started)*100)/100,block});
  }
  const memoryPath=path.match(/^\/api\/memory(?:\/([^/]+))?$/);
  if(memoryPath) {
    const memoryId=memoryPath[1];
    if(!(memoryId?['GET','PATCH','PUT','DELETE'].includes(method):['GET','POST'].includes(method)))throw fail('Invalid memory operation',405);
    if(!memoryId&&method==='POST'&&(typeof body.scope!=='string'||!body.scope.trim()||Array.from(body.scope).length>300))throw fail('Choose a memory scope');
    const matches=memoryId?(await readRecords()).filter(s=>s.kind==='conversation'&&s.payload.memories.some((m:DeviceMemory)=>m.id===memoryId)):[];
    if(matches.length>1)throw fail('Memory identity is ambiguous; use a separate conversation copy',409);
    const found=matches[0];if(memoryId&&!found)throw fail('Memory not found',404);
    const session=await conversation(found?.id??body.scope??url.searchParams.get('scope')??'default',owner);
    const previous=session.payload.memories.find((m:DeviceMemory)=>m.id===memoryId) as DeviceMemory|undefined;
    if(method==='GET')return json(previous?{...previous,events:(await memoryEvents(owner,session.id)).filter(e=>e.memory_id===memoryId).reverse().slice(0,200)}
      :{scope:session.id,memories:session.payload.memories.filter((m:DeviceMemory)=>url.searchParams.get('include_deleted')==='true'||m.status==='active')});
    if(running)throw fail('Stop generation before editing',409);
    if(previous&&previous.status!=='active')throw fail('Memory not found',404);
    const content=body.content==null?previous?.content:typeof body.content==='string'?body.content.trim().replace(/\s+/gu,' '):undefined;
    const type=body.type??previous?.type;
    if(method!=='DELETE'&&(!content||Array.from(content).length>200))throw fail('Memory must have 1-200 characters');
    if(method!=='DELETE'&&!['semantic','episodic','relationship'].includes(type))throw fail('Invalid memory type');
    if(!previous&&(body.source_kind!==undefined&&!['user_statement','user_correction','work_setting','story_event'].includes(body.source_kind)
      ||body.source_quote!==undefined&&(typeof body.source_quote!=='string'||Array.from(body.source_quote).length>2000)
      ||body.source_revision!=null&&(typeof body.source_revision!=='string'||Array.from(body.source_revision).length>128)))throw fail('Invalid memory source');
    if(previous&&method!=='DELETE'&&previous.content===content&&previous.type===type)return json(previous);
    const now=new Date().toISOString();
    const memory=previous?(method==='DELETE'?{...previous,scope:session.id,status:'deleted',updated_at:now}:{...previous,scope:session.id,content,type,version:previous.version+1,
      origin:previous.origin==='model'?'model_edited':previous.origin,supported:null,source_kind:'user_correction',source_quote:content,source_revision:'manual:'+(previous.version+1),confirmation:'user_confirmed',updated_at:now})
      :{id:crypto.randomUUID(),scope:session.id,type,content,version:1,status:'active',origin:'user',supported:null,source_session_id:null,source_turn:null,source_generation_id:null,
        source_kind:body.source_kind??'user_statement',source_quote:body.source_quote||content,source_revision:body.source_revision||'manual:1',source_message_ids:[],confirmation:'user_confirmed',
        created_at:now,updated_at:now,access_count:0,last_accessed:null};
    const events=await memoryEvents(owner,session.id);
    addMemoryEvent(events,session.id,previous?(method==='DELETE'?'delete':'update'):'create',memory.id,null,previous?(method==='DELETE'?{content:previous.content}
      :{before:{content:previous.content,type:previous.type,version:previous.version},after:{content,type}}):{type,content,origin:'user'});
    session.payload.memories=previous?session.payload.memories.map((m:DeviceMemory)=>m.id===memoryId?memory:m):[...session.payload.memories,memory];
    await saveEntity(session,session.revision,{[memoryEventsKey(owner,session.id)]:events});return json(memory);
  }
  if(path==='/api/library') {
    if(method==='GET')return json({items:(await readRecords()).filter(e=>['character','preset'].includes(e.kind)&&e.payload.document).map(e=>libraryView(e))});
    const d=PortableDocumentSchema.parse(body);if(d.nsfw)throw fail('Adult verification required',403);
    await validateDeviceDocumentAssets(d,owner);
    const id=crypto.randomUUID(),value=newEntity(d.kind==='character'?'character':'preset',id,{storage_policy:'local',document:d,versions:{'1':d}},owner);
    const saved=await saveEntity(value);return json(libraryView(saved));
  }
  const library=path.match(/^\/api\/library\/([^/]+)(?:\/(revisions|export))?$/);
  if(library) {
    if(library[2]&&method!=='GET'||!['GET','PUT','DELETE'].includes(method))throw fail('Invalid Library operation',405);
    const value=await entity(library[1],owner);if(!value||value.deleted||!value.payload.document)throw fail('Library item not found',404);
    if(method==='PUT') {
      if(value.payload.snapshot_only)throw fail('Synced revisions are immutable; import a separate editable copy',409);
      if((value.payload.current_revision??value.revision)!==body.expected_revision)throw fail('Library revision changed',409);
      const d=PortableDocumentSchema.parse(body.document);if(d.nsfw)throw fail('Adult verification required',403);
      await validateDeviceDocumentAssets(d,owner);
      const revision=(value.payload.current_revision??value.revision)+1;
      if(value.payload.versions?.[revision])throw fail('A synchronized version already exists; create a separate copy',409);
      const saved=await saveEntity({...value,payload:{...value.payload,document:d,current_revision:revision,versions:{...value.payload.versions,[String(revision)]:d}}},value.revision);
      return json(libraryView(saved));
    }
    if(method==='DELETE'){await saveEntity({...value,deleted:true},value.revision);return json({ok:true});}
    if(library[2]==='revisions')return json({items:Object.keys(value.payload.versions).map(r=>libraryView(value,Number(r)))});
    if(library[2]==='export'){
      const item=libraryView(value,url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined);
      if(item.document.nsfw)throw fail('Adult verification required',403);
      const format=url.searchParams.get('format')??'ccv3-json';
      let result:{raw:Uint8Array;mime:string;filename:string;notices:{path:string;reason:string}[]};
      if(format==='original'){
        const original=item.original_id?await getMeta<{filename:string;raw:Uint8Array}>('original:'+owner+':'+item.original_id):undefined;
        if(!original||!(original.raw instanceof Uint8Array))throw fail('Original file is unavailable',404);
        if(contentHash(original.raw)!==item.original_id)throw fail('Original file checksum mismatch',409);
        result={raw:original.raw,mime:'application/octet-stream',filename:original.filename,notices:[]};
      }else{
        const assets=new Map<string,ExportAsset>();
        for(const asset of item.document.assets??[])if(asset.asset_id&&!assets.has(asset.asset_id)){
          assets.set(asset.asset_id,await readDeviceAsset(owner,asset.asset_id));
        }
        result=exportPortable(item.document,format,assets);
      }
      const download=(url.searchParams.get('download')??'false').toLowerCase();
      if(!['true','1','yes','on','false','0','no','off'].includes(download))throw fail('Invalid download flag');
      if(['false','0','no','off'].includes(download))return json({filename:result.filename,media_type:result.mime,bytes:result.raw.byteLength,notices:result.notices});
      return new Response(new Uint8Array(result.raw),{headers:{'Content-Type':result.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(result.filename).replace(/[!'()*]/g,character=>'%'+character.charCodeAt(0).toString(16).toUpperCase())}});
    }
    return json(libraryView(value,url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined));
  }
  if(path==='/api/imports/text/preview'||path==='/api/imports/preview') {
    if(method!=='POST')throw fail('Preview requires POST',405);
    const records=await readRecords();
    let filename=typeof body.filename==='string'?body.filename:'character.txt',raw:Uint8Array;
    if(init.body instanceof FormData){const file=init.body.get('file');if(!(file instanceof File)||file.size>32*1024*1024)throw fail('Choose a file up to 32 MiB');raw=new Uint8Array(await file.arrayBuffer());filename=file.name;}
    else {if(typeof body.text!=='string'||Array.from(body.text).length>2000000)throw fail('Invalid import text');raw=encoder.encode(body.text);}
    const {documents,assets}=await parseDeviceImport(filename,raw);
    if(documents.some(doc=>doc.nsfw))throw fail('Adult verification required',403);
    const preview_id=crypto.randomUUID(),preview={preview_id,filename,source_hash:contentHash(raw),documents,
      duplicates:Object.fromEntries(documents.map((document,index)=>[String(index),deviceSourceMatches(document,records,owner).map(value=>({id:value.id,revision:value.payload.current_revision??value.revision,name:value.payload.document.name}))]))};
    await appTransaction<void>(['meta'],'readwrite',(tx,done)=>{
      if(owner!==deviceOwner())throw fail('Account changed',409);
      const store=tx.objectStore('meta');
      for(const [id,asset] of assets)store.put(asset,'asset:'+owner+':'+id);
      store.put({...preview,original:{filename,raw}},'preview:'+owner+':'+preview_id);done();
    });return json(preview);
  }
  const commit=path.match(/^\/api\/imports\/([^/]+)\/commit$/);
  if(commit){if(method!=='POST')throw fail('Import requires POST',405);return json(await commitDeviceImport(owner,commit[1],body,await readRecords()));}
  if(path==='/api/prompts/presets') {
    if(method==='GET')return json({presets:(await readRecords()).filter(e=>e.kind==='preset'&&e.payload.content).map(e=>({id:e.id,...e.payload}))});
    if(typeof body.content!=='string'||body.content.length>128000||typeof body.name!=='string')throw fail('Invalid preset');
    const e=await saveEntity(newEntity('preset',crypto.randomUUID(),{...body,storage_policy:'local',nsfw:false},owner));return json({id:e.id,...e.payload});
  }
  if(path.startsWith('/api/prompts/presets/')) {
    const e=await entity(path.split('/').at(-1)!,owner);if(!e)throw fail('Preset not found',404);
    if(method==='DELETE'){await saveEntity({...e,deleted:true},e.revision);return json({ok:true});}
    if(typeof body.content!=='string'||body.content.length>128000)throw fail('Invalid preset');
    const saved=await saveEntity({...e,payload:{...e.payload,...body}},e.revision);return json({id:e.id,...saved.payload});
  }
  if(path==='/api/scenarios')return json({scenarios:catalog.scenarios.map(s=>({...s,turns:s.turns.length}))});
  if(path.startsWith('/api/local/cloud'))return json({mode:'off',selected:[],connected:false,origin:location.origin,revision:0});
  if(path==='/api/remote/status')return json({installed:false,connected:false});
  throw fail('This operation is not yet implemented by the browser runtime: '+path,501);
}
