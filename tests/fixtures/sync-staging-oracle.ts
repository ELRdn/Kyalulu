// Frozen baseline 21ba2fa appSyncData.ts; source SHA256 8a1e01c6a6c6731ff35eee201695fa1190a1cb1e78779a0f0703438240916528
import { PortableDocumentSchema, RuntimeStateSchema, CreatorDocumentSchema, ConversationSettingsSchema } from '../../packages/schemas/src/index.ts';
type AppEntity=any;

function removeLocalGenerationDiagnostics(payload:AppEntity['payload']) {
  const generation=payload.last_generation;
  if(generation){
    for(const key of ['raw_prompt','compiled','attempts','memory','execution_lock'])delete generation[key];
    if(generation.validation)generation.validation.errors=[];
    if(generation.telemetry)delete generation.telemetry.memory;
  }
}

export function conversationBinder(payload:AppEntity['payload'],id:string) {
  const sourceIds=new Set([payload.settings?.session_id??payload.state?.session_id,payload.branch_of,payload.recovery_from].filter(value=>typeof value==='string'&&value!==id));
  return (snapshot:any)=>{
    if(snapshot?.settings)snapshot.settings.session_id=id;
    if(snapshot?.state)snapshot.state.session_id=id;
    for(const memory of snapshot?.memories??[]) {
      if(memory.scope)memory.scope=id;
      if(sourceIds.has(memory.source_session_id)){
        memory.original_source_session_id??=memory.source_session_id;memory.source_session_id=id;
      }
    }
  };
}
export function rebindConversation(payload: AppEntity['payload'], id: string) {
  const result=structuredClone(payload),bind=conversationBinder(result,id);
  bind(result);
  for(const message of result.messages??[]){bind(message.before);bind(message.after);}
  return result;
}

/** Numeric IDs belong to this device; UUIDs retain identity across sync and branches. */
export function receiveConversation(payload: AppEntity['payload'], previous: AppEntity['payload'] | undefined,
  allocate: () => number) {
  const result=structuredClone(payload);
  if(!Array.isArray(result.messages))throw Error('Invalid conversation');
  const receive=conversationReceiver(result,result.messages,previous,allocate);
  for(const [index,message] of result.messages.entries())receive(message,index);
  return result;
}

/** Mutates owned metadata and one message at a time after a complete identity scan. */
export function conversationReceiver(result:AppEntity['payload'],identity:readonly {id:number;uuid:string}[],
  previous:AppEntity['payload']|undefined,allocate:()=>number) {
  const ids=new Map<number,number>(),uuids=new Set<string>();
  if(result.pending_generation!=null)result.pending_generation=null;
  if(!Array.isArray(result.memories)||!Array.isArray(result.summaries))throw Error('Invalid conversation');
  result.state=RuntimeStateSchema.parse(result.state);
  const oldMessages=new Map((previous?.messages??[]).map((m:any)=>[m.uuid,m.id]));
  for(const message of identity){
    if(!Number.isSafeInteger(message.id)||message.id<1||ids.has(message.id)||typeof message.uuid!=='string'||!message.uuid||uuids.has(message.uuid))throw Error('Invalid message identity');
    uuids.add(message.uuid);const id=oldMessages.get(message.uuid) as number|undefined??allocate();
    if(!Number.isSafeInteger(id)||id<1)throw Error('Message ID limit reached');ids.set(message.id,id);
  }
  const sources = (items: any[]) => {
    for (const item of items) if (item.source_message_ids) item.source_message_ids = item.source_message_ids.map((id: number) => {
      if (!ids.has(id)) throw Error('Missing message source');
      return ids.get(id)!;
    });
  };
  const oldMemories = new Map((previous?.memories ?? []).map((m: any) => [m.uuid ?? m.id, m.id]));
  const memories = new Map<string, string>();
  const visited = new WeakSet<object>();
  const bindMemories = (items: any[]) => {
    for (const memory of items) {
      if (visited.has(memory)) continue;
      visited.add(memory); sources([memory]);
      const stable = memory.uuid ?? memory.id;
      if (typeof stable !== 'string' || !stable) throw Error('Invalid memory identity');
      if (!memories.has(stable)) memories.set(stable, oldMemories.get(stable) as string | undefined ?? crypto.randomUUID());
      memory.uuid = stable; memory.id = memories.get(stable);
    }
  };
  if (new Set(result.memories.map((m: any) => m.uuid ?? m.id)).size !== result.memories.length) throw Error('Duplicate memory identity');
  bindMemories(result.memories); sources(result.summaries);
  for (const summary of result.summaries) if (summary.method === 'extractive') {
    summary.text = summary.text.replace(/\[(\d+):/g, (match: string, id: string) => ids.has(Number(id)) ? `[${ids.get(Number(id))}:` : match);
  }
  const positions=new Map<number,number>(identity.map((message,index)=>[ids.get(message.id)!,index]));
  if (result.last_generation) for (const key of ['user_id','assistant_id']) {
    const id = result.last_generation[key];
    if (id != null) { if (!ids.has(id)) throw Error('Missing generation message'); result.last_generation[key] = ids.get(id); }
  }
  removeLocalGenerationDiagnostics(result);
  return (message:any,index:number)=>{
    if(message?.id!==identity[index]?.id||message?.uuid!==identity[index]?.uuid
      ||!['user','assistant','system'].includes(message.role)||typeof message.content!=='string')throw Error('Invalid message identity');
    message.id=ids.get(message.id)!;
    if(message.before==null&&message.after==null)return message;
    if(message.role!=='assistant'||!message.before||!message.after)throw Error('Invalid historical snapshot');
    for(const [name,snapshot] of [['before',message.before],['after',message.after]] as const){
      if(!Array.isArray(snapshot.memories)||new Set(snapshot.memories.map((m:any)=>m.uuid??m.id)).size!==snapshot.memories.length)throw Error('Invalid historical memories');
      snapshot.state=RuntimeStateSchema.parse(snapshot.state);bindMemories(snapshot.memories);
      if(snapshot.settings!=null)snapshot.settings=ConversationSettingsSchema.parse(snapshot.settings);
      if(snapshot.memories.some((memory:any)=>{
        // A confirmed edit remains known when regenerating the turn that originally produced it.
        const correction=name==='before'&&memory.origin==='model_edited'&&memory.source_kind==='user_correction'
          &&memory.confirmation==='user_confirmed'&&Number.isSafeInteger(memory.version)&&memory.version>=1
          &&memory.source_turn===snapshot.state.turn+1;
        return (memory.source_message_ids??[]).some((id:number)=>(positions.get(id)??Infinity)>(name==='before'?index-1:index))
          ||memory.source_turn!=null&&memory.source_turn>snapshot.state.turn&&!correction;
      }))throw Error('Future historical memory source');
    }
    if(message.after.state.turn!==message.before.state.turn+1)throw Error('Invalid historical turn');
    return message;
  };
}

export function conversationSettings(payload:AppEntity['payload']):Record<string,any>[] {
  return [payload.settings??{},...(payload.messages??[]).flatMap((message:any)=>[message.before?.settings,message.after?.settings].filter(Boolean))];
}
export function withLibrarySnapshots(payload: AppEntity['payload'], records: AppEntity[]) {
  const result=structuredClone(payload),settings=conversationSettings(result);
  removeLocalGenerationDiagnostics(result);
  result.library_snapshots={};
  result.creator_snapshots={};
  for(const sourceSettings of [...settings,...(result.messages??[]).flatMap((message:any)=>[message.before?.state,message.after?.state].filter(Boolean))]){
    for(const kind of ['persona','world'] as const){
      const reference=sourceSettings[kind+'_id'],match=typeof reference==='string'?reference.match(/^(created_[0-9a-f]{32})@([1-9]\d*)$/):null;
      if(!match)continue;
      if(result.creator_snapshots[reference]){if(result.creator_snapshots[reference].kind!==kind)throw Error('Setting kind conflict');continue;}
      const source=records.find(e=>e.id===match[1]&&!e.deleted&&e.kind===kind),snapshot=source?.payload.versions?.[match[2]]??payload.creator_snapshots?.[reference]?.document;
      if(!snapshot)throw Error('Referenced setting revision is missing');
      result.creator_snapshots[reference]={kind,document:CreatorDocumentSchema.parse(snapshot)};
    }
  }
  for(const sourceSettings of settings){
    const binding=sourceSettings.library_binding??{};
    for(const [field,value] of Object.entries(binding))for(const ref of (field==='lorebooks'?value:[value]) as any[]) {
      if(!ref||typeof ref.id!=='string')continue;
      const key=ref.id+'@'+ref.revision;if(result.library_snapshots[key])continue;
      const library=records.find(e=>e.id===ref.id&&!e.deleted);
      const snapshot=library?.payload.versions?.[String(ref.revision)]??payload.library_snapshots?.[key];
      if(!snapshot)throw Error('Referenced library revision is missing');
      result.library_snapshots[key]=receiveLibrarySnapshot(undefined,'snapshot',ref.id,ref.revision,snapshot).payload.document;
    }
  }
  return result;
}

export function canonical(value: any): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function receiveCreatorSnapshot(previous:AppEntity|undefined,owner:string,reference:string,kind:'persona'|'world',snapshot:unknown):AppEntity {
  const match=reference.match(/^(created_[0-9a-f]{32})@([1-9]\d*)$/),document=CreatorDocumentSchema.parse(snapshot);
  if(!match||!Number.isSafeInteger(Number(match[2])))throw Error('Invalid setting reference');
  const id=match[1],revision=Number(match[2]);
  if(previous&&(previous.owner!==owner||previous.kind!==kind||previous.deleted||!previous.payload.creator))throw Error('Setting identity conflict');
  const stored=previous?.payload.versions?.[match[2]],current=previous?.payload.current_revision??0;
  if(stored&&canonical(stored)!==canonical(document))throw Error('Immutable setting revision conflict');
  const latest=previous&&!previous.payload.snapshot_only?current:Math.max(current,revision);
  return {id,owner,kind,revision:previous?(stored?previous.revision:previous.revision+1):1,serverRevision:previous?.serverRevision??0,deleted:false,dirty:previous?.dirty??false,pinned:previous?.pinned??false,opened:previous?.opened??0,
    payload:{...(previous?.payload??{storage_policy:'local',snapshot_only:true}),creator:latest===revision?document:previous!.payload.creator,
      current_revision:latest,versions:{...previous?.payload.versions,[revision]:document}}};
}

export function receiveLibrarySnapshot(previous: AppEntity | undefined, owner: string, id: string, revision: number, snapshot: unknown): AppEntity {
  const document = PortableDocumentSchema.parse(snapshot);
  if (!id || id.length > 200 || !Number.isSafeInteger(revision) || revision < 1 || document.nsfw || document.assets.length) throw Error('Unsupported library snapshot');
  if (previous && (previous.owner !== owner || previous.deleted || previous.kind !== (document.kind === 'character' ? 'character' : 'preset'))) throw Error('Library identity conflict');
  const current = previous?.payload.current_revision ?? previous?.revision ?? 0;
  const stored = previous?.payload.versions?.[String(revision)] ?? (current === revision ? previous?.payload.document : undefined);
  if (stored && canonical(PortableDocumentSchema.parse(stored)) !== canonical(document)) throw Error('Immutable library revision conflict');
  const latest = previous && !previous.payload.snapshot_only ? current : Math.max(current, revision);
  return {id, owner, kind: document.kind === 'character' ? 'character' : 'preset', revision: previous ? (stored?previous.revision:previous.revision+1) : 1,
    serverRevision: previous?.serverRevision ?? 0, deleted: false, dirty: previous?.dirty ?? false,
    pinned: previous?.pinned ?? false, opened: previous?.opened ?? Date.now(),
    payload: {...(previous?.payload ?? {storage_policy:'local', snapshot_only:true}), current_revision:latest,
      document: previous && (!previous.payload.snapshot_only || current > revision) ? previous.payload.document : document,
      versions: {...previous?.payload.versions, [String(revision)]:document}}};
}

// Pure equivalent of baseline prepareSyncBatch cursor selection; input bodies are independent fixture originals.
export function baselineChanges(rows:any[],owner:string) {
  const ordered=rows.filter(e=>e.owner===owner).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0),selected:any[]=[];
  for(const e of ordered) {
    const p=e.payload;
    if(e.dirty&&p.storage_policy==='sync'&&!p.pending_generation) {
      if(e.deleted){selected.length=0;selected.push(e);break;}
      if(selected.length<50)selected.push(e);
    }
  }
  return selected.map(e=>({id:e.id,kind:e.kind,base_revision:e.serverRevision,
    payload:e.deleted?{}:e.kind==='conversation'?withLibrarySnapshots(e.payload,ordered):e.payload,deleted:e.deleted,
    ...(e.deleted?{delete_confirmed:e.payload.delete_confirmation_revision===e.revision}:{})}));
}
