import { expect, it } from 'vitest';
import { JsonStream } from './jsonStream';
import type { MessageWindow } from './jsonStream';
import cases from '../../../../tests/fixtures/json-stream.json';

function parse(raw:Uint8Array,width:number){const parser=new JsonStream();for(let index=0;index<raw.length;index+=width)parser.feed(raw.subarray(index,index+width));return parser.finish();}
function windowed(text:string,window:MessageWindow,width:number){const parser=new JsonStream(window),raw=new TextEncoder().encode(text);for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));return {value:parser.finish(),total:parser.totalMessages};}

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
