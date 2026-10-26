import { expect, it } from 'vitest';
import fixture from '../../../../tests/fixtures/portable-prompt.json';
import loreValues from '../../../../tests/fixtures/device-lore-values.json';
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
