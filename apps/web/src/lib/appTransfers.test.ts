import { expect, it, vi } from 'vitest';
import { uploadSync, downloadEntity } from './appTransfers';
import { Sha256 } from '../mobile/sha256';
import { encodeBytes, decodeBytes } from './remoteRpc';

const chunkBytes=1024*1024,transfer='11111111-1111-4111-8111-111111111111';
const hash=(raw:Uint8Array)=>new Sha256().update(raw).digest();
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
