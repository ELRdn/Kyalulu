import { expect, it } from 'vitest';
import { JsonStream } from './jsonStream';
import type { MessageWindow } from './jsonStream';
import cases from '../../../../tests/fixtures/json-stream.json';

function parse(raw:Uint8Array,width:number){const parser=new JsonStream();for(let index=0;index<raw.length;index+=width)parser.feed(raw.subarray(index,index+width));return parser.finish();}
function windowed(text:string,window:MessageWindow|{ids:readonly number[]},width:number){const parser=new JsonStream(window),raw=new TextEncoder().encode(text);for(let i=0;i<raw.length;i+=width)parser.feed(raw.subarray(i,i+width));return {value:parser.finish(),total:parser.totalMessages};}

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
