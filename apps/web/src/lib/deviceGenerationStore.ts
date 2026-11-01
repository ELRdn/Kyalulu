import { appTransaction } from './appStore';
import { deviceOwner } from './appContext';
import { jsonChunks, SYNC_INLINE_BYTES } from './appTransfers';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';
import { guardStorage, storageStep } from './segmentedStorage';
import { isGenerationHeader, validateGenerationHeader, generationKey as key, generationLocation as location,
  generationFingerprint as fingerprint, assertGenerationOwner as current, type GenerationHeader, type GenerationHolder, type Section } from './deviceGenerationRecords';
export { isGenerationHeader, validateGenerationHeader, generationSummary, writeGenerationReceipt, deleteGenerationReceipt,
  eraseGenerationMemoryReferences, preserveLegacyGeneration, type GenerationHeader, type GenerationHolder } from './deviceGenerationRecords';
type Value=Record<string,any>;
const object=(value:any):value is Value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export async function readGenerationHeader(owner:string,holder:GenerationHolder,id:string) {
  current(owner);
  const value=await appTransaction<GenerationHeader|Value|undefined>(['meta'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const request=tx.objectStore('meta').get(key(owner,id));request.onsuccess=()=>storageStep(tx,()=>{
      const value=request.result;
      if(isGenerationHeader(value))validateGenerationHeader(value,owner,holder,id);
      else if(value!==undefined&&(!object(value)||value.generation_id!==id||value.session_id!==(holder.kind==='research'?'exp:'+holder.id:holder.id)))throw Error('Generation scope changed');
      done(value);
    });
  });current(owner);return value;
}
async function verifyCatalog(header:GenerationHeader,signal?:AbortSignal) {
  current(header.owner,signal);
  const latest=await readGenerationHeader(header.owner,header.holder,header.generation_id);current(header.owner,signal);
  if(!isGenerationHeader(latest)||latest.catalog_sha256!==header.catalog_sha256)throw Error('Generation changed during export');
}

/** Every read pins the catalog; corrupt/missing tails error before a consumer can accept EOF. */
async function* partChunks(header:GenerationHeader,name:Section,signal?:AbortSignal):AsyncGenerator<Uint8Array> {
  const part=header.sections[name];if(!part)throw Error('Missing generation section');
  const digest=new Sha256(),parser=new JsonStream({validateOnly:true});let size=0;
  for(let index=0;index<part.chunks;index++){
    current(header.owner,signal);
    const bytes=await appTransaction<Uint8Array>(['meta','parts'],'readonly',(tx,done)=>{
      guardStorage(tx,()=>header.owner===deviceOwner()&&!signal?.aborted);
      const read=tx.objectStore('meta').get(key(header.owner,header.generation_id));read.onsuccess=()=>storageStep(tx,()=>{
        validateGenerationHeader(read.result,header.owner,header.holder,header.generation_id);
        if(read.result.catalog_sha256!==header.catalog_sha256)throw Error('Generation changed during export');
        const request=tx.objectStore('parts').get([...location(header.owner,header.generation_id),part.token,index]);
        request.onsuccess=()=>storageStep(tx,()=>{
          const bytes=request.result;
          if(!(bytes instanceof Uint8Array)||bytes.length!==Math.min(1024*1024,part.size-size))throw Error('Missing or corrupt generation section');
          done(bytes);
        });
      });
    });
    current(header.owner,signal);
    if(size===0&&bytes[0]===239&&bytes[1]===187&&bytes[2]===191)throw Error('Unexpected byte order mark in generation section');
    digest.update(bytes);parser.feed(bytes);size+=bytes.length;yield bytes;
  }
  if(size!==part.size||digest.digest()!==part.sha256)throw Error('Generation section checksum mismatch');
  parser.finish();
  await verifyCatalog(header,signal);
}
const encode=(text:string)=>new TextEncoder().encode(text);
function* quotedContent(text:string) {
  const chunks=jsonChunks(text);let first=true,part=chunks.next();
  while(!part.done){
    const next=chunks.next();yield part.value.subarray(first?1:0,part.value.length-(next.done?1:0));
    first=false;part=next;
  }
}
/** Object sections were produced by jsonChunks; verify the braces while copying their bytes. */
async function* openObject(header:GenerationHeader,name:Section,signal?:AbortSignal) {
  const ref=header.sections[name]!;let size=0;
  for await(const bytes of partChunks(header,name,signal)){
    if(size===0&&bytes[0]!==123||size+bytes.length===ref.size&&bytes.at(-1)!==125)throw Error('Invalid generation object section');
    size+=bytes.length;yield size===ref.size?bytes.subarray(0,bytes.length-1):bytes;
  }
}
export async function* generationReceiptChunks(owner:string,holder:GenerationHolder,id:string,signal?:AbortSignal):AsyncGenerator<Uint8Array> {
  const header=await readGenerationHeader(owner,holder,id);current(owner,signal);
  if(!header)throw Error('Generation unavailable');
  if(!isGenerationHeader(header)){
    const expected=fingerprint(header);
    for(const bytes of jsonChunks(header)){current(owner,signal);yield bytes;}
    current(owner,signal);const latest=await readGenerationHeader(owner,holder,id);current(owner,signal);
    if(!latest||fingerprint(latest)!==expected)throw Error('Generation changed during export');return;
  }
  yield* openObject(header,'receipt',signal);
  for(const name of ['prompt','compiled','memory','attempts'] as Section[]){
    if(!header.sections[name]||name==='memory'&&!header.top_memory)continue;
    yield encode(','+JSON.stringify(name==='prompt'?'raw_prompt':name)+':');
    if(name!=='prompt'||header.prompt_encoding==='json-string'){yield* partChunks(header,name,signal);continue;}
    yield encode('"');const decoder=new TextDecoder('utf-8',{fatal:true});
    for await(const bytes of partChunks(header,name,signal))yield* quotedContent(decoder.decode(bytes,{stream:true}));
    yield* quotedContent(decoder.decode());yield encode('"');
  }
  if(header.sections.telemetry){
    yield encode(',"telemetry":');yield* openObject(header,'telemetry',signal);
    if(header.telemetry_memory){
      yield encode((header.sections.telemetry.size>2?',':'')+'"memory":');
      yield* partChunks(header,header.sections.telemetryMemory?'telemetryMemory':'memory',signal);
    }
    yield encode('}');
  }
  current(owner,signal);yield encode('}');
  await verifyCatalog(header,signal);
}

export type GenerationDiagnosticRead={state:'inline';value:Value;bytes:number;sha256:string}|{state:'stored';bytes:number;sha256:string};
/** The boundary applies to the entire expanded JSON, including the compatibility trace alias. */
export async function readGenerationReceipt(owner:string,holder:GenerationHolder,id:string,signal?:AbortSignal):Promise<GenerationDiagnosticRead> {
  let parser:JsonStream|undefined=new JsonStream(),size=0;const digest=new Sha256();
  for await(const bytes of generationReceiptChunks(owner,holder,id,signal)){
    size+=bytes.length;digest.update(bytes);
    if(size>SYNC_INLINE_BYTES)parser=undefined;
    parser?.feed(bytes);
  }
  current(owner,signal);const sha256=digest.digest();
  if(!parser)return {state:'stored',bytes:size,sha256};
  const value=parser.finish();if(!object(value))throw Error('Invalid generation body');
  return {state:'inline',value,bytes:size,sha256};
}

/** Replay reads the saved portable snapshot, without retaining compiled history or raw prompts. */
export async function readGenerationSnapshot(owner:string,holder:GenerationHolder,id:string,signal?:AbortSignal):Promise<Value> {
  const header=await readGenerationHeader(owner,holder,id);current(owner,signal);
  let snapshot:unknown;
  if(isGenerationHeader(header)){
    if(!header.sections.compiled)throw Error('Saved generation compiler unavailable');
    const parser=new JsonStream({portableSnapshot:true});
    for await(const bytes of partChunks(header,'compiled',signal))parser.feed(bytes);
    snapshot=parser.finish()?.sections?.portable_snapshot;
  }else snapshot=header?.compiled?.sections?.portable_snapshot;
  current(owner,signal);if(!object(snapshot))throw Error('Saved portable snapshot unavailable');return snapshot;
}
