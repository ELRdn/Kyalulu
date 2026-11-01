import { expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/portable-prompt.json';
import loreValues from '../../../../tests/fixtures/device-lore-values.json';
import folds from '../mobile/casefold.generated.json';
import { compilePortable, assemblePortable, selectLore, casefold } from './devicePrompt';
it('matches Python on null positions and empty/disabled Lore flags',()=>{
  expect(selectLore(loreValues.books,loreValues.history)).toEqual(loreValues.expected);
  expect(loreValues.expected.selected.map(entry=>entry.content)).toEqual(['Stars','Allowed']);
});
it.each(fixture)('matches Python compile and assembly: $name',test=>{
  const compiled=compilePortable(test.snapshot,test.history);
  expect(compiled).toEqual(test.expected);
  expect(assemblePortable(compiled,test.history,'FORMAT CONTRACT')).toEqual(test.assembled);
});
it('uses exact character folding without treating inherited properties as macros',()=>{
  expect(casefold('Straße ς Iı 𐐀')).toBe('strasse σ iı 𐐨');
  const compiled=compilePortable({document:{name:'A',data:{description:'{{__proto__}} {{constructor}}'}}});
  expect(compiled.system_prompt).toContain('{{__proto__}} {{constructor}}');
  expect(compiled.sections.compatibility.map(n=>n.path)).toContain('macro.__proto__');
});
it('rejects malformed Lore instead of executing scripts, regex or URL requests',()=>{
  expect(()=>selectLore([{entries:[{keys:'not an array'}]}],[])).toThrow('Lore keys');
  const result=selectLore([{entries:[{constant:true,content:'not executed',use_regex:true}]}],[]);
  expect(result.selected).toEqual([]);expect(result.audit[0].reason).toBe('unsupported condition');
});

it('keeps exact Lore budget boundaries for Unicode and long text without character arrays',()=>{
  for(const content of ['', '\u2e80\u2e81', '茶🙂é', '\ud800x\udc00', '茶🙂é'.repeat(250000)]){
    const size=Math.floor(Array.from(content).length/1.5),from=Array.from;
    const spy=vi.spyOn(Array,'from').mockImplementation(((value:any,...rest:any[])=>{
      if(value===content)throw Error('Lore token estimates must not materialize the input characters');
      return (from as any)(value,...rest);
    }) as typeof Array.from);
    try{
      for(const budget of new Set([Math.max(0,size-1),size])){
        const result=selectLore([{token_budget:budget,entries:[{constant:true,case_sensitive:true,content}]}],[]);
        expect(result.audit[0]).toMatchObject({selected:size<=budget,estimated_tokens:size});
        expect(result.selected).toHaveLength(size<=budget?1:0);
      }
    }finally{spy.mockRestore();}
  }
});

it('folds Unicode exactly without building a full input character array',()=>{
  for(const value of ['', Object.keys(folds).join('')+'茶🙂é\ud800x\udc00', 'Straße ς Iı 𐐀 茶🙂'.repeat(10000)]){
    const expected=Array.from(value,c=>(folds as Record<string,string>)[c]??c).join(''),from=Array.from;
    const spy=vi.spyOn(Array,'from').mockImplementation(((input:any,...rest:any[])=>{
      if(input===value)throw Error('Case folding must not materialize input characters');
      return (from as any)(input,...rest);
    }) as typeof Array.from);
    try{expect(casefold(value)).toBe(expected);}finally{spy.mockRestore();}
  }
});

it('folds each unchanged Lore scan once and refreshes it after recursive additions',()=>{
  const scan='Straße 茶🙂',iterate=String.prototype[Symbol.iterator],observed:string[]=[];
  const spy=vi.spyOn(String.prototype,Symbol.iterator).mockImplementation(function(this:string){
    const value=String(this);if(value.startsWith(scan))observed.push(value);return iterate.call(value);
  });
  try{
    const repeated=selectLore([{entries:Array.from({length:64},(_,i)=>({keys:['STRASSE'],content:'entry'+i}))}],[{role:'user',content:scan}]);
    expect(repeated.selected).toHaveLength(64);expect(observed).toEqual([scan]);observed.length=0;
    const recursive=selectLore([{recursive_scanning:true,entries:[
      {keys:['STRASSE'],content:'Ω'}, {keys:['ω'],content:'End'}, {keys:['missing'],content:'unused'},
    ]}],[{role:'user',content:scan}]);
    expect(recursive.selected.map(entry=>entry.content)).toEqual(['Ω','End']);
    expect(observed).toEqual([scan,scan,scan]);
  }finally{spy.mockRestore();}
});

// Frozen pre-stream implementation; independent of the new matcher and its helpers.
// Original prefix SHA256: c4a296d92b72d956f4525a10145cfdf454d02a891a7c38c5fdab8fd3010ddb2c
const frozenSelectLore=(()=>{
type RecordValue=Record<string,any>;
type Message={role:string;content:string;slot?:string};
type PortableSnapshot={document:unknown;character_version?:string|null;persona?:RecordValue|null;world?:RecordValue|null;lorebooks?:RecordValue[];extra_system_prompt?:string|null;[key:string]:any};
const casefold=(text:string)=>{
  const buffer:string[]=[];let result='';
  for(const c of text){
    buffer.push((folds as Record<string,string>)[c]??c);
    if(buffer.length===4096){result+=buffer.join('');buffer.length=0;}
  }
  return result+buffer.join('');
};
const estimate=(text:string)=>{let count=0;for(const _ of text)count++;return Math.max(0,Math.floor(count/1.5));};
const integer=(value:unknown,fallback=0)=>{
  const parsed=typeof value==='number'?Math.trunc(value):typeof value==='string'&&/^[+-]?\d+$/.test(value.trim())?Number(value):value===true?1:value===false?0:NaN;
  if(value===undefined||value===null||value==='')return fallback;
  if(!Number.isSafeInteger(parsed))throw Error('Invalid Lore integer');return parsed;
};
const text=(value:unknown)=>{if(value===null||value===undefined)return '';if(typeof value!=='string')throw Error('Invalid prompt text');return value;};
function entries(book:RecordValue):RecordValue[] {
  const value=book.entries??[],items=Array.isArray(value)?value:Object.values(value);
  if(!value||typeof value!=='object'||items.length>10000||items.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw Error('Invalid Lore entries');
  return items;
}
function keys(entry:RecordValue,name:string,alias:string) {
  const values=entry[name]??entry[alias]??[];
  if(!Array.isArray(values)||values.some(k=>typeof k!=='string'))throw Error('Invalid Lore keys');return values as string[];
}
const portableTruthy=(value:unknown)=>Array.isArray(value)?value.length>0:value&&typeof value==='object'?Object.keys(value).length>0:!!value;
function unsupportedLoreCondition(entry:RecordValue) {
  return portableTruthy(entry.use_regex)||portableTruthy(entry.useRegex)||['useProbability','delay','cooldown','sticky','timeConditions','time_conditions','matchWholeWords','excludeRecursion','preventRecursion','delayUntilRecursion','group'].some(k=>portableTruthy(entry[k]))
    ||![0,false,null,undefined].includes(entry.selectiveLogic)||!['before_char','after_char'].includes(entry.position===undefined?'after_char':entry.position)
    ||keys(entry,'keys','keys').some(k=>/^\/.+\/[a-z]*$/.test(k));
}
function selectLore(books:RecordValue[],history:Message[],render=(value:string)=>value) {
  const selected:RecordValue[]=[],audit:RecordValue[]=[];
  books.forEach((book,bookIndex)=>{
    if(!book||typeof book!=='object'||Array.isArray(book))return;
    const depth=Math.max(0,Math.min(1000,integer(book.scan_depth===undefined?2:book.scan_depth))),budget=Math.max(0,integer(book.token_budget===undefined?1024:book.token_budget));
    let remaining=budget,scan=depth?history.slice(-depth).map(m=>m.content).join('\n'):'';
    const pending=entries(book).map((entry,index)=>({entry,index})).sort((a,b)=>integer(b.entry.priority)-integer(a.entry.priority)||integer(a.entry.insertion_order===undefined?a.index:a.entry.insertion_order)-integer(b.entry.insertion_order===undefined?b.index:b.entry.insertion_order)||a.index-b.index),visited=new Set<number>();
    while(true){
      const additions:string[]=[];let folded:string|undefined;
      for(const {entry,index} of pending){
        if(visited.has(index))continue;
        const reason=!portableTruthy(entry.enabled===undefined?true:entry.enabled)?'disabled':unsupportedLoreCondition(entry)?'unsupported condition':null;
        if(reason){audit.push({book:bookIndex,entry:index,selected:false,reason});visited.add(index);continue;}
        const sensitive=portableTruthy(entry.case_sensitive),constant=portableTruthy(entry.constant),haystack=sensitive?scan:(folded??=casefold(scan)),matches=(values:string[])=>values.some(k=>k&&haystack.includes(sensitive?k:casefold(k)));
        let active=constant||matches(keys(entry,'keys','key'));
        if(portableTruthy(entry.selective)&&!constant)active=active&&matches(keys(entry,'secondary_keys','keysecondary'));
        if(!active)continue;
        visited.add(index);const content=render(text(entry.content)),size=estimate(content),fits=size<=remaining;
        audit.push({book:bookIndex,entry:index,selected:fits,estimated_tokens:size,reason:fits?constant?'constant':'keyword':'budget exceeded'});
        if(fits){remaining-=size;selected.push({...entry,content,_book:bookIndex,_entry:index});additions.push(content);}
      }
      if(!additions.length||!portableTruthy(book.recursive_scanning))break;scan+='\n'+additions.join('\n');
    }
    for(const {index} of pending)if(!visited.has(index))audit.push({book:bookIndex,entry:index,selected:false,reason:'no keyword match'});
  });
  selected.sort((a,b)=>integer(a.insertion_order)-integer(b.insertion_order)||a._book-b._book||a._entry-b._entry);
  return {selected,audit};
}
return selectLore;
})();

function loreOutcome(select:typeof selectLore,books:Record<string,any>[],history:{role:string;content:string}[]) {
  const rendered:string[]=[];
  try{return {result:select(books,history,value=>{
    rendered.push(value);if(value==='render-error')throw Error('Fictional render failure');return value;
  }),rendered};}catch(error){return {error:{name:(error as Error).name,message:(error as Error).message},rendered};}
}
const loreHistory=(...contents:string[])=>contents.map(content=>({role:'user',content}));
const loreBook=(entries:Record<string,any>[],extra:Record<string,any>={})=>({entries,token_budget:100000,...extra});
const keyword=(key:string,extra:Record<string,any>={})=>({keys:[key],content:'selected',...extra});

it.each([
  ['surrogate pair at chunk edge',[loreBook([keyword('𐐨strasse')])],loreHistory('x'.repeat(4095)+'𐐀Straße')],
  ['fold expansion carry',[loreBook([keyword('SSTAIL')])],loreHistory('x'.repeat(4095)+'ßTAIL')],
  ['key starts inside an expansion',[loreBook([keyword('FIMORE')])],loreHistory('x'.repeat(4095)+'ﬃMORE')],
  ['sensitive carry',[loreBook([keyword('EdgeTail',{case_sensitive:true})])],loreHistory('x'.repeat(4093)+'EdgeTail')],
  ['message separator match',[loreBook([keyword('head\nTAIL')])],loreHistory('HEAD','tail')],
  ['separator prevents surrogate pairing',[loreBook([keyword('\ud801\n\udc00',{case_sensitive:true}),keyword('𐐨')])],loreHistory('\ud801','\udc00')],
  ['lone surrogates',[loreBook([keyword('\ud800x\udc00'),keyword('\ud801'),keyword('\udc28')])],loreHistory('\ud800x\udc00𐐀')],
  ['long sensitive key',[loreBook([keyword('ABC'.repeat(4000),{case_sensitive:true})])],loreHistory('z'.repeat(4090)+'ABC'.repeat(4000)+'end')],
  ['long expanding folded key',[loreBook([keyword('STRASSE'.repeat(1700))])],loreHistory('x'.repeat(4089)+'Straße'.repeat(1700))],
  ['empty base keeps leading newline',[loreBook([{constant:true,content:'first'},keyword('\nfirst')],{scan_depth:0,recursive_scanning:true})],loreHistory('ignored')],
  ['empty additions still append newline',[loreBook([{constant:true,content:''},keyword('\n')],{scan_depth:0,recursive_scanning:true})],[]],
  ['additions become visible only next pass',[loreBook([
    {constant:true,content:'start',priority:3},keyword('ω',{content:'end',priority:2}),keyword('start',{content:'Ω'})
  ],{recursive_scanning:true})],[]],
  ['disabled malformed arrays stay unreached',[loreBook([{enabled:false,keys:17,secondary_keys:{bad:true}},keyword('hello')])],loreHistory('hello')],
  ['constant skips malformed aliases and secondary',[loreBook([{constant:true,key:17,selective:true,secondary_keys:17,content:'constant'}])],[]],
  ['constant still validates explicit primary',[loreBook([{constant:true,keys:[17]}])],[]],
  ['unsupported short circuit skips malformed primary',[loreBook([{use_regex:true,keys:17},{group:'fictional',keys:17}])],[]],
  ['selective secondary stays unreached',[loreBook([keyword('missing',{selective:true,secondary_keys:17})])],loreHistory('hello')],
  ['selective secondary rejects when reached',[loreBook([keyword('hello',{selective:true,secondary_keys:[17]})])],loreHistory('hello')],
  ['secondary alias stays unreached without primary match',[loreBook([keyword('missing',{selective:true,keysecondary:17})])],loreHistory('hello')],
  ['secondary alias rejects when reached',[loreBook([keyword('hello',{selective:true,keysecondary:[17]})])],loreHistory('hello')],
  ['constant skips malformed primary and secondary aliases',[loreBook([{constant:true,key:17,selective:true,keysecondary:17,content:'constant'}])],[]],
  ['primary alias validates all members before matching',[loreBook([{key:['hello',17],content:'not selected'}])],loreHistory('hello')],
  ['recursive late validation preserves render order',[loreBook([
    {constant:true,content:'hello'},keyword('hello',{selective:true,secondary_keys:17})
  ],{recursive_scanning:true})],[]],
  ['malformed alias rejects when reached',[loreBook([{key:'bad alias'}])],[]],
  ['primary takes precedence over alias',[loreBook([{keys:[],key:['hello'],content:'not selected'}])],loreHistory('hello')],
  ['render error stays in place',[loreBook([{constant:true,content:'render-error'}, {keys:17}])],[]],
  ['budget rejection does not stop later validation',[loreBook([{constant:true,content:'too long'},{keys:17}],{token_budget:0})],[]],
  ['disabled book objects and invalid entry priorities',[null,[],{entries:[keyword('hello'),keyword('hello',{priority:'invalid'})]}],loreHistory('hello')],
] as [string,any[],{role:string;content:string}[]][])('matches frozen selected/audit/error behavior: %s',(_name,books,history)=>{
  const before=structuredClone({books,history});
  expect(loreOutcome(selectLore,books,history)).toEqual(loreOutcome(frozenSelectLore,books,history));
  expect({books,history}).toEqual(before);
});

it('does not cap long key lists or skip late malformed-key validation',()=>{
  const keys=Array.from({length:5000},(_,i)=>'missing-'+i);keys.push('last key');
  for(const primary of [keys,[...keys,17]]){
    const books=[loreBook([{keys:primary,content:'last'}])],history=loreHistory('last key');
    expect(loreOutcome(selectLore,books,history)).toEqual(loreOutcome(frozenSelectLore,books,history));
  }
  const books=[loreBook(Array.from({length:10001},()=>({enabled:false})))];
  expect(loreOutcome(selectLore,books,[])).toEqual(loreOutcome(frozenSelectLore,books,[]));
});

it('matches the frozen loop across deterministic mixed flags, priorities, Unicode and errors',()=>{
  let seed=91273;
  const next=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const strings=['','Straße','STRASSE','Ω','ω','𐐀','𐐨','茶','\ud800','\udc00','\n','ﬃ','ffi'];
  const flags=[undefined,null,false,true,[],{},''];
  for(let sample=0;sample<250;sample++){
    const history=loreHistory(...Array.from({length:next(5)},()=>strings[next(strings.length)]));
    const entries=Array.from({length:1+next(9)},()=>({
      keys:next(15)===0?[17]:Array.from({length:next(4)},()=>strings[next(strings.length)]),
      secondary_keys:next(9)===0?17:[strings[next(strings.length)]],content:strings[next(strings.length)],
      enabled:flags[next(flags.length)],constant:flags[next(flags.length)],selective:flags[next(flags.length)],
      case_sensitive:flags[next(flags.length)],priority:next(5)-2,insertion_order:next(5),use_regex:next(20)===0,
    }));
    const books=[loreBook(entries,{recursive_scanning:!!next(2),scan_depth:next(6),token_budget:next(25)})];
    expect(loreOutcome(selectLore,books,history),`sample ${sample}`).toEqual(loreOutcome(frozenSelectLore,books,history));
  }
});

it('scans the bounded history references without slicing/mapping/joining the history',()=>{
  const history=loreHistory('ignored', 'A'.repeat(13000)+'needle', 'B'.repeat(13000));
  Object.defineProperty(history[0],'content',{get(){throw Error('Outside scan depth');}});
  const books=[loreBook([keyword('needle'),keyword('needle\nB')],{scan_depth:2})];
  const expected=frozenSelectLore(books,history),raw=new Set([history[1].content,history[2].content]);
  const guarded=new Proxy(history,{get(target,key,receiver){
    if(['slice','map','join'].includes(String(key)))throw Error('Whole history array operation');
    return Reflect.get(target,key,receiver);
  }});
  const join=Array.prototype.join,spy=vi.spyOn(Array.prototype,'join').mockImplementation(function(this:unknown[],...args:any[]){
    if(this.some(value=>typeof value==='string'&&raw.has(value)))throw Error('Joined whole history content');
    return join.apply(this,args as [string?]);
  });
  let actual;try{actual=selectLore(books,guarded);}finally{spy.mockRestore();}
  expect(actual).toEqual(expected);
  const deep=loreHistory(...Array.from({length:1001},(_,i)=>String(i)));
  Object.defineProperty(deep[0],'content',{get(){throw Error('Outside maximum depth');}});
  expect(selectLore([loreBook([keyword('1000')],{scan_depth:5000})],deep))
    .toEqual(frozenSelectLore([loreBook([keyword('1000')],{scan_depth:5000})],deep));
});

it('folds bounded chunks once per sensitivity/pass rather than once per entry',()=>{
  const scan='Ż'.repeat(4*4096+29),iterator=String.prototype[Symbol.iterator],slice=String.prototype.slice;
  const probe=(count:number)=>{
    const folded:number[]=[];let sourceSlices=0;
    const iterSpy=vi.spyOn(String.prototype,Symbol.iterator).mockImplementation(function(this:string){
      const value=String(this);if(value.includes('Ż'))folded.push(value.length);return iterator.call(value);
    });
    const sliceSpy=vi.spyOn(String.prototype,'slice').mockImplementation(function(this:string,start?:number,end?:number){
      if(String(this)===scan)sourceSlices++;return slice.call(this,start,end);
    });
    try{selectLore([loreBook(Array.from({length:count},(_,i)=>keyword('NOT FOUND',{case_sensitive:!!(i%2)})))],loreHistory(scan,scan));}
    finally{iterSpy.mockRestore();sliceSpy.mockRestore();}
    return {folded,sourceSlices};
  };
  const two=probe(2),many=probe(64);
  expect(many).toEqual(two);expect(Math.max(...many.folded)).toBeLessThanOrEqual(4096);
  expect(many.folded.reduce((a,b)=>a+b,0)).toBe(2*scan.length);
  expect(many.sourceSlices).toBe(2*2*Math.ceil(scan.length/4096));
});
