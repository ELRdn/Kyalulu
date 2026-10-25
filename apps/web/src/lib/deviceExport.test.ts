import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import cases from '../../../../tests/fixtures/device-exports.json';
import { exportPortable } from './deviceExport';
import { crc32, fromBase64, pngChunks, pngWithText, portableZip, neutralPng } from './portableBinary';

const output=fileURLToPath(new URL('../../../../.artifacts/device-exports/',import.meta.url));
mkdirSync(output,{recursive:true});
writeFileSync(output+'index.json',JSON.stringify(cases.flatMap((item,index)=>Object.keys(item.outputs).map(format=>({case:index,format,file:index+'-'+format+'.bin'})))));
for(const [index,item] of cases.entries())for(const [format,expected] of Object.entries(item.outputs)){
  it(item.name+' / '+format,()=>{
    const input=structuredClone(item.document),assets=new Map(Object.entries(item.assets).map(([id,asset])=>[id,{raw:fromBase64(asset.base64!),mime:asset.mime!}]));
    const result=exportPortable(input,format,assets);
    expect(input).toEqual(item.document);expect(result.mime).toBe(expected.mime);expect(result.filename).toBe(expected.filename);expect(result.notices).toEqual(expected.notices);
    if('json' in expected)expect(JSON.parse(new TextDecoder().decode(result.raw))).toEqual(expected.json);
    if('png' in expected){
      const chunks=pngChunks(result.raw),texts:Record<string,unknown>={};
      for(const chunk of chunks)if(chunk.name==='tEXt'){
        const at=chunk.data.indexOf(0),key=new TextDecoder().decode(chunk.data.subarray(0,at)),value=new TextDecoder().decode(chunk.data.subarray(at+1));
        texts[key]=['ccv3','chara'].includes(key)?{json:JSON.parse(new TextDecoder().decode(fromBase64(value)))}:{text:value};
      }
      expect(texts).toEqual(expected.png.texts);
    }
    writeFileSync(output+index+'-'+format+'.bin',result.raw);
  });
}
it('rejects missing assets, malformed fields and unknown export formats without mutating the source',()=>{
  expect(()=>exportPortable(cases[2].document,'backup')).toThrow('Missing asset');
  expect(()=>exportPortable({name:'Bad',data:{extensions:'private malformed data'}},'ccv3-json')).toThrow('Invalid character extensions');
  expect(()=>exportPortable({name:'Bad',data:{description:42}},'ccv3-json')).toThrow('Invalid character field');
  expect(()=>exportPortable({name:'Bad'},'unknown')).toThrow('Unsupported export format');
});
it('verifies PNG CRCs, replaces old card payloads and rejects truncated/oversized containers',()=>{
  const input=neutralPng(),bad=input.slice();bad[40]^=1;
  expect(()=>pngChunks(bad)).toThrow('CRC');expect(()=>pngChunks(input.subarray(0,30))).toThrow('Invalid PNG');
  const card=pngWithText(pngWithText(input,{chara:'old',author:'retain'}),{ccv3:'new'});
  const text=pngChunks(card).filter(chunk=>chunk.name==='tEXt').map(chunk=>new TextDecoder().decode(chunk.data));
  expect(text).toEqual(['author\0retain','ccv3\0new']);
  expect(()=>portableZip(new Map([['../escape',input]]))).toThrow('Unsafe ZIP path');
  expect(()=>portableZip(new Map(Array.from({length:513},(_,i)=>[String(i),input])))).toThrow('file limits');
  expect(()=>portableZip(new Map([['oversized',new Uint8Array(32*1024*1024+1)]]))).toThrow('file limits');
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
});
