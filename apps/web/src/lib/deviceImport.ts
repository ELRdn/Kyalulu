import { ImportCommitSchema, PortableDocumentSchema, RuntimeStateSchema, LibraryBindingSchema, ConversationSettingsSchema } from '../../../../packages/schemas/src';
import { appTransaction, getMeta, newEntity, type AppEntity } from './appStore';
import { deviceOwner } from './appContext';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import { validateDeviceDocumentAssets } from './deviceAssets';

const conflict=(message:string)=>Object.assign(Error(message),{status:409});
const hash=(raw:Uint8Array)=>new Sha256().update(raw).digest();

/** Source bytes, selected versions, histories and replay receipt commit together. */
export async function commitDeviceImport(owner:string,previewId:string,input:unknown,records:AppEntity[]) {
  const body=ImportCommitSchema.parse(input),key='import:'+owner+':'+body.request_id;
  const fingerprint=hash(new TextEncoder().encode(canonical({preview_id:previewId,...body})));
  const previous=await getMeta<any>(key);
  if(owner!==deviceOwner())throw conflict('Account changed');
  if(previous){
    if(previous.request_fingerprint!==fingerprint)throw conflict('Import request already used; reload the Library before importing again');
    return {items:previous.items,sessions:previous.sessions};
  }
  const preview=await getMeta<any>('preview:'+owner+':'+previewId);
  if(!preview)throw Object.assign(Error('Preview not found'),{status:404});
  if(new Set(body.selections.map(selection=>selection.index)).size!==body.selections.length)throw Error('Duplicate selection');
  if(preview.original&&(!(preview.original.raw instanceof Uint8Array)||hash(preview.original.raw)!==preview.source_hash))throw conflict('Import original checksum mismatch');
  const updates:{value:AppEntity;base?:AppEntity}[]=[],items:any[]=[],sessions:any[]=[];
  const targets=new Set<string>();
  for(const selection of body.selections){
    if(selection.index>=preview.documents.length)throw Error('Invalid selection');
    const source=PortableDocumentSchema.parse(preview.documents[selection.index]),doc=structuredClone(selection.document);
    if(source.nsfw||doc.nsfw)throw Object.assign(Error('Adult verification required'),{status:403});
    await validateDeviceDocumentAssets(doc,owner);
    if(!doc.name.trim())throw Error('Name is required');
    if(selection.history_indices.some(index=>index>=source.histories.length)||selection.history_indices.length&&doc.kind!=='character')throw Error('Invalid history selection');
    doc.source=source.source;doc.source_format=source.source_format;doc.notices=source.notices;
    doc.histories=[...new Set(selection.history_indices)].sort((a,b)=>a-b).map(index=>source.histories[index]);
    delete doc.data.official;doc.data.name=doc.name;
    const base=selection.target_id?records.find(record=>record.owner===owner&&record.id===selection.target_id):undefined;
    if(selection.target_id&&(!base||base.deleted||!base.payload.document||base.payload.snapshot_only||(base.payload.current_revision??base.revision)!==selection.expected_revision))throw conflict('Library changed; reload before updating');
    const id=base?.id??crypto.randomUUID(),revision=base?(base.payload.current_revision??base.revision)+1:1;
    if(targets.has(id)||base?.payload.versions?.[revision])throw conflict('Library revision already exists');targets.add(id);
    const original_id=preview.original?preview.source_hash:null;
    const payload={...base?.payload,storage_policy:base?.payload.storage_policy??'local',document:doc,original_id,current_revision:revision,versions:{...base?.payload.versions,[revision]:doc}};
    const value={...(base??newEntity(doc.kind==='character'?'character':'preset',id,payload,owner)),payload,revision:(base?.revision??0)+1,dirty:payload.storage_policy==='sync',opened:Date.now()};
    updates.push({value,base});items.push({id,revision,document:doc,original_id});
    for(const index of [...new Set(selection.history_indices)].sort((a,b)=>a-b)){
      const history=source.histories[index],sid=crypto.randomUUID();
      const settings=ConversationSettingsSchema.parse({session_id:sid,character_id:id,library_binding:LibraryBindingSchema.parse({character:{id,revision}}),
        intro:doc.data.first_mes??'',temperature:doc.profile.settings.temperature??.8});
      const messages=history.messages.map(message=>{
        if(typeof message.role!=='string'||!['user','assistant'].includes(message.role)||typeof message.content!=='string'||Array.from(message.content).length>128000
          ||message.created_at!=null&&typeof message.created_at!=='string')throw Error('Unsupported imported history message');
        return {id:0,uuid:crypto.randomUUID(),revision:1,role:message.role,content:message.content,model_id:'imported',created_at:message.created_at??new Date().toISOString(),
          imported_from:{...message,original_id,history_index:index,format:'portable'}};
      });
      const conversation=newEntity('conversation',sid,{storage_policy:'local',rating:'general',title:history.name,settings,messages,memories:[],summaries:[],
        state:RuntimeStateSchema.parse({session_id:sid}),memory_enabled:false},owner);
      updates.push({value:{...conversation,revision:1}});sessions.push({session_id:sid,name:history.name,character_id:id});
    }
  }
  let failure:unknown;
  try{return await appTransaction<any>(['entities','meta'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),store=tx.objectStore('entities'),read=meta.get(key);
    const abort=(error:unknown)=>{failure=error;tx.abort();};
    read.onsuccess=()=>{
      if(owner!==deviceOwner()){abort(conflict('Account changed'));return;}
      const receipt=read.result;
      if(receipt){if(receipt.request_fingerprint!==fingerprint)abort(conflict('Import request already used'));else done({items:receipt.items,sessions:receipt.sessions});return;}
      let pending=updates.length;
      for(const update of updates){
        const current=store.get([owner,update.value.id]);current.onsuccess=()=>{
          if(owner!==deviceOwner()||(current.result?.revision??0)!==(update.base?.revision??0)){abort(conflict('Library changed; reload before updating'));return;}
          if(--pending)return;
          const sequence=meta.get('message-sequence:'+owner);sequence.onsuccess=()=>{
            try{
              if(owner!==deviceOwner())throw conflict('Account changed');
              let number=sequence.result??0;
              if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid message sequence');
              for(const record of records)for(const message of record.payload.messages??[]){
                if(!Number.isSafeInteger(message.id)||message.id<1)throw Error('Invalid stored message ID');
                number=Math.max(number,message.id);
              }
              for(const {value} of updates){
                if(value.kind==='conversation')for(const message of value.payload.messages){if(!Number.isSafeInteger(++number))throw Error('Message ID limit reached');message.id=number;}
                store.put(value);
              }
              meta.put(number,'message-sequence:'+owner);
              if(preview.original)meta.put(preview.original,'original:'+owner+':'+preview.source_hash);
              const result={items,sessions};meta.put({...result,request_fingerprint:fingerprint},key);done(result);
            }catch(error){abort(error);}
          };
        };
      }
    };
  });}catch(error){throw failure??error;}
}
