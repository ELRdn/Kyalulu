import { expect, it } from 'vitest';
import { JsonStream } from './jsonStream';
import cases from '../../../../tests/fixtures/json-stream.json';

function parse(raw:Uint8Array,width:number){const parser=new JsonStream();for(let index=0;index<raw.length;index+=width)parser.feed(raw.subarray(index,index+width));return parser.finish();}
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
