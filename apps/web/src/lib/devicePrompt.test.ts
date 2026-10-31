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
    expect(observed).toEqual([scan,scan+'\nΩ',scan+'\nΩ\nEnd']);
  }finally{spy.mockRestore();}
});
