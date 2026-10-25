import { PortableDocumentSchema, DeviceGenerationOutputSchema, RuntimeStateSchema, LibraryBindingSchema, CreatorDocumentSchema, CastMemberSchema, ConversationSettingsSchema } from '../../../../packages/schemas/src';
import catalog from '../mobile/app-catalog.generated.json';
import { MobileRuntime } from '../mobile/runtime';
import { MODELS, readyModels } from '../mobile/models';
import { allEntities, entity, openEntity, saveEntity, newEntity, getMeta, setMeta, appTransaction, scrubGenerationRecords, trimOfflineCache, type AppEntity } from './appStore';
import { deviceOwner, setGenerationBusy } from './appContext';
import { estimateTokens, retrieveMemories, prepareRpg, validateProposals, refreshSummaries, type DeviceMemory } from './deviceCore';
import { receiveConversation, rebindConversation } from './appSyncData';
import { hydrateConversation } from './appSync';
import { compilePortable, assemblePortable } from './devicePrompt';
import { sampling } from '../mobile/sampling';
import { exportPortable, type ExportAsset } from './deviceExport';
import { Sha256 } from '../mobile/sha256';
import { commitDeviceImport } from './deviceImport';

let runtime:MobileRuntime|undefined, loaded='';
let running:string|null=null;
const encoder=new TextEncoder();
const contentHash=(raw:Uint8Array)=>new Sha256().update(raw).digest();
const outputSchema=DeviceGenerationOutputSchema;
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=(message:string,status=400)=>Object.assign(Error(message),{status});
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
async function generate(body:Record<string,any>,signal?:AbortSignal) {
  const owner=deviceOwner(),currentOwner=()=>{if(owner!==deviceOwner())throw fail('Account changed',409);};
  if(running)throw fail('A generation is already running',409);
  const id=String(body.session_id??'default'),generationId=body.generation_id;
  if(typeof generationId!=='string'||generationId.length>200||!Array.isArray(body.messages)||!body.messages.length||body.messages.length>200
    ||body.messages.some((m:any)=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>128000))throw fail('Invalid generation request');
  if(body.allow_nsfw)throw fail('Adult verification is required',403);
  const existing=await getMeta<any>('generation:'+owner+':'+generationId);currentOwner();
  if(existing)throw fail('Generation already exists; reconcile its saved status',409);
  const model=MODELS.find(m=>m.id===body.model_id);
  if(!model||!(await readyModels()).has(model.id))throw fail('Prepare this model in Settings / 設定からモデルを準備してください',409);
  currentOwner();
  running=generationId;setGenerationBusy(true);
  try {
    runtime??=new MobileRuntime();
    if(loaded!==model.id){await runtime.load(model.id,false,new URL('/',location.href).href);loaded=model.id;}
    currentOwner();
    const session=await conversation(id,owner),p=session.payload;
    const last=body.messages.at(-1);
    if(last.role!=='user')throw fail('A user message is required');
    const userId=body.regenerate_message_id?p.messages.at(-2)?.id:await nextId(owner),assistantId=await nextId(owner);
    let messages=[...p.messages];
    let baseState=p.state,baseMemories=p.memories;
    if(body.regenerate_message_id){
      const previous=messages.at(-1);
      if(previous?.id!==body.regenerate_message_id||previous.role!=='assistant'||messages.at(-2)?.content!==last.content)throw fail('Only the latest reply may be regenerated',409);
      if(!previous.before)throw fail('Historical state is unavailable for regeneration',409);
      baseState=previous.before.state;baseMemories=previous.before.memories;messages=messages.slice(0,-1);
    }
    if(!body.regenerate_message_id)messages.push({id:userId,uuid:crypto.randomUUID(),role:'user',content:last.content,created_at:new Date().toISOString(),model_id:model.id});
    const prompt=await compiled({...p.settings,system_prompt:body.system_prompt??p.settings.system_prompt},messages,owner);currentOwner();
    const requested={...prompt.sections.generation_settings,temperature:body.temperature??p.settings.temperature??model.temperature};
    for(const key of ['seed','max_tokens','top_p'])if(body[key]!==undefined)(requested as Record<string,unknown>)[key]=body[key];
    const generationConfig=sampling(model,requested);
    const frozenSettings=ConversationSettingsSchema.parse({...p.settings,session_id:id,system_prompt:body.system_prompt??p.settings.system_prompt??'',temperature:requested.temperature});
    const trace=retrieveMemories(p.memory_enabled?baseMemories:[],last.content);
    const memories=trace.candidates.filter(m=>trace.injected.includes(m.id));
    const world=prompt.sections.portable_snapshot.world;
    const cast=(world?.cast??[]).map((member:unknown)=>CastMemberSchema.parse(member));
    if(cast.length>12||new Set(cast.map((member:any)=>member.id)).size!==cast.length)throw fail('Invalid cast configuration');
    const rpg=world?.rpg?prepareRpg(world.rpg,baseState.rpg??{},last.content,generationId):baseState.rpg;
    const system='Never choose the user\'s thoughts, actions or speech.\nState: '+JSON.stringify({...baseState,rpg})+
      (cast.length?'\nCast: label each speaker by name; keep their knowledge and relationships separate. Never choose the user\'s thoughts or actions.\n'+JSON.stringify(cast):'')+
      (world?.rpg?'\nServer-owned RPG outcome: narrate these results; never invent rolls or change HP, skills or inventory. Reject actions forbidden by the world rules.\n'+JSON.stringify(rpg):'')+
      '\nRemember only these recorded memories: '+JSON.stringify(memories.map(m=>({type:m.type,content:m.content})))+
      '\nReturn JSON only: {"reply":"your in-character reply","state_update":{"location":"","time":"","mood":"","active_scene":"","relationship_state":{"stage":"stranger","tone":"neutral","unresolved_conflict":false}},"memory_proposals":[]}. Memory proposals: at most 3, each {type:semantic|episodic|relationship,content,source_kind:user_statement|user_correction|work_setting|story_event}. Never invent user facts.';
    const pending={generation_id:generationId,session_id:id,status:'pending',assistant_id:null,user_id:body.regenerate_message_id?null:userId};
    let current=await saveEntity({...session,payload:{...p,messages,pending_generation:generationId}},session.revision,{['generation:'+owner+':'+generationId]:pending});
    let closed=false;
    const stream=new ReadableStream<Uint8Array>({start(controller) {
      let ended=false,raw='';
      const send=(event:string,data:unknown)=>{if(!ended&&!closed)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));};
      const abort=()=>runtime?.stop();signal?.addEventListener('abort',abort,{once:true});
      void (async()=>{
        try {
          signal?.throwIfAborted();
          const result=await runtime!.generate(assemblePortable(prompt,messages.filter((m:any)=>!['stopped','interrupted'].includes(m.imported_state)).map((m:any)=>({role:m.role,content:m.content})),system) as import('../mobile/types').ChatTurn[],event=>{
            if(event.type==='delta'){raw+=event.text??'';send('progress',{stage:'generation',elapsed_ms:0});}
          },requested);
          if(deviceOwner()!==owner)throw fail('Account changed');
          if((result as any).stopped||signal?.aborted)throw fail('Generation stopped');
          let parsed;
          try { parsed=outputSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))); }
          catch {throw fail('The model returned an invalid structured response. No memory or story state was applied. / モデルの応答形式が不正です。記憶・状態は変更していません。');}
          const state={...baseState,...parsed.state_update,rpg,turn:(baseState.turn??0)+1};
          const stored:DeviceMemory[]=[...baseMemories];
          if(p.memory_enabled)for(const proposal of validateProposals(parsed.memory_proposals,baseMemories,last.content)) {
            if(proposal.action!=='store')continue;
            const supported='supported' in proposal&&proposal.supported===true;
            stored.push({...proposal,id:crypto.randomUUID(),scope:id,origin:'model',supported,status:'active',version:1,
              source_session_id:id,source_turn:state.turn,source_message_ids:[userId],source_quote:last.content,confirmation:supported?'evidenced':'unverified',
              created_at:new Date().toISOString(),updated_at:new Date().toISOString(),access_count:0,last_accessed:null});
          }
          messages.push({id:assistantId,uuid:crypto.randomUUID(),role:'assistant',content:parsed.reply,created_at:new Date().toISOString(),model_id:model.id,
            before:{state:baseState,memories:baseMemories,settings:structuredClone(frozenSettings)},after:{state,memories:stored,settings:structuredClone(frozenSettings)}});
          const done={...pending,status:'completed',assistant_id:assistantId,full:parsed.reply,reply:parsed.reply,state,telemetry:{memory:trace,...result.measurement},
            generation_config:{...generationConfig,requested:{model_id:model.id,...generationConfig.requested},applied:{model_id:model.id,...generationConfig.applied}},validation:{ok:true,retries:0,errors:[]}};
          current=await saveEntity({...current,payload:{...current.payload,messages,memories:stored,state,last_generation:done,pending_generation:null,
            summaries:refreshSummaries(messages,p.summaries,id)}},current.revision,{['generation:'+owner+':'+generationId]:done});
          send('done',done);
        } catch(error) {
          let saveError='';
          try{current=await saveEntity({...current,payload:{...current.payload,pending_generation:null}},current.revision,{['generation:'+owner+':'+generationId]:{...pending,status:'failed'}});}
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
  const records=(await allEntities(owner)).filter(e=>!e.deleted),sessions=records.filter(e=>e.kind==='conversation');
  if(owner!==deviceOwner())throw fail('Account changed',409);
  if(path==='/api/mobile/status')return json({cloud_mode:false,remote_mode:false,authenticated:true,administrative:false,device_mode:true});
  if(path==='/api/health')return json({status:'ok',version:'0.1.0',runtime:'browser'});
  if(path==='/api/capabilities')return json({schema_version:1,mode:'local',model_selection:'local',features:{regenerate:true,suggestions:false,stored_context:false,progress:true,branch:true,permanent_delete:true,summaries:true,world_memory:true,story_rules:true,community:false,media_playback:false,media_generation:false}});
  if(path==='/api/models') {const ready=await readyModels();return json({models:MODELS.map(m=>({id:m.id,display_name:m.name,provider_type:'browser',provider_model:m.id,quantization:m.runtime,context_length:2048,available:ready.has(m.id),unavailable_reason:ready.has(m.id)?null:'Download required'}))});}
  if(path==='/api/providers/health')return json({health:[{id:'browser',provider:'browser',status:'ok'}]});
  if(path==='/api/diagnostics')return json({ready:true,checks:[{id:'browser',ok:true,message:'On-device runtime',hint:null,detail:null}]});
  if(path==='/api/commands')return json(method==='GET'?{commands:[]}:{ok:false,command:'',output:'Use Settings to manage on-device models',refresh_models:false});
  if(path==='/api/characters')return json({characters:[...builtin.map(c=>({...c,portrait_url:c.id==='senior_cool'?'/icons/rei-senpai.png':c.id==='butler'?'/icons/shion-butler-1.png':c.id==='mocha_sfw'?'/icons/mocha-1.png':null})),
    ...records.filter(e=>e.kind==='character'&&!e.payload.document?.nsfw).map(e=>({id:e.id,display_name:e.payload.document.name,description:String(e.payload.document.data.description??e.payload.document.data.personality??''),intro:e.payload.document.data.first_mes??'',tags:e.payload.document.data.tags??[],version:String(e.payload.current_revision??e.revision),library_revision:e.payload.current_revision??e.revision}))]});
  if(path==='/api/personas')return json({personas:[...catalog.personas,...records.filter(e=>e.kind==='persona'&&e.payload.creator).map(e=>creatorView(e))]});
  if(path==='/api/worlds')return json({worlds:[...catalog.worlds,...records.filter(e=>e.kind==='world'&&e.payload.creator).map(e=>creatorView(e))]});
  if(path==='/api/prompt/compile')return json(await compiled(body,[],owner));
  const creator=path.match(/^\/api\/creator\/(persona|world)(?:\/(created_[0-9a-f]{32}@[1-9]\d*)(\/export)?)?$/);
  if(creator){
    const kind=creator[1] as 'persona'|'world',reference=creator[2],match=reference?.match(/^(.*)@(\d+)$/),value=match?await entity(match[1],owner):undefined;
    if(reference&&(!value||value.deleted||value.kind!==kind))throw fail('Saved setting not found',404);
    if(method==='GET'){
      if(!reference)return json({items:records.filter(e=>e.kind===kind&&e.payload.creator).map(e=>creatorView(e))});
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
  if(path==='/api/chat/sessions')return json({sessions:sessions.map(e=>{
    const p=e.payload,c=builtin.find(c=>c.id===p.settings.character_id),last=p.messages.at(-1);
    const preview=p.cache_evicted?p.cache_preview:{count:p.messages.length,last_at:last?.created_at??null,last_preview:last?.content??''};
    return {session_id:e.id,...preview,character_id:p.settings.character_id,character_name:c?.display_name??records.find(r=>r.id===p.settings.character_id)?.payload.document?.name??p.title??null,
      world_id:p.settings.world_id,nsfw:false,sync_recovery:!!p.recovery_from,offline_available:!p.cache_evicted};
  }).sort((a,b)=>String(b.last_at).localeCompare(String(a.last_at)))});
  if(path==='/api/chat/settings') {
    const session=await conversation(body.session_id??url.searchParams.get('session_id')??'default');
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
    const session=await conversation(url.searchParams.get('session_id')??'default');
    if(method==='GET')return json({history:session.payload.messages});
    if(running)throw fail('Stop generation before editing',409);
    await saveEntity({...session,payload:{...session.payload,messages:[]}},session.revision);return json({ok:true});
  }
  if(/^\/api\/chat\/history\/\d+$/.test(path)) {
    if(running)throw fail('Stop generation before editing',409);
    const id=Number(path.split('/').at(-1)),found=sessions.find(s=>s.payload.messages.some((m:any)=>m.id===id));
    if(!found)throw fail('Message not found',404);
    const session=await conversation(found.id,owner);
    if(method!=='DELETE'&&(typeof body.content!=='string'||!body.content.trim()||body.content.length>128000))throw fail('Invalid message');
    const messages=method==='DELETE'?session.payload.messages.filter((m:any)=>m.id!==id):session.payload.messages.map((m:any)=>m.id===id?{...m,content:body.content}:m);
    await saveEntity({...session,payload:{...session.payload,messages}},session.revision);return json({ok:true});
  }
  if(path==='/api/chat/intro/inject') {
    const session=await conversation(url.searchParams.get('session_id')??'default');
    if(session.payload.messages.length)return json({injected:false});
    const d=await documentFor(session.payload.settings),intro=d.data.first_mes??d.data.intro??'';
    if(!intro)return json({injected:false});
    const message={id:await nextId(owner),uuid:crypto.randomUUID(),role:'assistant',content:intro,model_id:'intro',created_at:new Date().toISOString()};
    await saveEntity({...session,payload:{...session.payload,messages:[message]}},session.revision);return json({injected:true,intro});
  }
  const generation=path.match(/^\/api\/chat\/generations\/([^/]+)(\/cancel)?$/);
  if(generation) {
    const key='generation:'+deviceOwner()+':'+generation[1],status=await getMeta<any>(key);
    if(!status||status.session_id!==url.searchParams.get('session_id'))throw fail('Generation not found',404);
    if(generation[2]&&running===generation[1])runtime?.stop();
    if(status.status==='pending'&&running!==generation[1]){status.status='failed';await setMeta(key,status);}
    return json(status);
  }
  const branch=path.match(/^\/api\/chat\/sessions\/([^/]+)\/(branch|data)$/);
  if(branch) {
    if(running)throw fail('Stop generation before editing',409);
    const source=await conversation(branch[1]);
    if(branch[2]==='data'){
      if(source.payload.storage_policy==='sync')await saveEntity({...source,deleted:true,payload:{...source.payload,delete_confirmation_revision:source.revision+1}},source.revision);
      else await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
        const store=tx.objectStore('entities'),read=store.get([source.owner,source.id]);
        read.onsuccess=()=>{
          if(deviceOwner()!==source.owner||read.result?.revision!==source.revision){tx.abort();return;}
          store.put({...source,deleted:true,dirty:false,revision:source.revision+1,payload:{storage_policy:'local'}});
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
    const owner=source.owner;
    await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('entities'),meta=tx.objectStore('meta'),read=store.get([owner,source.id]);
      read.onsuccess=()=>{
        if(read.result?.revision!==source.revision||owner!==deviceOwner()){tx.abort();return;}
        const sequence=meta.get('message-sequence:'+owner);
        sequence.onsuccess=()=>{
          try {
            let number=sequence.result??0;
            const copy=rebindConversation(receiveConversation(payload,undefined,()=>++number),id);
            store.add({...newEntity('conversation',id,copy),owner,revision:1,dirty:copy.storage_policy==='sync'});
            meta.put(number,'message-sequence:'+owner);done();
          }catch{tx.abort();}
        };
      };
    });return json({session_id:id});
  }
  const context=path.match(/^\/api\/chat\/context\/([^/]+)(?:\/summaries\/([^/]+))?$/);
  if(context) {
    const session=await conversation(context[1]);
    if(method==='GET')return json({history_revision:String(session.revision),summaries:session.payload.summaries});
    if(running)throw fail('Stop generation before editing',409);
    const summary=session.payload.summaries.find((s:any)=>s.id===context[2]);
    if(!summary)throw fail('Summary not found',404);
    if(String(summary.revision)!==String(body.expected_revision))throw fail('Summary changed',409);
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>128000)throw fail('Invalid summary');
    summary.text=body.text;summary.revision+=1;summary.method='manual';await saveEntity(session,session.revision);return json(summary);
  }
  if(path==='/api/chat/debug') {
    const session=await conversation(url.searchParams.get('session_id')??'default'),p=session.payload;
    return json({session_id:session.id,settings:p.settings,compiled:await compiled(p.settings),history_count:p.messages.length,approx_turn:p.state.turn,
      relationship:p.state.relationship_state.stage,state:p.state,generation:p.last_generation??null});
  }
  const memorySession=path.match(/^\/api\/memory\/session\/([^/]+)(\/data|\/scope-preview|\/scope-migrate)?$/);
  if(memorySession) {
    const session=await conversation(memorySession[1]);
    if(memorySession[2]==='/scope-preview')return json({scope:session.id,target_scope:session.id,preview_revision:String(session.revision),memories:session.payload.memories,identity:{session_id:session.id}});
    if(memorySession[2]==='/scope-migrate')throw fail('On-device memories remain isolated to their conversation',409);
    if(method!=='GET') {
      if(running)throw fail('Stop generation before editing',409);
      if(memorySession[2]==='/data')session.payload.memories=[];
      else session.payload.memory_enabled=body.enabled===true;
      await saveEntity(session,session.revision);
    }
    return json({scope:session.id,enabled:session.payload.memory_enabled});
  }
  if(path==='/api/memory'||path.startsWith('/api/memory/')) {
    const memoryId=path.split('/')[3];
    const found=memoryId?sessions.find(s=>s.payload.memories.some((m:any)=>m.id===memoryId)):null;
    if(memoryId&&!found)throw fail('Memory not found',404);
    const session=await conversation(found?.id??body.scope??url.searchParams.get('scope')??'default',owner);
    if(method==='GET')return json({memories:session.payload.memories.filter((m:any)=>m.status==='active')});
    if(running)throw fail('Stop generation before editing',409);
    if(method!=='DELETE'&&(typeof body.content!=='string'||!body.content.trim()||Array.from(body.content).length>200))throw fail('Memory must have 1-200 characters');
    if(body.type&&!['semantic','episodic','relationship'].includes(body.type))throw fail('Invalid memory type');
    const now=new Date().toISOString();
    let memory=session.payload.memories.find((m:any)=>m.id===memoryId);
    if(memory){memory={...memory,...body,scope:session.id,id:memoryId,version:memory.version+1,status:method==='DELETE'?'deleted':'active',origin:'manual',supported:true,updated_at:now};session.payload.memories=session.payload.memories.map((m:any)=>m.id===memoryId?memory:m);}
    else {memory={id:crypto.randomUUID(),scope:session.id,type:body.type,content:body.content,version:1,status:'active',origin:'manual',supported:true,source_session_id:null,source_turn:null,created_at:now,updated_at:now,access_count:0,last_accessed:null};session.payload.memories.push(memory);}
    await saveEntity(session,session.revision);return json(memory);
  }
  if(path==='/api/library') {
    if(method==='GET')return json({items:records.filter(e=>['character','preset'].includes(e.kind)&&e.payload.document).map(e=>libraryView(e))});
    const d=PortableDocumentSchema.parse(body);if(d.nsfw)throw fail('Adult verification required',403);
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
          if(!/^[a-f0-9]{64}$/.test(asset.asset_id))throw fail('Invalid asset identity');
          const stored=await getMeta<ExportAsset>('asset:'+owner+':'+asset.asset_id);
          if(!stored||!(stored.raw instanceof Uint8Array)||typeof stored.mime!=='string')throw fail('Missing asset bytes; export cannot preserve the document',409);
          if(contentHash(stored.raw)!==asset.asset_id)throw fail('Stored asset checksum mismatch',409);
          assets.set(asset.asset_id,stored);
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
    let text=body.text,filename=typeof body.filename==='string'?body.filename:'character.txt',raw:Uint8Array|undefined;
    if(init.body instanceof FormData){const file=init.body.get('file');if(!(file instanceof File)||file.size>32*1024*1024)throw fail('Choose a file up to 32 MiB');raw=new Uint8Array(await file.arrayBuffer());text=new TextDecoder('utf-8',{fatal:true}).decode(raw);filename=file.name;}
    if(typeof text!=='string'||text.length>32*1024*1024)throw fail('Invalid import');
    const parsed=JSON.parse(text),d=PortableDocumentSchema.parse(parsed.spec?{name:parsed.data?.name??'Character',data:parsed.data}:parsed);
    if(d.nsfw)throw fail('Adult verification required',403);
    raw??=encoder.encode(text);
    const preview_id=crypto.randomUUID(),preview={preview_id,filename,source_hash:contentHash(raw),documents:[d],duplicates:{}};
    if(owner!==deviceOwner())throw fail('Account changed',409);
    await setMeta('preview:'+owner+':'+preview_id,{...preview,original:{filename,raw}});return json(preview);
  }
  const commit=path.match(/^\/api\/imports\/([^/]+)\/commit$/);
  if(commit){if(method!=='POST')throw fail('Import requires POST',405);return json(await commitDeviceImport(owner,commit[1],body,records));}
  if(path==='/api/prompts/presets') {
    if(method==='GET')return json({presets:records.filter(e=>e.kind==='preset'&&e.payload.content).map(e=>({id:e.id,...e.payload}))});
    if(typeof body.content!=='string'||body.content.length>128000||typeof body.name!=='string')throw fail('Invalid preset');
    const e=await saveEntity(newEntity('preset',crypto.randomUUID(),{...body,storage_policy:'local',nsfw:false},owner));return json({id:e.id,...e.payload});
  }
  if(path.startsWith('/api/prompts/presets/')) {
    const e=await entity(path.split('/').at(-1)!);if(!e)throw fail('Preset not found',404);
    if(method==='DELETE'){await saveEntity({...e,deleted:true},e.revision);return json({ok:true});}
    if(typeof body.content!=='string'||body.content.length>128000)throw fail('Invalid preset');
    const saved=await saveEntity({...e,payload:{...e.payload,...body}},e.revision);return json({id:e.id,...saved.payload});
  }
  if(path==='/api/scenarios')return json({scenarios:catalog.scenarios.map(s=>({...s,turns:s.turns.length}))});
  if(path==='/api/experiments')return json({experiments:[]});
  if(path.startsWith('/api/local/cloud'))return json({mode:'off',selected:[],connected:false,origin:location.origin,revision:0});
  if(path==='/api/remote/status')return json({installed:false,connected:false});
  throw fail('This operation is not yet implemented by the browser runtime: '+path,501);
}
