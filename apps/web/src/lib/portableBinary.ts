/** Portable containers use the same limits and CRC checks as portable_binary.py. */
const encoder = new TextEncoder();
export const MAX_PORTABLE_BYTES = 32 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
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
export function strictBase64(value:string) {
  if(value.length>4*Math.ceil(MAX_PORTABLE_BYTES/3)||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('Invalid or oversized base64');
  return fromBase64(value);
}
function latin1(raw:Uint8Array) {
  const parts=[];for(let offset=0;offset<raw.length;offset+=32768)parts.push(String.fromCharCode(...raw.subarray(offset,offset+32768)));return parts.join('');
}
export async function inflateBytes(raw:Uint8Array,format:'deflate'|'deflate-raw',limit:number) {
  if(limit<0)throw Error('Expanded data exceeds limit');
  const reader=new Blob([new Uint8Array(raw)]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts:Uint8Array[]=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Expanded data exceeds limit');parts.push(value);}
  }finally{await reader.cancel().catch(()=>{});}
  return joinBytes(parts,limit);
}
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
export async function pngTexts(raw:Uint8Array) {
  const result=new Map<string,string>();let expanded=0;
  for(const chunk of pngChunks(raw)){
    if(!['tEXt','iTXt'].includes(chunk.name))continue;
    const nul=chunk.data.indexOf(0);if(nul<=0)continue;
    let key=latin1(chunk.data.subarray(0,nul)),value:string;
    if(chunk.name==='tEXt'){value=latin1(chunk.data.subarray(nul+1));expanded+=chunk.data.length;}
    else{
      const flag=chunk.data[nul+1],method=chunk.data[nul+2],language=chunk.data.indexOf(0,nul+3),translated=chunk.data.indexOf(0,language+1);
      if(language<0||translated<0||![0,1].includes(flag)||method!==0)continue;
      key=new TextDecoder().decode(chunk.data.subarray(0,nul));let text=chunk.data.subarray(translated+1);
      if(flag===1){if(text.length>8*1024*1024)continue;text=await inflateBytes(text,'deflate',MAX_PORTABLE_BYTES-expanded);}
      expanded+=text.length;value=new TextDecoder().decode(text);
    }
    if(expanded>MAX_PORTABLE_BYTES)throw Error('Expanded PNG text exceeds limit');
    if(!result.has(key))result.set(key,value);
  }
  return result;
}

const cp437='ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
/** Validate the central directory before allocating or inflating any ZIP entry. */
export async function openPortableZip(raw:Uint8Array) {
  if(!raw.length||raw.length>MAX_PORTABLE_BYTES)throw Error('ZIP upload exceeds limit');
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);let end=-1;
  for(let offset=raw.length-22;offset>=Math.max(0,raw.length-65557);offset--)if(view.getUint32(offset,true)===0x06054b50&&offset+22+view.getUint16(offset+20,true)===raw.length){end=offset;break;}
  if(end<0)throw Error('Missing ZIP directory');
  const count=view.getUint16(end+10,true),directory=view.getUint32(end+16,true),directoryEnd=directory+view.getUint32(end+12,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||view.getUint16(end+8,true)!==count||directoryEnd!==end)throw Error('Unsupported or oversized ZIP directory');
  const entries:{name:string;offset:number;size:number;compressed:number;crc:number;method:number;flags:number}[]=[],names=new Set<string>(),ranges:{start:number;end:number}[]=[];let cursor=directory,total=0;
  for(let index=0;index<count;index++){
    if(cursor+46>directoryEnd||view.getUint32(cursor,true)!==0x02014b50)throw Error('Invalid ZIP directory entry');
    const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),crc=view.getUint32(cursor+16,true),compressed=view.getUint32(cursor+20,true),size=view.getUint32(cursor+24,true);
    const length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true),next=cursor+46+length+extra+comment;
    if(next>directoryEnd||view.getUint16(cursor+34,true)||flags&1||![0,8].includes(method))throw Error('Unsupported ZIP entry');
    const encoded=raw.subarray(cursor+46,cursor+46+length),name=flags&0x800?new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(encoded):Array.from(encoded,byte=>byte<128?String.fromCharCode(byte):cp437[byte-128]).join('');
    if(names.has(name))throw Error('Duplicate ZIP entry');names.add(name);
    if(name.startsWith('/')||name.startsWith('\\')||name[1]===':'||name.includes('\0')||name.replaceAll('\\','/').split('/').includes('..')||((view.getUint32(cursor+38,true)>>>16)&0o170000)===0o120000)throw Error('Unsafe ZIP path or symlink');
    cursor=next;if(name.endsWith('/'))continue;
    const cleaned=name.replaceAll('\\','/').split('/').filter(part=>part&&part!=='.').join('/');
    if(!cleaned||entries.length>=512||entries.some(entry=>entry.name===cleaned)||size>MAX_PORTABLE_BYTES||(total+=size)>MAX_EXPANDED_BYTES)throw Error('ZIP expansion or duplicate path limit');
    if(offset+30>directory||view.getUint32(offset,true)!==0x04034b50||view.getUint16(offset+6,true)!==flags||view.getUint16(offset+8,true)!==method)throw Error('Invalid ZIP local header');
    const nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),data=offset+30+nameLength+extraLength;
    if(nameLength!==encoded.length||data+compressed>directory||!encoded.every((byte,i)=>raw[offset+30+i]===byte))throw Error('ZIP local name/size mismatch');
    if(ranges.some(range=>offset<range.end&&data+compressed>range.start))throw Error('Overlapping ZIP entries');
    ranges.push({start:offset,end:data+compressed});
    entries.push({name:cleaned,offset:data,size,compressed,crc,method,flags});
  }
  if(cursor!==directoryEnd)throw Error('ZIP directory size mismatch');
  const files=new Map<string,Uint8Array>();
  for(const entry of entries){
    const bytes=raw.subarray(entry.offset,entry.offset+entry.compressed),data=entry.method===8?await inflateBytes(bytes,'deflate-raw',entry.size):bytes;
    if(data.length!==entry.size||crc32(data)!==entry.crc)throw Error('ZIP size or CRC mismatch');files.set(entry.name,data);
  }
  return files;
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
