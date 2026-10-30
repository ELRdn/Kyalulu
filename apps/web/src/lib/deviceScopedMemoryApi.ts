import { allEntities,entity,type AppEntity } from './appStore';
import { readDeviceMemoryDomain,readMemorySource,memoryScopeInput } from './deviceMemoryStore';
import { appendScopeEvent,bindMemoryScope,memoryBinding,memoryPolicy,migrateMemoryDomain,previewMemoryMigration,type ScopeEvent } from './deviceMemoryScopes';
import { deviceMemoryScope,parseDeviceMemoryScope,scopedSessionMemory,scopedMigrationMemory,scopedMemoryAddress,scopedMemoryRows,saveScopedMemory,type MemoryIdentityResolver,type ScopedMemory } from './deviceScopedMemory';
import { retrieveMemories,renderMemoryBlock,type DeviceMemory } from './deviceCore';

const fail=(message:string,status=400)=>Object.assign(Error(message),{status});
const json=(value:unknown)=>Response.json(value);
const address=(context:ScopedMemory)=>deviceMemoryScope(context.policy,context.scope);
const rowView=(context:ScopedMemory,memory:DeviceMemory)=>({...memory,scope:address(context)});
const eventView=(context:ScopedMemory,event:ScopeEvent)=>({...event,scope:address(context)});
const marked=(session:AppEntity)=>['world','shared'].includes(session.payload.memory_scope_mode);
function editable(context:ScopedMemory){
  if(context.domain.pending||[...context.records.values()].some(s=>s.metadata.pending_generation))throw fail('Stop generation before editing',409);
}
function visibleEvents(context:ScopedMemory){
  const ids=new Set(scopedMemoryRows(context).map(m=>m.id));
  return context.domain.pools[context.scope].events.filter(e=>e.source_session_id!=null
    ?context.records.has(e.source_session_id):e.memory_id===null||ids.has(e.memory_id));
}

/** Called under the owner's execution lease for mutations; legacy routes remain authoritative for raw scopes. */
export async function scopedMemoryRoute(path:string,method:string,body:Record<string,any>,url:URL,owner:string,
  conversation:(id:string,owner:string)=>Promise<AppEntity>,resolve:MemoryIdentityResolver):Promise<Response|null>{
  if(!/^\/api\/memory(?:\/|$)/.test(path))return null;
  const sessionPath=path.match(/^\/api\/memory\/session\/([^/]+)(\/data|\/scope-preview|\/scope-migrate)?$/);
  if(sessionPath){
    const suffix=sessionPath[2];
    if(!(suffix==='/data'?method==='DELETE':suffix==='/scope-preview'?method==='GET':suffix==='/scope-migrate'?method==='POST':['GET','PUT'].includes(method)))
      throw fail('Invalid memory operation',405);
    const session=await conversation(sessionPath[1],owner);
    if(suffix==='/scope-preview'||suffix==='/scope-migrate'){
      if(session.payload.branch_of||session.payload.recovery_from)throw fail('Branch and recovery memories must remain independent',409);
      const {context,identity}=await scopedMigrationMemory(session,resolve),preview=previewMemoryMigration(context.domain,session,identity);
      if(suffix==='/scope-preview'){
        const eligible=new Set(scopedMemoryRows(context).map(m=>m.id));
        return json({...preview,scope:address(context),target_scope:deviceMemoryScope(context.policy,preview.target_scope),
          memories:preview.memories.filter(m=>eligible.has(m.id)).map(m=>rowView(context,m))});
      }
      if(typeof body.expected_revision!=='string'||!body.expected_revision||body.share!==undefined&&typeof body.share!=='boolean')throw fail('Invalid memory migration');
      editable(context);
      const eligible=new Set(scopedMemoryRows(context).map(m=>m.id));
      if(preview.memories.some(m=>!eligible.has(m.id)))throw fail('Unavailable source memories cannot be migrated',409);
      const result=migrateMemoryDomain(context.domain,session,identity,body.expected_revision,body.share??false);
      context.scope=result.scope;
      const updated={...session,payload:{...session.payload,memory_scope_mode:body.share?'shared':'world'}};
      await saveScopedMemory(context,[updated]);
      return json({...result,scope:address(context)});
    }
    const domain=await readDeviceMemoryDomain(owner,memoryPolicy(session)),binding=memoryBinding(domain,session.id);
    if(!marked(session)&&!binding)return null;
    if(!binding&&method==='GET')return json({session_id:session.id,scope:session.id,enabled:session.payload.memory_enabled===true});
    if(method==='PUT'&&typeof body.enabled!=='boolean')throw fail('Choose whether memory is enabled');
    const context=await scopedSessionMemory(session,resolve,method==='GET');
    if(method==='GET')return json({session_id:session.id,scope:address(context),enabled:session.payload.memory_enabled===true});
    editable(context);
    if(suffix==='/data'){
      // Authored before/after snapshots remain intact; clear only live projections and pool audit history.
      const pool=context.domain.pools[context.scope];pool.memories=[];pool.holders={};pool.events=[];
      await saveScopedMemory(context);
      return json({ok:true,scope:address(context),affects_shared_sessions:[...context.records.values()].some(s=>s.id!==session.id&&memoryBinding(context.domain,s.id)?.scope===context.scope)});
    }
    await saveScopedMemory(context,[{...session,payload:{...session.payload,memory_enabled:body.enabled}}]);
    return json({session_id:session.id,scope:address(context),enabled:body.enabled});
  }
  if(path==='/api/memory/scopes'){
    if(method!=='GET')throw fail('Memory scopes require GET',405);
    const domains=await Promise.all((['local','sync'] as const).map(policy=>readDeviceMemoryDomain(owner,policy)));
    if(domains.every(d=>Object.keys(d.pools).length===0))return null;
    const scopes:{scope:string;active:number;total:number;updated_at:string|null}[]=[];
    const add=(scope:string,rows:DeviceMemory[])=>{
      if(rows.length)scopes.push({scope,active:rows.filter(m=>m.status==='active').length,total:rows.length,updated_at:rows.map(m=>m.updated_at??'').sort().at(-1)||null});
    };
    for(const domain of domains)for(const scope of Object.keys(domain.pools)){
      const context=await scopedMemoryAddress(owner,deviceMemoryScope(domain.policy,scope),resolve,true);
      add(address(context),scopedMemoryRows(context));
    }
    for(const session of await allEntities(owner))if(session.kind==='conversation'&&!session.deleted&&!session.payload.cache_evicted
      &&!memoryBinding(domains.find(d=>d.policy===memoryPolicy(session))!,session.id))add(session.id,session.payload.memories??[]);
    return json({scopes:scopes.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))});
  }
  if(path==='/api/memory/events'){
    if(method!=='GET')throw fail('Memory events require GET',405);
    const scope=url.searchParams.get('scope'),limit=Number(url.searchParams.get('limit')??200);
    if(!scope||!Number.isInteger(limit))throw fail('Choose a memory scope and integer limit');
    if(!parseDeviceMemoryScope(scope))return null;
    const context=await scopedMemoryAddress(owner,scope,resolve,true);
    return json({events:visibleEvents(context).slice().reverse().slice(0,Math.min(Math.max(limit,1),1000)).map(e=>eventView(context,e))});
  }
  if(path==='/api/memory/search'){
    if(method!=='POST')throw fail('Memory search requires POST',405);
    if(typeof body.scope!=='string'||!body.scope||typeof body.query!=='string'||Array.from(body.query).length>4000
      ||body.top_k!==undefined&&(!Number.isInteger(body.top_k)||body.top_k<1||body.top_k>20)
      ||body.budget_tokens!==undefined&&(!Number.isInteger(body.budget_tokens)||body.budget_tokens<20||body.budget_tokens>4000))throw fail('Invalid memory search');
    if(!parseDeviceMemoryScope(body.scope))return null;
    const context=await scopedMemoryAddress(owner,body.scope,resolve,true),started=performance.now(),rows=scopedMemoryRows(context).map(m=>rowView(context,m));
    const trace=retrieveMemories(rows,body.query,{top_k:body.top_k??5,budget_tokens:body.budget_tokens??300});
    return json({...trace,scope:address(context),stored_count:rows.filter(m=>m.status==='active').length,
      retrieval_ms:Math.round((performance.now()-started)*100)/100,block:renderMemoryBlock(trace.injected.map(id=>trace.candidates.find(m=>m.id===id)!))});
  }
  const memoryPath=path.match(/^\/api\/memory(?:\/([^/]+))?$/);if(!memoryPath)return null;
  const memoryId=memoryPath[1];
  if(!(memoryId?['GET','PATCH','PUT','DELETE'].includes(method):['GET','POST'].includes(method)))throw fail('Invalid memory operation',405);
  if(!memoryId&&method==='POST'&&(typeof body.scope!=='string'||!body.scope.trim()||Array.from(body.scope).length>300))throw fail('Choose a memory scope');
  let context:ScopedMemory;
  if(memoryId){
    const matches:{policy:'local'|'sync';scope:string}[]=[];
    for(const policy of ['local','sync'] as const){
      const domain=await readDeviceMemoryDomain(owner,policy);
      for(const [scope,pool] of Object.entries(domain.pools))if(pool.memories.some(m=>m.id===memoryId))matches.push({policy,scope});
    }
    if(!matches.length)return null;
    if(matches.length>1)throw fail('Memory identity is ambiguous; use a separate conversation copy',409);
    context=await scopedMemoryAddress(owner,deviceMemoryScope(matches[0].policy,matches[0].scope),resolve,method==='GET');
  }else{
    const scope=body.scope??url.searchParams.get('scope');if(typeof scope!=='string'||!parseDeviceMemoryScope(scope))return null;
    context=await scopedMemoryAddress(owner,scope,resolve,method==='GET');
  }
  const rows=scopedMemoryRows(context),previous=rows.find(m=>m.id===memoryId);
  if(memoryId&&!previous)throw fail('Memory not found',404);
  if(method==='GET')return json(previous?{...rowView(context,previous),events:visibleEvents(context).filter(e=>e.memory_id===memoryId).reverse().slice(0,200).map(e=>eventView(context,e))}
    :{scope:address(context),memories:rows.filter(m=>url.searchParams.get('include_deleted')==='true'||m.status==='active').map(m=>rowView(context,m))});
  editable(context);
  if(previous&&previous.status!=='active')throw fail('Memory not found',404);
  if(!previous&&body.source_session_id!=null){
    const sid=body.source_session_id;
    if(typeof sid!=='string'||!sid||Array.from(sid).length>300)throw fail('Invalid memory source');
    const source=await readMemorySource(sid,owner);
    if(!source||source.owner!==owner)throw fail('Memory source session not found',404);
    if(memoryPolicy(memoryScopeInput(source))!==context.policy||source.metadata.cache_evicted)throw fail('Memory source is unavailable in this storage policy',409);
    if(source.metadata.pending_generation)throw fail('Stop generation before editing',409);
    const binding=bindMemoryScope(context.domain,memoryScopeInput(source),await resolve(source.metadata.settings));
    if(binding.scope!==context.scope)throw fail('Memory source does not match this scope',409);
    context.records.set(sid,source);
  }
  const content=body.content==null?previous?.content:typeof body.content==='string'?body.content.trim().replace(/\s+/gu,' '):undefined;
  const type=body.type??previous?.type;
  if(method!=='DELETE'&&(!content||Array.from(content).length>200))throw fail('Memory must have 1-200 characters');
  if(method!=='DELETE'&&!['semantic','episodic','relationship'].includes(type))throw fail('Invalid memory type');
  if(!previous&&(body.source_kind!==undefined&&!['user_statement','user_correction','work_setting','story_event'].includes(body.source_kind)
    ||body.source_quote!==undefined&&(typeof body.source_quote!=='string'||Array.from(body.source_quote).length>2000)
    ||body.source_revision!=null&&(typeof body.source_revision!=='string'||Array.from(body.source_revision).length>128)))throw fail('Invalid memory source');
  if(previous&&method!=='DELETE'&&previous.content===content&&previous.type===type)return json(rowView(context,previous));
  const now=new Date().toISOString(),pool=context.domain.pools[context.scope];
  const memory:DeviceMemory=previous?(method==='DELETE'?{...previous,status:'deleted',updated_at:now}:{...previous,content:content!,type,version:(previous.version??1)+1,
    origin:previous.origin==='model'?'model_edited':previous.origin,supported:null,source_kind:'user_correction',source_quote:content,
    source_revision:'manual:'+((previous.version??1)+1),confirmation:'user_confirmed',updated_at:now})
    :{id:crypto.randomUUID(),scope:context.scope,type,content:content!,version:1,status:'active',origin:'user',supported:null,source_session_id:body.source_session_id??null,
      source_turn:null,source_generation_id:null,source_kind:body.source_kind??'user_statement',source_quote:body.source_quote||content,
      source_revision:body.source_revision||'manual:1',source_message_ids:[],confirmation:'user_confirmed',created_at:now,updated_at:now,access_count:0,last_accessed:null};
  if(previous)pool.memories=pool.memories.map(m=>m.id===memoryId?memory:m);
  else {pool.memories.push(memory);pool.holders[JSON.stringify(memory.id)]=body.source_session_id??null;}
  appendScopeEvent(pool,context.scope,previous?(method==='DELETE'?'delete':'update'):'create',memory.id,null,
    previous?(method==='DELETE'?{content:previous.content}:{before:{content:previous.content,type:previous.type,version:previous.version},after:{content,type}}):{type,content,origin:'user'},now);
  await saveScopedMemory(context);
  return json(rowView(context,memory));
}
