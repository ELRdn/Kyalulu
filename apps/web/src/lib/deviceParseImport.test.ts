import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import cases from '../../../../tests/fixtures/device-imports.json';
import { parseDeviceImport } from './deviceParseImport';
import { base64, fromBase64, neutralPng, portableZip, pngWithText, openPortableZip, strictBase64, inflateBytes, crc32 } from './portableBinary';
import { deflateSync, deflateRawSync } from 'node:zlib';
import { acceptDeviceMedia } from './deviceAssets';

// Real decoder acceptance is exercised by the Chromium fixture; Node tests parser parity.
beforeEach(()=>vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1,height:1,close(){}}))));
afterEach(()=>vi.unstubAllGlobals());
for(const fixture of cases)it(fixture.name,async()=>{
  const parsed=await parseDeviceImport(fixture.filename,fromBase64(fixture.base64));
  expect(parsed.documents).toEqual(fixture.documents);
  expect(Object.fromEntries([...parsed.assets].map(([id,asset])=>[id,{base64:base64(asset.raw),mime:asset.mime}]))).toEqual(fixture.assets);
});
it('rejects corrupt CRCs, missing embedded assets and unsafe archive paths',async()=>{
  const png=pngWithText(neutralPng(),{chara:base64(new TextEncoder().encode('{"name":"Card"}'))}),bad=png.slice();bad[40]^=1;
  await expect(parseDeviceImport('bad.png',bad)).rejects.toThrow('CRC');
  const archive=portableZip(new Map([['card.json',new TextEncoder().encode(JSON.stringify({spec:'chara_card_v3',data:{name:'Missing',assets:[{uri:'embeded://missing.png',type:'icon'}]}}))]]));
  await expect(parseDeviceImport('missing.charx',archive)).rejects.toThrow('missing embedded');
  const unsafe=portableZip(new Map([['abcd',Uint8Array.of(1)]]));
  for(let index=0;index<unsafe.length-4;index++)if(String.fromCharCode(...unsafe.subarray(index,index+4))==='abcd')unsafe.set(new TextEncoder().encode('../x'),index);
  await expect(openPortableZip(unsafe)).rejects.toThrow('Unsafe ZIP path');
});
it('limits image pixels before decode and rejects unsupported or truncated inert media',async()=>{
  await expect(acceptDeviceMedia(new TextEncoder().encode('<svg onload="BAD"/>'))).rejects.toThrow('Unsupported');
  const huge=neutralPng().slice(),view=new DataView(huge.buffer);view.setUint32(16,32000001);view.setUint32(29,crc32(huge.subarray(12,29)));
  await expect(acceptDeviceMedia(huge)).rejects.toThrow('pixel limit');expect(createImageBitmap).not.toHaveBeenCalled();
  await expect(acceptDeviceMedia(Uint8Array.of(1))).rejects.toThrow('Unsupported');
});
it('bounds decompression, checks archive CRCs and refuses duplicate/symlink/oversized entries',async()=>{
  for(const [format,bytes] of [['deflate',deflateSync(Buffer.alloc(10000))],['deflate-raw',deflateRawSync(Buffer.alloc(10000))]] as const)await expect(inflateBytes(bytes,format,100)).rejects.toThrow('exceeds limit');
  const make=()=>portableZip(new Map([['one.txt',Uint8Array.of(1,2,3)],['two.txt',Uint8Array.of(4,5)]]));
  const corrupt=make();corrupt[37]^=1;await expect(openPortableZip(corrupt)).rejects.toThrow('CRC');
  const directory=(raw:Uint8Array)=>new DataView(raw.buffer).getUint32(raw.length-6,true);
  const symlink=make();new DataView(symlink.buffer).setUint32(directory(symlink)+38,0o120777<<16,true);await expect(openPortableZip(symlink)).rejects.toThrow('symlink');
  const oversized=make();new DataView(oversized.buffer).setUint32(directory(oversized)+24,32*1024*1024+1,true);await expect(openPortableZip(oversized)).rejects.toThrow('expansion');
  const overlap=make();new DataView(overlap.buffer).setUint32(directory(overlap)+20,42,true);await expect(openPortableZip(overlap)).rejects.toThrow('Overlapping');
  const duplicate=make();for(let i=0;i<duplicate.length-7;i++)if(new TextDecoder().decode(duplicate.subarray(i,i+7))==='two.txt')duplicate.set(new TextEncoder().encode('one.txt'),i);
  await expect(openPortableZip(duplicate)).rejects.toThrow('Duplicate');
});
it('accepts large base64 without recursive regex failure and rejects malformed padding',()=>{
  const raw=new Uint8Array(1024*1024+2);expect(strictBase64(base64(raw))).toEqual(raw);
  for(const bad of ['AA','AAAA=','AA=A','!!!!'])expect(()=>strictBase64(bad)).toThrow();
});
