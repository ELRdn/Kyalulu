/** Portable containers use the same limits and CRC checks as portable_binary.py. */
const encoder = new TextEncoder();
export const MAX_PORTABLE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const crcTable = Uint32Array.from({length:256}, (_, byte) => {
  let crc=byte;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;
});
export function crc32(raw:Uint8Array) {
  let crc=0xffffffff;for(const byte of raw)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;
}
export function joinBytes(parts:Uint8Array[],limit=MAX_EXPANDED_BYTES) {
  const size=parts.reduce((total,part)=>total+part.length,0);
  if(size>limit)throw Error('Portable output exceeds the size limit');
  const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}
export function base64(raw:Uint8Array) {
  const parts:string[]=[];for(let i=0;i<raw.length;i+=32768)parts.push(String.fromCharCode(...raw.subarray(i,i+32768)));return btoa(parts.join(''));
}
export const fromBase64=(value:string)=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
export const neutralPng=()=>fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC');
const magic=Uint8Array.of(137,80,78,71,13,10,26,10);
export function pngChunks(raw:Uint8Array):{name:string;data:Uint8Array}[] {
  if(raw.length<33||raw.length>MAX_PORTABLE_BYTES||!magic.every((byte,i)=>raw[i]===byte))throw Error('Invalid PNG');
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),chunks=[];let offset=8;
  while(offset+12<=raw.length){
    const length=view.getUint32(offset),end=offset+12+length;
    if(length>MAX_PORTABLE_BYTES||end>raw.length)throw Error('Truncated PNG chunk');
    const name=String.fromCharCode(...raw.subarray(offset+4,offset+8));
    if(!/^[\x21-\x7e]{4}$/.test(name)||crc32(raw.subarray(offset+4,end-4))!==view.getUint32(end-4))throw Error('Invalid PNG chunk CRC/type');
    chunks.push({name,data:raw.subarray(offset+8,end-4)});
    if(chunks.length>8192)throw Error('Too many PNG chunks');
    if(name==='IEND')return chunks;
    offset=end;
  }
  throw Error('Missing PNG IEND chunk');
}
function pngChunk(name:string,data:Uint8Array) {
  const body=joinBytes([encoder.encode(name),data]),result=new Uint8Array(data.length+12),view=new DataView(result.buffer);
  view.setUint32(0,data.length);result.set(body,4);view.setUint32(result.length-4,crc32(body));return result;
}
export function pngWithText(raw:Uint8Array,fields:Record<string,string>) {
  const parts=[magic];
  for(const chunk of pngChunks(raw)){
    if(chunk.name==='IEND'){
      for(const [key,value] of Object.entries(fields))parts.push(pngChunk('tEXt',encoder.encode(key+'\0'+value)));
    }else if(['tEXt','iTXt','zTXt'].includes(chunk.name)){
      const nul=chunk.data.indexOf(0),key=nul>0?String.fromCharCode(...chunk.data.subarray(0,nul)):'';
      if(key in fields||key==='chara'||key==='ccv3'||key.startsWith('chara-ext-asset_:'))continue;
    }
    parts.push(pngChunk(chunk.name,chunk.data));
  }
  return joinBytes(parts,MAX_PORTABLE_BYTES);
}

/** ZIP STORE works offline without a new codec dependency on any browser. */
export function portableZip(files:Map<string,Uint8Array>) {
  if(files.size>512||[...files.values()].some(raw=>raw.length>MAX_PORTABLE_BYTES))throw Error('Portable ZIP exceeds file limits');
  const parts:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
  for(const [name,raw] of files){
    if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsafe ZIP path');
    const path=encoder.encode(name);if(path.length>65535)throw Error('ZIP path too long');
    const crc=crc32(raw),local=new Uint8Array(30+path.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(12,33,true);
    lv.setUint32(14,crc,true);lv.setUint32(18,raw.length,true);lv.setUint32(22,raw.length,true);lv.setUint16(26,path.length,true);local.set(path,30);
    const central=new Uint8Array(46+path.length),cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x800,true);cv.setUint16(14,33,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,raw.length,true);cv.setUint32(24,raw.length,true);cv.setUint16(28,path.length,true);cv.setUint32(42,offset,true);central.set(path,46);
    parts.push(local,raw);directory.push(central);offset+=local.length+raw.length;
    if(offset>MAX_EXPANDED_BYTES)throw Error('Portable ZIP exceeds size limit');
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer),size=directory.reduce((total,part)=>total+part.length,0);
  view.setUint32(0,0x06054b50,true);view.setUint16(8,files.size,true);view.setUint16(10,files.size,true);view.setUint32(12,size,true);view.setUint32(16,offset,true);
  return joinBytes([...parts,...directory,end]);
}
