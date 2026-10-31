import { expect, it, vi } from 'vitest';
import { uploadSync, downloadEntity, jsonChunks } from './appTransfers';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';
import { encodeBytes, decodeBytes } from './remoteRpc';

const chunkBytes=1024*1024,transfer='11111111-1111-4111-8111-111111111111';
const hash=(raw:Uint8Array)=>new Sha256().update(raw).digest();

// Independent oracle frozen from e21f63b; do not coalesce its fragments.
function* legacyJsonText(value:any,ancestors=new Set<object>()):Generator<string> {
  if(typeof value==='string'){
    yield '"';
    for(let start=0;start<value.length;){
      let end=Math.min(start+4096,value.length);
      if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1])&&/[\uDC00-\uDFFF]/.test(value[end]))end--;
      yield JSON.stringify(value.slice(start,end)).slice(1,-1);start=end;
    }
    yield '"';return;
  }
  if(value===null||typeof value!=='object') {const text=JSON.stringify(value);if(text===undefined)throw Error('Invalid sync transfer');yield text;return;}
  if(ancestors.has(value)||ancestors.size>=64||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid sync transfer');
  ancestors.add(value);
  if(Array.isArray(value)){
    yield '[';
    for(let index=0;index<value.length;index++){if(index)yield ',';yield* legacyJsonText(['undefined','function','symbol'].includes(typeof value[index])?null:value[index],ancestors);}
    yield ']';
  }else{
    yield '{';let first=true;
    for(const key of Object.keys(value)){
      const item=value[key];if(['undefined','function','symbol'].includes(typeof item))continue;
      if(!first)yield ',';first=false;yield* legacyJsonText(key,ancestors);yield ':';yield* legacyJsonText(item,ancestors);
    }
    yield '}';
  }
  ancestors.delete(value);
}

function* legacyJsonChunks(value:unknown):Generator<Uint8Array> {
  const encoder=new TextEncoder();let buffer=new Uint8Array(chunkBytes),used=0;
  for(const text of legacyJsonText(value)){
    const raw=encoder.encode(text);let offset=0;
    while(offset<raw.length){
      const length=Math.min(raw.length-offset,chunkBytes-used);
      buffer.set(raw.subarray(offset,offset+length),used);offset+=length;used+=length;
      if(used===chunkBytes){yield buffer;buffer=new Uint8Array(chunkBytes);used=0;}
    }
  }
  if(used)yield buffer.subarray(0,used);
}
function expectLegacy(value:unknown,stringify=true) {
  const legacy=legacyJsonChunks(value),expected=stringify?new TextEncoder().encode(JSON.stringify(value)):undefined;
  const before=new Sha256(),after=new Sha256();let size=0,chunks=0;
  for(const part of jsonChunks(value)){
    const old=legacy.next();expect(old.done).toBe(false);
    expect(part.length).toBe(old.value!.length);
    expect(part.every((byte,index)=>byte===old.value![index])).toBe(true);
    expect(hash(part)).toBe(hash(old.value!));
    if(expected)expect(part.every((byte,index)=>byte===expected[size+index])).toBe(true);
    before.update(old.value!);after.update(part);size+=part.length;chunks++;
  }
  expect(legacy.next().done).toBe(true);expect(after.digest()).toBe(before.digest());
  if(expected)expect(size).toBe(expected.length);
  return {size,chunks};
}

it('keeps legacy number, omission, key-order and plain-object JSON bytes',()=>{
  const shared={tiny:Number.MIN_VALUE},nullObject=Object.assign(Object.create(null),{z:1,a:'茶'});
  const keys=JSON.parse('{"z":0,"10":10,"2":2,"01":1,"__proto__":{"safe":true},"a":3}');
  const values=[null,true,false,-0,Number.MIN_VALUE,Number.MAX_VALUE,Number.EPSILON,1e-7,1e-6,1e20,1e21,1.2345678901234567,NaN,Infinity,-Infinity];
  const omitted={undefined:undefined,fn:()=>0,symbol:Symbol(),[Symbol()]:1,keep:null};
  Object.defineProperty(omitted,'hidden',{value:3});
  for(const value of [...values,values,omitted,[,undefined,()=>0,Symbol(),null],keys,nullObject,{left:shared,right:shared}])expectLegacy(value);
  // The existing writer ignores object toJSON methods; preserve that contract.
  const toJSON=vi.fn(()=>({changed:true}));expectLegacy({keep:1,toJSON},false);expect(toJSON).not.toHaveBeenCalled();
  expect(Object.getPrototypeOf(keys)).toBe(Object.prototype);expect(Object.hasOwn(keys,'__proto__')).toBe(true);
});

it('keeps Unicode and escapes at 4096-string, 16KiB-encoding and 1MiB-part boundaries',()=>{
  const special='🙂\ud800\udfff\udfff\ud800"\\\n\t\r\b\f\u0000\u001f茶';
  for(const boundary of [4096,16*1024,chunkBytes])for(const shift of [-1,0,1]){
    const padding='x'.repeat(boundary-1+shift);
    expectLegacy(padding+special);
    expectLegacy({[padding.slice(0,16*1024)+special]:special,values:[padding,special]});
  }
  for(const length of [chunkBytes-1,chunkBytes,chunkBytes+1]){
    expect(expectLegacy('x'.repeat(length-2))).toEqual({size:length,chunks:Math.ceil(length/chunkBytes)});
  }
});

it('reduces encode calls for small fragments without growing pending text or stringifying containers',()=>{
  const value=Array.from({length:3000},(_,id)=>({id,value:id/10,flag:true,text:'茶🙂'}));
  const encode=vi.spyOn(TextEncoder.prototype,'encode'),stringify=vi.spyOn(JSON,'stringify');
  try{
    for(const _ of legacyJsonChunks(value)){};
    const oldCalls=encode.mock.calls.length;encode.mockClear();stringify.mockClear();
    for(const _ of jsonChunks(value)){};
    const lengths=encode.mock.calls.map(([text])=>text!.length);
    expect(oldCalls).toBeGreaterThan(50_000);expect(lengths.length).toBeLessThan(oldCalls/100);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(16*1024);
    expect(Math.min(...lengths.slice(0,-1))).toBeGreaterThan(16*1024-32);
    expect(stringify.mock.calls.every(([item])=>typeof item!=='object'&&(typeof item!=='string'||item.length<=4096))).toBe(true);
    encode.mockClear();
    for(const _ of jsonChunks({text:'\u0000'.repeat(4096*8)})){};
    expect(Math.max(...encode.mock.calls.map(([text])=>text!.length))).toBe(4096*6);
    expect(encode.mock.calls.every(([text])=>text!.length<=4096*6)).toBe(true);
  }finally{encode.mockRestore();stringify.mockRestore();}
});

it('stays incremental and validates cycle, prototype and depth after an emitted part',()=>{
  const padding='x'.repeat(chunkBytes+64*1024),cycle:any={};cycle.self=cycle;
  let deep:any=null;for(let i=0;i<65;i++)deep={child:deep};
  for(const invalid of [cycle,new Date(),Object.create({inherited:true}),new Number(1),deep,{value:1n}]){
    for(const run of [legacyJsonChunks,jsonChunks]){
      const chunks=run({padding,invalid});expect(chunks.next().value!.length).toBe(chunkBytes);
      expect(()=>{for(const _ of chunks){}}).toThrow();
    }
  }
  for(const invalid of [undefined,()=>0,Symbol(),1n])for(const run of [legacyJsonChunks,jsonChunks])expect(()=>[...run(invalid)]).toThrow();
  for(const run of [legacyJsonChunks,jsonChunks]){
    const reached=vi.fn(()=>{throw Error('Unexpected tail');});
    const chunks=run({padding,get tail(){return reached();}});
    expect(chunks.next().value!.length).toBe(chunkBytes);chunks.return(undefined);
    expect(chunks.next().done).toBe(true);expect(reached).not.toHaveBeenCalled();
  }
});

it.each(['object','array'])('only serializes %s nesting that the reader can restore',kind=>{
  const nested=(depth:number)=>{let value:any='original';for(let i=0;i<depth;i++)value=kind==='array'?[value]:{extension:value};return value;};
  const value=nested(64),parser=new JsonStream();
  for(const part of jsonChunks(value))parser.feed(part);
  expect(parser.finish()).toEqual(value);
  expect(()=>[...jsonChunks(nested(65))]).toThrow('Invalid sync transfer');
});
function fixture(){const payload={messages:[{content:'あ🙂'.repeat(330000)}]},body={request_id:'durable',changes:[{payload}]};return {payload,body,raw:new TextEncoder().encode(JSON.stringify(body))};}

it('resumes the same upload and hashes the exact UTF-8 bytes before committing',async()=>{
  const {body,raw}=fixture(),parts=[raw.subarray(0,chunkBytes)];
  const call=vi.fn(async(path:string,init?:RequestInit)=>{
    const value=init?.body?JSON.parse(String(init.body)):null;
    if(path==='/transfers'){expect(value).toMatchObject({request_id:'durable',size:raw.length,sha256:hash(raw)});return {transfer_id:transfer,next:1,chunk_bytes:chunkBytes};}
    if(path.endsWith('/commit')){expect(parts.reduce((size,part)=>size+part.length,0)).toBe(raw.length);expect(new Sha256().update(parts[0]).update(parts[1]).update(parts[2]).digest()).toBe(hash(raw));return {changes:[{id:'chat',revision:1,deleted:false}]};}
    const part=decodeBytes(value.data);expect(hash(part)).toBe(value.sha256);parts.push(part);return {next:parts.length};
  });
  expect(await uploadSync(body,call,async()=>{})).toMatchObject({changes:[{revision:1}]});
  expect(call.mock.calls.some(([path])=>path.endsWith('/parts/0'))).toBe(false);
});

it('stops before the next chunk when consent or account changes',async()=>{
  const {body}=fixture();let withdrawn=false;
  const call=vi.fn(async(path:string)=>{if(path==='/transfers')return {transfer_id:transfer,next:0,chunk_bytes:chunkBytes};withdrawn=true;return {next:1};});
  await expect(uploadSync(body,call,async()=>{if(withdrawn)throw Error('Consent changed');})).rejects.toThrow('Consent changed');
  expect(call.mock.calls).toHaveLength(2);expect(call.mock.calls.some(([path])=>path.endsWith('/commit'))).toBe(false);
});

it('validates all chunk and total hashes before exposing a downloaded entity',async()=>{
  const {payload}=fixture(),raw=new TextEncoder().encode(JSON.stringify(payload));
  const entity={id:'chat',revision:7,payload_ref:{id:'chat',revision:7,transfer_id:transfer,size:raw.length,sha256:hash(raw),chunks:Math.ceil(raw.length/chunkBytes),chunk_bytes:chunkBytes}};
  const call=async(path:string)=>{const index=Number(path.split('/').at(-1)),part=raw.subarray(index*chunkBytes,(index+1)*chunkBytes);return {data:encodeBytes(part),sha256:hash(part)};};
  const result=await downloadEntity(entity,call,async()=>{});
  expect(result.payload).toEqual(payload);expect(result.payload_ref).toBeUndefined();expect(entity).not.toHaveProperty('payload');
  await expect(downloadEntity(entity,async path=>({...await call(path),sha256:'0'.repeat(64)}),async()=>{})).rejects.toThrow('SHA-256');
  expect(entity).not.toHaveProperty('payload');
  await expect(downloadEntity({...entity,revision:8},call,async()=>{})).rejects.toThrow('reference');
});

it('uses a committed receipt after a restart without sending the body again',async()=>{
  const {body}=fixture(),result={changes:[{id:'chat',revision:4,deleted:false}]};
  const call=vi.fn().mockResolvedValue({result});
  expect(await uploadSync(body,call,async()=>{})).toBe(result);expect(call).toHaveBeenCalledTimes(1);
});

it('reconciles a pre-upgrade inline receipt through the original request validation',async()=>{
  const body={request_id:'pre-upgrade',changes:[{payload:{text:'x'.repeat(1_600_000)}}]};
  const result={changes:[{id:'chat',revision:1,deleted:false}]};
  const call=vi.fn(async(path:string,init?:RequestInit)=>{
    if(path==='/transfers')return {inline_receipt_required:true};
    expect(path).toBe('');expect(JSON.parse(String(init?.body)).request_id).toBe('pre-upgrade');return result;
  });
  expect(await uploadSync(body,call,async()=>{})).toBe(result);expect(call).toHaveBeenCalledTimes(2);
});

it('keeps small requests inline with the original JSON serialization',async()=>{
  const body={request_id:'small',changes:[{payload:{text:'茶🙂',optional:undefined,values:[undefined,null,-0,true]}}]},result={changes:[]};
  const call=vi.fn(async(path:string,init?:RequestInit)=>{expect(path).toBe('');expect(init?.body).toBe(JSON.stringify(body));return result;});
  expect(await uploadSync(body,call,async()=>{})).toBe(result);expect(call).toHaveBeenCalledOnce();
});

it('streams exact legacy bytes across Unicode and escaped-string boundaries using bounded encodings',async()=>{
  const key='\"\n\u0000'.repeat(3000),text='x'.repeat(4095)+'🙂'+'\ud800\udc00\ud800\udfff\udfff\ud800\"\\\n\t\r\b\f\u0000'.repeat(90000);
  const body={request_id:'escaped',changes:[{payload:{[key]:text,values:[null,true,false,undefined,-0,1e30],omit:undefined,nested:{b:2,a:'茶'}}}]};
  const raw=new TextEncoder().encode(JSON.stringify(body)),sha256=hash(raw),parts:Uint8Array[]=[];
  const encode=vi.spyOn(TextEncoder.prototype,'encode');
  try{
    const call=async(path:string,init?:RequestInit)=>{
      const value=JSON.parse(String(init?.body));
      if(path==='/transfers'){expect(value).toMatchObject({size:raw.length,sha256});return {transfer_id:transfer,next:0,chunk_bytes:chunkBytes};}
      if(path.endsWith('/commit'))return {changes:[]};
      const part=decodeBytes(value.data);expect(part.length).toBe(Math.min(chunkBytes,raw.length-parts.length*chunkBytes));
      const offset=parts.length*chunkBytes;
      expect(part.every((byte,index)=>byte===raw[offset+index])).toBe(true);parts.push(part);return {next:parts.length};
    };
    await uploadSync(body,call,async()=>{});
    expect(parts.length).toBe(Math.ceil(raw.length/chunkBytes));
    expect(encode.mock.calls.every(([text])=>!text||text.length<=4096*6)).toBe(true);
  }finally{encode.mockRestore();}
});

it('rejects cyclic and non-JSON outbox objects before any network call',async()=>{
  const call=vi.fn(),cycle:any={};cycle.self=cycle;
  for(const payload of [cycle,new Date(),{value:1n}])await expect(uploadSync({request_id:'invalid',changes:[{payload}]},call,async()=>{})).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});

it('parses a many-message download without decoding or parsing the entire encoded entity',async()=>{
  const payload={messages:Array.from({length:28},(_,id)=>({id,content:'茶🙂'.repeat(11000)}))};
  const raw=new TextEncoder().encode(JSON.stringify(payload));
  const entity={id:'chat',revision:1,payload_ref:{id:'chat',revision:1,transfer_id:transfer,size:raw.length,sha256:hash(raw),chunks:Math.ceil(raw.length/chunkBytes),chunk_bytes:chunkBytes}};
  const decode=vi.spyOn(TextDecoder.prototype,'decode'),parse=vi.spyOn(JSON,'parse');
  try{
    const result=await downloadEntity(entity,async path=>{
      const index=Number(path.split('/').at(-1)),part=raw.subarray(index*chunkBytes,(index+1)*chunkBytes);
      return {data:encodeBytes(part),sha256:hash(part)};
    },async()=>{});
    expect(result.payload).toEqual(payload);
    expect(decode.mock.calls.every(([input])=>!input||input.byteLength<=chunkBytes)).toBe(true);
    expect(parse.mock.calls.every(([text])=>text.length<100_000)).toBe(true);
  }finally{decode.mockRestore();parse.mockRestore();}
});

it.each(['total-hash','syntax','trailing','utf8','shape','withdrawal'])('exposes no payload when a download fails at %s',async failure=>{
  let raw=new TextEncoder().encode(failure==='syntax'?'{"messages":[':failure==='trailing'?'{} {}':failure==='shape'?'[]':'{"messages":[]}');
  if(failure==='utf8')raw=new Uint8Array([0xff]);
  const entity={id:'chat',revision:1,payload_ref:{id:'chat',revision:1,transfer_id:transfer,size:raw.length,sha256:failure==='total-hash'?'0'.repeat(64):hash(raw),chunks:1,chunk_bytes:chunkBytes}};
  let withdrawn=false;
  await expect(downloadEntity(entity,async()=>{withdrawn=failure==='withdrawal';return {data:encodeBytes(raw),sha256:hash(raw)};},async()=>{if(withdrawn)throw Error('Consent changed');})).rejects.toThrow();
  expect(entity).not.toHaveProperty('payload');expect(entity.payload_ref).toBeDefined();
});
