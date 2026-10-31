import { expect, expectTypeOf, it } from 'vitest';
import { JsonStream } from './jsonStream';
import type { MessageWindow } from './jsonStream';
import { createHash } from 'node:crypto';
import { Sha256 } from '../mobile/sha256';
import cases from '../../../../tests/fixtures/json-stream.json';

function parse(raw:Uint8Array,width:number){const parser=new JsonStream();for(let index=0;index<raw.length;index+=width)parser.feed(raw.subarray(index,index+width));return parser.finish();}
function windowed(text:string,window:MessageWindow|{ids:readonly number[]},width:number){const parser=new JsonStream(window),raw=new TextEncoder().encode(text);for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));return {value:parser.finish(),total:parser.totalMessages};}

it('streams only the selected saved-outbox payload messages and keeps all controls at every byte boundary',()=>{
  const messages='[null,true,false,-0,1.25e-2,1e400,"茶🙂",[],{},[{"messages":[2]}],{"__proto__":{"keep":true},"snapshot":{"payload":{"messages":[3]}},"messages":[4],"messages":[5]}]';
  for(const payloadFirst of [false,true])for(const width of [1,2,7,1024]){
    const payload='"payload":{"__proto__":{"metadata":true},"nested":{"payload":{"messages":[8]}},"messages":'+messages+',"after":true}';
    const controls='"id":"middle","kind":"conversation","deleted":false,"base_revision":4,"messages":[9],"after":{"payload":{"keep":true}}';
    const text='[{"id":"before","payload":{"messages":[0],"nested":{"payload":{"keep":1}}},"deleted":true},{'+(payloadFirst?payload+','+controls:controls+','+payload)+'},{"payload":{"messages":[6]},"id":"after","base_revision":7}]';
    const expected=JSON.parse(text),selected=expected[1].payload,seen:[unknown,number][]=[];
    const parser=new JsonStream({outboxChange:{index:1,onMessage:(value,index)=>{
      expectTypeOf(value).toEqualTypeOf<unknown>();expectTypeOf(index).toEqualTypeOf<number>();
      seen.push([value,index]);expect((parser as any).root[1].payload.messages).toEqual([]);
    }}}),bytes=new TextEncoder().encode(text);
    for(let i=0;i<bytes.length;i+=width){
      parser.feed(bytes.subarray(i,i+width));
      const root=(parser as any).root;
      for(const index of [0,2])if(root?.[index]?.payload)expect(Object.keys(root[index].payload)).toEqual([]);
      if(Array.isArray(root?.[1]?.payload?.messages))expect(root[1].payload.messages).toEqual([]);
      for(const frame of (parser as any).stack)if(!frame.keep){
        expect(Object.keys(frame.value)).toEqual([]);expect((parser as any).pieces).toEqual([]);
      }
    }
    expect(seen).toEqual(selected.messages.map((value:unknown,index:number)=>[value,index]));
    expected[0].payload={};expected[2].payload={};selected.messages=[];
    expect(parser.finish()).toEqual(expected);expect(parser.totalMessages).toBe(JSON.parse(messages).length);
    expect(Object.getPrototypeOf(seen.at(-1)![0])).toBe(Object.prototype);
    expect(Object.hasOwn(seen.at(-1)![0] as object,'__proto__')).toBe(true);
    expect(Object.hasOwn(selected,'__proto__')).toBe(true);expect(({} as any).metadata).toBeUndefined();
  }
});

it('discards nonselected payload scalars and containers without retaining token contents',()=>{
  for(const payload of ['null','true','false','123','"'+'茶🙂'.repeat(1024)+'"','[1,{"messages":[2]}]','{"__proto__":{"messages":[1]},"large":"'+'x'.repeat(8192)+'"}'])for(const width of [1,2,7,1024]){
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{throw Error('Unexpected callback');}}});
    const bytes=new TextEncoder().encode('[{"payload":'+payload+',"id":"first"},{"id":"target","payload":{}},{"payload":'+payload+',"id":"last"}]');
    for(let i=0;i<bytes.length;i+=width){
      parser.feed(bytes.subarray(i,i+width));
      for(const index of [0,2]){
        const value=(parser as any).root?.[index]?.payload;
        if(value!==undefined){expect(typeof value).toBe('object');expect(Object.keys(value)).toEqual([]);}
      }
      if(!(parser as any).tokenKeep)expect((parser as any).pieces).toEqual([]);
    }
    const discarded=payload[0]==='{'?{}:payload[0]==='['?[]:undefined;
    expect(parser.finish()).toEqual([{payload:discarded,id:'first'},{id:'target',payload:{}},{payload:discarded,id:'last'}]);
    expect(parser.totalMessages).toBeUndefined();
  }
});

it('targets only a direct object payload in a saved root array and counts only its direct array messages',()=>{
  for(const target of ['{}','{"payload":null}','{"payload":[]}','{"payload":[{"messages":[1]}]}',
    '{"payload":{"nested":{"messages":[1]}}}','{"payload":{"messages":null}}','{"payload":{"messages":true}}',
    '{"payload":{"messages":1}}','{"payload":{"messages":"text"}}','{"payload":{"messages":{"messages":[1]}}}',
    '{"payload":{"__proto__":{"messages":[1]}}}','{"payload":{"messages":[]}}'])for(const width of [1,2,7,1024]){
    const seen:unknown[]=[],text='[{"payload":{"messages":[0]}},'+target+',{"payload":{"messages":[2]}}]';
    const parser=new JsonStream({outboxChange:{index:1,onMessage:value=>seen.push(value)}}),bytes=new TextEncoder().encode(text);
    for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));
    const expected=JSON.parse(text);expected[0].payload={};expected[2].payload={};
    expect(parser.finish()).toEqual(expected);expect(seen).toEqual([]);
    expect(parser.totalMessages).toBe(target==='{"payload":{"messages":[]}}'?0:undefined);
  }
  for(const text of ['{"messages":[1]}','{"changes":[{"payload":{"messages":[1]}}]}','{"payload":{"messages":[1]}}','[[{"payload":{"messages":[1]}}]]','[{"payload":{"messages":[1]}}]']){
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{throw Error('Wrong path');}}});
    parser.feed(new TextEncoder().encode(text));const value=parser.finish();
    expect(parser.totalMessages).toBeUndefined();
    if(!Array.isArray(value))expect(value).toEqual(JSON.parse(text));
  }
});

it('validates correct-hash discarded outbox JSON and UTF-8 before accepting a finish',()=>{
  const encode=(text:string)=>new TextEncoder().encode(text);
  const rejected:Uint8Array[]=[];
  for(const text of [...cases.valid,...cases.invalid])for(const other of [0,2])for(const width of [1,2,7,1024]){
    const payload=text.replace(/^\uFEFF/,'');
    const raw='[{"payload":'+(other===0?payload:'{}')+'},{"payload":{"messages":["selected"]}},{"payload":'+(other===2?payload:'{}')+'}]';
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{}}}),bytes=encode(raw);
    const finish=()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));return parser.finish();};
    expect(new Sha256().update(bytes).digest()).toBe(createHash('sha256').update(bytes).digest('hex'));
    let expected;try{expected=JSON.parse(raw);}catch{expect(finish,raw).toThrow();continue;}
    const discarded=expected[other].payload;
    expected[other].payload=discarded&&typeof discarded==='object'?(Array.isArray(discarded)?[]:{}):undefined;
    expected[1].payload.messages=[];expect(finish()).toEqual(expected);expect(parser.totalMessages).toBe(1);
  }
  for(const hex of cases.invalid_utf8_hex)for(const other of [0,2]){
    const prefix=encode(other===0?'[{"payload":"':'[{"payload":{}},{"payload":{"messages":[1]}},{"payload":"');
    const invalid=Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16));
    const suffix=encode(other===0?'"},{"payload":{"messages":[1]}},{"payload":{}}]':'"}]');
    const bytes=new Uint8Array(prefix.length+invalid.length+suffix.length);bytes.set(prefix);bytes.set(invalid,prefix.length);bytes.set(suffix,prefix.length+invalid.length);rejected.push(bytes);
  }
  for(const other of [0,2])rejected.push(encode('[{"payload":'+(other===0?'['.repeat(63)+']'.repeat(63):'{}')+'},{"payload":{"messages":[1]}},{"payload":'+(other===2?'['.repeat(63)+']'.repeat(63):'{}')+'}]'));
  for(const bytes of rejected)for(const width of [1,2,7,1024]){
    expect(new Sha256().update(bytes).digest()).toBe(createHash('sha256').update(bytes).digest('hex'));
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{}}});
    expect(()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));parser.finish();}).toThrow();
    expect(()=>parser.finish()).toThrow();
  }
  for(const selected of [false,true])for(const depth of [selected?60:62,selected?61:63])for(const width of [1,2,7,1024]){
    const nested='['.repeat(depth)+']'.repeat(depth);
    const text=selected?'[{"payload":{}},{"payload":{"messages":['+nested+']}},{"payload":{}}]':
      '[{"payload":'+nested+'},{"payload":{"messages":[1]}},{"payload":{}}]';
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{}}}),bytes=encode(text);
    const finish=()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));return parser.finish();};
    if(depth===(selected?60:62)){expect(finish()).toEqual([{payload:selected?{}:[]},{payload:{messages:[]}},{payload:{}}]);expect(parser.totalMessages).toBe(1);}
    else expect(finish).toThrow();
  }
});

it('rejects duplicate selected messages keys and requires finish after early outbox callbacks',()=>{
  for(const payload of ['{"messages":[1],"messages":[2]}','{"mess\\u0061ges":[],"messages":null}','{"messages":null,"messages":[]}','{"messages":[],"mess\\u0061ges":[]}'])for(const width of [1,2,7,1024]){
    const parser=new JsonStream({outboxChange:{index:1,onMessage:()=>{}}}),bytes=new TextEncoder().encode('[{"payload":{}},{"payload":'+payload+'},{"payload":{}}]');
    expect(()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));parser.finish();}).toThrow('Duplicate root messages key');
    expect(()=>parser.finish()).toThrow();
  }
  for(const width of [1,2,7,1024]){
    const seen:unknown[]=[],parser=new JsonStream({outboxChange:{index:1,onMessage:value=>seen.push(value)}});
    const bytes=new TextEncoder().encode('[{"payload":{}},{"payload":{"messages":[{"snapshot":{"messages":[1]}}]}},{"payload":{"tail":true');
    for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));
    expect(seen).toEqual([{snapshot:{messages:[1]}}]);expect(()=>parser.finish()).toThrow();expect(()=>parser.finish()).toThrow();
  }
  for(const value of ['null','"text"','[]','{}']){
    const failure=Error('Outbox callback failed'),parser=new JsonStream({outboxChange:{index:0,onMessage:()=>{throw failure;}}});
    expect(()=>parser.feed(new TextEncoder().encode('[{"payload":{"messages":['+value+']}}]'))).toThrow(failure);
    expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
  }
});

it('validates and snapshots the selected outbox index and callback',()=>{
  for(const index of [undefined,null,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'1',true])expect(()=>new JsonStream({outboxChange:{index:index as any,onMessage:()=>{}}})).toThrow('Invalid outbox change index');
  for(const change of [undefined,null,false,0,{},[]])expect(()=>new JsonStream({outboxChange:change as any})).toThrow('Invalid outbox change index');
  for(const onMessage of [undefined,null,false,true,0,'callback',[],{}])expect(()=>new JsonStream({outboxChange:{index:0,onMessage:onMessage as any}})).toThrow('Invalid message callback');
  const seen:unknown[]=[],options={outboxChange:{index:0,onMessage:(value:unknown)=>{seen.push(value);}}},parser=new JsonStream(options);
  options.outboxChange.index=1;options.outboxChange.onMessage=()=>{throw Error('Changed callback');};
  options.outboxChange={index:2,onMessage:()=>{throw Error('Changed options');}};
  parser.feed(new TextEncoder().encode('[{"payload":{"messages":[1]}},{"payload":{"messages":[2]}}]'));
  expect(parser.finish()).toEqual([{payload:{messages:[]}},{payload:{}}]);expect(seen).toEqual([1]);expect(parser.totalMessages).toBe(1);
  expect(()=>new JsonStream({outboxChange:{index:Number.MAX_SAFE_INTEGER,onMessage:()=>{}}})).not.toThrow();
});

it('projects only direct wire change payloads while validating discarded JSON and preserving controls',()=>{
  const text='{"request_id":"fixed","changes":[{"id":"chat","kind":"conversation","base_revision":3,"payload":{"messages":[{"content":"茶🙂","__proto__":{"keep":true}}],"nested":{"payload":{"keep":1}}},"deleted":false,"after":{"payload":{"keep":2}}}],"after":{"payload":{"keep":3}}}';
  const expected=JSON.parse(text);expected.changes[0].payload={};
  for(const width of [1,2,7,64,1024]){
    const parser=new JsonStream({omitChangePayloads:true}),bytes=new TextEncoder().encode(text);
    for(let i=0;i<bytes.length;i+=width){parser.feed(bytes.subarray(i,i+width));
      for(const change of (parser as any).root?.changes??[])if(change.payload)expect(change.payload).toEqual({});}
    expect(parser.finish()).toEqual(expected);
  }
  for(const value of [false,null,undefined,'true',1])expect(()=>new JsonStream({omitChangePayloads:value as any})).toThrow('Invalid changes projection');
});
it('validates every discarded payload at byte boundaries, including depth and UTF-8 errors',()=>{
  for(const text of [...cases.valid,...cases.invalid])for(const width of [1,2,7]){
    const wrapped='{"request_id":"fixed","changes":[{"id":"chat","payload":'+text.replace(/^\uFEFF/,'')+'}]}';
    const parser=new JsonStream({omitChangePayloads:true}),bytes=new TextEncoder().encode(wrapped);
    const finish=()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));return parser.finish();};
    try{JSON.parse(wrapped);}catch{expect(finish).toThrow();continue;}
    expect(()=>finish()).not.toThrow();
  }
  for(const bytes of [new Uint8Array([0xff]),new TextEncoder().encode('{"changes":[{"payload":'+'['.repeat(62)+']'.repeat(62)+'}]}')]){
    const parser=new JsonStream({omitChangePayloads:true});expect(()=>{parser.feed(bytes);parser.finish();}).toThrow();
  }
});

it('snapshots a typed synchronous callback and preserves every JSON message value',()=>{
  for(const onMessage of [undefined,null,false,true,0,'callback',[],{}])expect(()=>new JsonStream({onMessage:onMessage as any})).toThrow('Invalid message callback');
  const text='{"before":1,"messages":[null,true,false,-0,1.25e-2,1e400,"茶🙂",[],{},[{"messages":[2]}],{"id":1,"id":9,"__proto__":{"keep":true},"messages":[0],"messages":[1]}],"nested":{"messages":[9]},"after":true}',expected=JSON.parse(text);
  for(const width of [1,2,7,1024]){
    const seen:[unknown,number][]=[],options={onMessage:(value:unknown,index:number)=>{seen.push([value,index]);}};
    const parser=new JsonStream(options),raw=new TextEncoder().encode(text);options.onMessage=()=>{throw Error('Changed callback');};
    for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));
    expect(seen).toEqual(expected.messages.map((value:unknown,index:number)=>[value,index]));
    expect(parser.finish()).toEqual({...expected,messages:[]});expect(parser.totalMessages).toBe(expected.messages.length);
    const last=seen.at(-1)![0] as object;expect(Object.getPrototypeOf(last)).toBe(Object.prototype);expect(Object.hasOwn(last,'__proto__')).toBe(true);
    expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
  }
});

it('emits each direct message once on completion, never on keys or nested array closes',()=>{
  const seen:[unknown,number][]=[],parser=new JsonStream({onMessage:(value,index)=>{expectTypeOf(value).toEqualTypeOf<unknown>();expectTypeOf(index).toEqualTypeOf<number>();seen.push([value,index]);}});
  const feed=(text:string)=>parser.feed(new TextEncoder().encode(text));
  feed('{"messages":[{"messages":[1],"key":"va');expect(seen).toEqual([]);
  feed('lue","duplicate":0,"duplicate":1');expect(seen).toEqual([]);
  feed('},[');expect(seen).toEqual([[{messages:[1],key:'value',duplicate:1},0]]);
  feed('{"nested":{"messages":[2]}}');expect(seen).toHaveLength(1);
  feed('],"');expect(seen).toHaveLength(2);expect(seen[1]).toEqual([[{nested:{messages:[2]}}],1]);
  feed('last"');expect(seen[2]).toEqual(['last',2]);
  feed(',true');expect(seen).toHaveLength(3);
  feed(']');expect(seen[3]).toEqual([true,3]);expect(parser.totalMessages).toBe(4);
  feed(',"key":"metadata","nested":{"messages":[5]}}');expect(seen).toHaveLength(4);
  expect(parser.finish()).toEqual({messages:[],key:'metadata',nested:{messages:[5]}});
});

it('leaves totalMessages undefined for missing or non-array root messages',()=>{
  for(const text of ['null','[]','[{"messages":[1]}]','{"nested":{"messages":[1]}}','{"messages":null}','{"messages":true}','{"messages":1}','{"messages":"text"}','{"messages":{"messages":[1]}}','{"__proto__":{"messages":[1]}}','{"messages":[]}']){
    const seen:unknown[]=[],parser=new JsonStream({onMessage:value=>seen.push(value)});
    parser.feed(new TextEncoder().encode(text));expect(parser.finish()).toEqual(JSON.parse(text));expect(seen).toEqual([]);
    expect(parser.totalMessages).toBe(text==='{"messages":[]}'?0:undefined);
  }
});

it('retains only metadata and one candidate while keeping root.messages empty across a long stream',()=>{
  const messages=Array.from({length:400},(_,id)=>({id,content:'茶🙂'.repeat(128),nested:{messages:[id]}}));let count=0;
  const parser=new JsonStream({onMessage:(value,index)=>{expect(index).toBe(count++);expect(value).toEqual(messages[index]);expect((parser as any).root.messages).toEqual([]);}});
  const raw=new TextEncoder().encode(JSON.stringify({metadata:{keep:true},messages,after:'done'}));
  for(let i=0;i<raw.length;i+=257){
    parser.feed(raw.subarray(i,i+257));const {root,stack}=parser as any;
    expect(root.messages).toEqual([]);expect(root.metadata).toEqual({keep:true});
    expect(stack.filter((_:any,index:number)=>index>0&&stack[index-1].messages).length).toBeLessThanOrEqual(1);
  }
  expect(parser.finish()).toEqual({metadata:{keep:true},messages:[],after:'done'});expect(parser.totalMessages).toBe(400);expect(count).toBe(400);
});

it('validates the full callback stream as JSON and UTF-8 at byte boundaries and preserves depth limits',()=>{
  for(const text of [...cases.valid,...cases.invalid])for(const width of [1,2,7,64]){
    const wrapped='{"messages":[null,'+text.replace(/^\uFEFF/,'')+'],"keep":"ok"}',seen:[unknown,number][]=[],parser=new JsonStream({onMessage:(value,index)=>seen.push([value,index])}),raw=new TextEncoder().encode(wrapped);
    const finish=()=>{for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));return parser.finish();};let expected;
    try{expected=JSON.parse(wrapped);}catch{
      expect(finish).toThrow();expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();continue;
    }
    expect(finish()).toEqual({...expected,messages:[]});expect(seen).toEqual(expected.messages.map((value:unknown,index:number)=>[value,index]));expect(parser.totalMessages).toBe(expected.messages.length);
  }
  for(const hex of cases.invalid_utf8_hex)for(const width of [1,2,7]){
    const seen:unknown[]=[],parser=new JsonStream({onMessage:value=>seen.push(value)}),bytes=Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16));
    parser.feed(new TextEncoder().encode('{"messages":[null,'));expect(seen).toEqual([null]);
    expect(()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));parser.feed(new TextEncoder().encode('],"keep":true}'));parser.finish();}).toThrow();
    expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
  }
  for(const depth of [62,63]){
    const parser=new JsonStream({onMessage:()=>{}}),raw=new TextEncoder().encode('{"messages":['+'['.repeat(depth)+']'.repeat(depth)+']}');
    if(depth===62){parser.feed(raw);expect(parser.finish()).toEqual({messages:[]});expect(parser.totalMessages).toBe(1);}
    else expect(()=>parser.feed(raw)).toThrow();
  }
});

it('closes on callback exceptions from scalars or containers, including finish flushing a scalar',()=>{
  for(const value of ['null','true','1','"text"','[]','{}']){
    let count=0;const failure=Error('Callback failed'),parser=new JsonStream({onMessage:()=>{count++;throw failure;}});
    expect(()=>parser.feed(new TextEncoder().encode('{"messages":['+value+',2]}'))).toThrow(failure);expect(count).toBe(1);
    expect(()=>parser.feed(new TextEncoder().encode('{}'))).toThrow();expect(()=>parser.finish()).toThrow();expect(count).toBe(1);
  }
  const failure=Error('Finish callback failed'),parser=new JsonStream({onMessage:()=>{throw failure;}});
  parser.feed(new TextEncoder().encode('{"messages":[1'));expect(()=>parser.finish()).toThrow(failure);
  expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
});

it('rejects repeated root messages keys only in callback mode, including escaped and non-array keys',()=>{
  for(const text of ['{"messages":[1],"messages":[2]}','{"mess\\u0061ges":[],"messages":null}','{"messages":null,"messages":[]}','{"messages":[],"mess\\u0061ges":[]}'])for(const width of [1,2,7,1024]){
    const seen:unknown[]=[],parser=new JsonStream({onMessage:value=>seen.push(value)}),raw=new TextEncoder().encode(text);
    expect(()=>{for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));parser.finish();}).toThrow('Duplicate root messages key');
    expect(seen).toEqual(text.startsWith('{"messages":[1]')?[1]:[]);
    expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
    expect(parse(raw,width)).toEqual(JSON.parse(text));
    const expected=JSON.parse(text),total=Array.isArray(expected.messages)?expected.messages.length:undefined;
    expect(windowed(text,{limit:1},width)).toEqual({value:expected,total});
    expect(windowed(text,{ids:[1]},width)).toEqual({value:{messages:total===undefined?expected.messages:[]},total});
  }
});

it('selects only root message objects by their final IDs with platform duplicate-key and prototype semantics',()=>{
  const text='{"messages":[{"id":1,"content":"overwritten"}],"nested":{"messages":[{"id":8}]},"__proto__":{"messages":[{"id":1}]},"messages":[{"id":90},{"content":"茶🙂","__proto__":{"keep":true},"id":9},null,true,1,"scalar",[{"id":1}],{"id":1,"id":8},{"id":"1"},{"id":null},{"id":0},{"id":-1},{"id":9007199254740992},{"__proto__":{"id":1}},{"nested":{"id":1}},{"id":{"id":1}},{"id":8,"nested":{"messages":[{"id":9}]},"id":1}]}';
  const expected=JSON.parse(text),messages=expected.messages.filter((message:any)=>message&&!Array.isArray(message)&&[1,9].includes(message.id));
  for(const width of [1,2,7,1024]){
    expect(windowed(text,{ids:[1,9]},width)).toEqual({value:{...expected,messages},total:expected.messages.length});
    const result=windowed(text,{ids:[9]},width);
    expect(result.value.messages).toEqual([messages[0]]);
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(result.value.messages[0])).toBe(Object.prototype);
    expect(Object.hasOwn(result.value.messages[0],'__proto__')).toBe(true);
    expect(windowed('{"messages":[{"id":1}],"messages":null}',{ids:[1]},width)).toEqual({value:{messages:null},total:undefined});
    expect(windowed('{"messages":[]}',{ids:[1]},width)).toEqual({value:{messages:[]},total:0});
    expect(windowed('{"messages":[{"id":1},{"id":1}],"messages":[{"id":1,"content":"last"}]}',{ids:[1]},width)).toEqual({value:{messages:[{id:1,content:'last'}]},total:1});
    expect(windowed('{"nested":{"messages":[{"id":2}]}}',{ids:[1]},width)).toEqual({value:{nested:{messages:[{id:2}]}},total:undefined});
    expect(windowed('[{"messages":[{"id":2}]}]',{ids:[1]},width)).toEqual({value:[{messages:[{id:2}]}],total:undefined});
    expect(windowed('{"messages":[{"id":9007199254740991}]}',{ids:[Number.MAX_SAFE_INTEGER]},width).value.messages).toEqual([{id:Number.MAX_SAFE_INTEGER}]);
    expect(windowed('{"mess\\u0061ges":[{"id":8,"\\u0069d":1}]}',{ids:[1]},width)).toEqual({value:{messages:[{id:1}]},total:1});
  }
});

it('rejects invalid ID selectors before reading and snapshots the requested IDs',()=>{
  for(const ids of [[],[1,2,3],[1,1],[0],[-1],[-0],[1.5],[Infinity],[NaN],[Number.MAX_SAFE_INTEGER+1],['1'],[null],[undefined],Array(1),[1,,],null,{},new Set([1])]){
    expect(()=>new JsonStream({ids:ids as any})).toThrow('Invalid message IDs');
  }
  const ids=[1,9],selector={ids},parser=new JsonStream(selector);ids[0]=2;ids.push(3);selector.ids=[4];
  parser.feed(new TextEncoder().encode('{"messages":[{"id":2},{"id":9},{"id":1}]}'));
  expect(parser.finish()).toEqual({messages:[{id:9},{id:1}]});expect(parser.totalMessages).toBe(3);
  expect(windowed('{"messages":[{"id":1}]}',{ids:Object.freeze([1])},1).value.messages).toEqual([{id:1}]);
});

it('fails closed on repeated selected IDs without retaining more than two messages',()=>{
  for(const ids of [[1],[1,9]])for(const width of [1,2,7,1024]){
    const parser=new JsonStream({ids}),raw=new TextEncoder().encode('{"messages":[{"id":1},{"id":9},{"content":"duplicate","id":8,"id":1}]}');
    expect(()=>{
      for(let i=0;i<raw.length;i+=width){parser.feed(raw.subarray(i,i+width));expect((parser as any).root?.messages?.length??0).toBeLessThanOrEqual(2);}
      parser.finish();
    }).toThrow('Duplicate message ID');
    expect((parser as any).root.messages.length).toBe(ids.length);
    expect(()=>parser.finish()).toThrow();expect(()=>parser.feed(new Uint8Array())).toThrow();
  }
});

it('retains only a closing candidate and at most two selected messages across a long non-monotonic stream',()=>{
  const messages=[{content:'first',id:1},{content:'second',id:9},...Array.from({length:400},(_,i)=>({content:'茶🙂'.repeat(128),nested:{messages:[{id:1}]},id:500-i}))];
  const parser=new JsonStream({ids:[9,1]}),raw=new TextEncoder().encode(JSON.stringify({messages}));
  let maximum=0;
  for(let i=0;i<raw.length;i+=257){
    parser.feed(raw.subarray(i,i+257));
    const {root,stack}=parser as any;maximum=Math.max(maximum,root.messages.length);
    expect(root.messages.length).toBeLessThanOrEqual(2);
    expect(stack.filter((_:any,index:number)=>index>0&&stack[index-1].messages).length).toBeLessThanOrEqual(1);
    for(const message of root.messages)expect([1,9]).toContain(message.id);
  }
  expect(maximum).toBe(2);expect(parser.finish()).toEqual({messages:messages.slice(0,2)});expect(parser.totalMessages).toBe(messages.length);
  const pending=new JsonStream({ids:[1]});
  pending.feed(new TextEncoder().encode('{"messages":[{"id":1,"content":{"nested":true}'));
  expect((pending as any).root.messages).toEqual([]);
  pending.feed(new TextEncoder().encode(',"id":2},{"content":"selected","id":1'));
  expect((pending as any).root.messages).toEqual([]);
  pending.feed(new TextEncoder().encode('}]}'));expect(pending.finish()).toEqual({messages:[{content:'selected',id:1}]});expect(pending.totalMessages).toBe(2);
});

it('validates all discarded ID-mode syntax and UTF-8 even after both IDs have been found',()=>{
  const prefix='{"messages":[{"id":1},{"id":9},',suffix='],"keep":"ok"}';
  for(const text of cases.valid)for(const width of [1,2,7,64]){
    const raw=prefix+text.replace(/^\uFEFF/,'')+suffix;
    expect(windowed(raw,{ids:[1,9]},width)).toEqual({value:{messages:[{id:1},{id:9}],keep:'ok'},total:3});
  }
  for(const text of cases.invalid)for(const width of [1,2,7]){
    const wrapped=prefix+text+suffix;let expected;
    try{expected=JSON.parse(wrapped);}catch{expect(()=>windowed(wrapped,{ids:[1,9]},width)).toThrow();continue;}
    expect(windowed(wrapped,{ids:[1,9]},width)).toEqual({value:{messages:[{id:1},{id:9}],keep:'ok'},total:expected.messages.length});
  }
  for(const hex of cases.invalid_utf8_hex)for(const width of [1,2,7]){
    const parser=new JsonStream({ids:[1,9]}),bytes=Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16));
    parser.feed(new TextEncoder().encode(prefix));
    expect(()=>{for(let i=0;i<bytes.length;i+=width)parser.feed(bytes.subarray(i,i+width));parser.feed(new TextEncoder().encode(suffix));parser.finish();}).toThrow();
  }
  for(const discarded of ['["\\q"]','["\\u12x4"]','[1e+]','[01]','[truefalse]','{"id":8,"x":"\\q"}','{"id":8,"x":01}','['.repeat(64)+']'.repeat(64)]){
    expect(()=>windowed(prefix+discarded+suffix,{ids:[1,9]},1)).toThrow();
  }
  expect(()=>windowed(prefix+'null'+suffix+' true',{ids:[1,9]},1)).toThrow();
  const parser=new JsonStream({ids:[1]}),bytes=new TextEncoder().encode('{"messages":[["'+'x'.repeat(1024*1024)+'",'+'1'.repeat(1024*1024)+'],{"id":1}]}');
  let maximum=0;
  for(let i=0;i<bytes.length;i+=8191){parser.feed(bytes.subarray(i,i+8191));maximum=Math.max(maximum,(parser as any).pieces.reduce((n:number,s:string)=>n+s.length,0));}
  expect(parser.finish()).toEqual({messages:[{id:1}]});expect(parser.totalMessages).toBe(2);expect(maximum).toBeLessThan(64);
});

it('selects positional windows or the latest messages while preserving metadata and duplicate-key semantics',()=>{
  const text='{"messages":[0,1],"nested":{"messages":["nested"]},"__proto__":{"keep":true},"messages":[{"id":9,"content":"茶🙂"},null,[true],-0,{"id":1,"content":"last"}]}';
  const expected=JSON.parse(text);
  for(const width of [1,2,7,1024])for(const window of [{start:0,limit:2},{start:2,limit:2},{start:4,limit:20},{start:20,limit:2},{limit:2},{limit:0}]){
    const start=window.start??Math.max(0,expected.messages.length-window.limit),result=windowed(text,window,width);
    expect(result).toEqual({value:{...expected,messages:expected.messages.slice(start,start+window.limit)},total:5});
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
  }
  expect(windowed('{"messages":[1],"messages":null}',{limit:1},1)).toEqual({value:{messages:null},total:undefined});
  expect(windowed('{"messages":[]}',{limit:1},1)).toEqual({value:{messages:[]},total:0});
});

it('validates discarded scalar and container syntax with the same corpus at byte boundaries',()=>{
  for(const text of cases.valid)for(const width of [1,2,7,64]){
    const scalar=text.replace(/^\uFEFF/,'');
    expect(windowed('{"messages":['+scalar+'],"keep":"ok"}',{limit:0},width)).toEqual({value:{messages:[],keep:'ok'},total:1});
  }
  for(const text of cases.invalid)for(const width of [1,2,7]){
    const wrapped='{"messages":['+text+']}';let expected;
    try{expected=JSON.parse(wrapped);}catch{expect(()=>windowed(wrapped,{limit:0},width)).toThrow();continue;}
    expect(windowed(wrapped,{limit:0},width)).toEqual({value:{messages:[]},total:expected.messages.length});
  }
  for(const source of cases.valid)for(let i=0;i<source.length;i++){
    if(source.charCodeAt(i)>127)continue;
    const scalar=(source.slice(0,i)+','+source.slice(i+1)).replace(/^\uFEFF/,''),text='{"messages":['+scalar+']}';
    try{JSON.parse(text);}catch{expect(()=>windowed(text,{limit:0},3)).toThrow();continue;}
    expect(windowed(text,{limit:0},3)).toEqual({value:{messages:[]},total:JSON.parse(text).messages.length});
  }
  for(const hex of cases.invalid_utf8_hex){
    const parser=new JsonStream({limit:0});parser.feed(new TextEncoder().encode('{"messages":['));
    expect(()=>{parser.feed(Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16)));parser.feed(new TextEncoder().encode(']}'));parser.finish();}).toThrow();
  }
  for(const text of ['{"messages":["\\q"]}','{"messages":["\\u12x4"]}','{"messages":[1e+]}','{"messages":[01]}','{"messages":[truefalse]}','{"messages":['+'['.repeat(64)+']'.repeat(64)+']}'])expect(()=>windowed(text,{limit:0},1)).toThrow();
});

it('does not accumulate discarded strings or numbers and bounds the latest-message array',()=>{
  const raw=new TextEncoder().encode('{"messages":[{"content":"'+'x'.repeat(1024*1024)+'","number":'+'1'.repeat(1024*1024)+'},{"content":"kept"}]}');
  const parser=new JsonStream({start:1,limit:1});let maximum=0;
  for(let i=0;i<raw.length;i+=8191){parser.feed(raw.subarray(i,i+8191));maximum=Math.max(maximum,(parser as any).pieces.reduce((n:number,s:string)=>n+s.length,0));}
  expect(parser.finish()).toEqual({messages:[{content:'kept'}]});expect(parser.totalMessages).toBe(2);expect(maximum).toBeLessThan(64);
  const messages=Array.from({length:200},(_,id)=>({id,content:'茶🙂'.repeat(100)})),tail=new JsonStream({limit:4}),bytes=new TextEncoder().encode(JSON.stringify({messages}));
  for(let i=0;i<bytes.length;i+=1024){tail.feed(bytes.subarray(i,i+1024));expect((tail as any).root.messages.length).toBeLessThanOrEqual(4);}
  expect(tail.finish()).toEqual({messages:messages.slice(-4)});expect(tail.totalMessages).toBe(200);
});

it('rejects invalid message windows before reading and snapshots the requested range',()=>{
  for(const window of [{limit:-1},{limit:1.5},{limit:Infinity},{limit:NaN},{limit:1,start:-1},{limit:1,start:1.5}])expect(()=>new JsonStream(window)).toThrow('Invalid message window');
  const range={start:1,limit:1},parser=new JsonStream(range);range.start=0;
  parser.feed(new TextEncoder().encode('{"messages":[1,2]}'));expect(parser.finish()).toEqual({messages:[2]});
});
it('matches platform JSON parsing for shared fixtures at every small byte boundary',()=>{
  for(const text of cases.valid)for(const width of [1,2,3,7,64,1024]){
    const value=parse(new TextEncoder().encode(text),width);
    expect(value).toEqual(JSON.parse(text.replace(/^\uFEFF/,'')));
    if(value&&typeof value==='object'&&!Array.isArray(value))expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  }
  expect(({} as any).polluted).toBeUndefined();
});
it('rejects malformed syntax, trailing values and invalid UTF-8 across chunks',()=>{
  for(const text of cases.invalid)for(const width of [1,2,7,1024])expect(()=>parse(new TextEncoder().encode(text),width),text).toThrow();
  for(const hex of cases.invalid_utf8_hex)for(const width of [1,2,7])expect(()=>parse(Uint8Array.from(hex.match(/../g)!,v=>parseInt(v,16)),width)).toThrow();
});
it('closes after errors or completion and refuses excessive nesting',()=>{
  const parser=new JsonStream();parser.feed(new TextEncoder().encode('{}'));expect(parser.finish()).toEqual({});
  expect(()=>parser.feed(new Uint8Array())).toThrow();expect(()=>parser.finish()).toThrow();
  const failed=new JsonStream();expect(()=>failed.feed(new TextEncoder().encode('}'))).toThrow();expect(()=>failed.feed(new TextEncoder().encode('{}'))).toThrow();
  expect(()=>parse(new TextEncoder().encode('['.repeat(65)+']'.repeat(65)),7)).toThrow();
});
it('matches platform acceptance when punctuation mutates each ASCII position of the corpus',()=>{
  for(const source of cases.valid)for(let index=0;index<source.length;index++){
    if(source.charCodeAt(index)>127)continue;
    const text=source.slice(0,index)+','+source.slice(index+1),raw=new TextEncoder().encode(text);let expected:any;
    try{expected=JSON.parse(text.replace(/^\uFEFF/,''));}catch{expect(()=>parse(raw,3)).toThrow();continue;}
    expect(parse(raw,3)).toEqual(expected);
  }
});
