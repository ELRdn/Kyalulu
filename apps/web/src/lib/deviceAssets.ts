/** Inert local media validation mirrors portable_assets.py; no URL is fetched. */
import { MAX_PORTABLE_BYTES, pngChunks } from './portableBinary';
import { Sha256 } from '../mobile/sha256';
import { appTransaction, getMeta } from './appStore';
import { deviceOwner } from './appContext';
import type { PortableDocument } from '../../../../packages/schemas/src';

const ascii=(raw:Uint8Array,start:number,end:number)=>String.fromCharCode(...raw.subarray(start,end));
export function imageMime(raw:Uint8Array) {
  if(raw.length>=8&&[137,80,78,71,13,10,26,10].every((byte,i)=>raw[i]===byte))return 'image/png';
  if(raw.length>=3&&raw[0]===255&&raw[1]===216&&raw[2]===255)return 'image/jpeg';
  if(raw.length>=6&&['GIF87a','GIF89a'].includes(ascii(raw,0,6)))return 'image/gif';
  if(raw.length>=12&&ascii(raw,0,4)==='RIFF'&&ascii(raw,8,12)==='WEBP')return 'image/webp';
  return null;
}
function mp4Boxes(raw:Uint8Array,start:number,end:number,depth=0):string[] {
  if(depth>8)throw Error('MP4 nesting limit');
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),types:string[]=[];
  while(start<end){
    if(types.length>=10000||end-start<8)throw Error('Invalid MP4 boxes');
    let size=view.getUint32(start),header=8;const kind=ascii(raw,start+4,start+8);
    if(size===1){if(end-start<16)throw Error('Truncated MP4 size');const value=view.getBigUint64(start+8);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('MP4 size limit');size=Number(value);header=16;}
    if(!size)size=end-start;
    if(size<header||size>end-start)throw Error('Invalid MP4 size');const payload=start+header,stop=start+size;
    if(['moov','trak','mdia','minf','dinf','stbl'].includes(kind))mp4Boxes(raw,payload,stop,depth+1);
    if(kind==='dref'){
      if(stop-payload<8)throw Error('Invalid MP4 references');const entries=mp4Boxes(raw,payload+8,stop,depth+1);
      if(entries.length!==view.getUint32(payload+4)||entries.some(type=>type!=='url '))throw Error('External MP4 references unsupported');
    }
    if(kind==='url '&&(stop-payload!==4||view.getUint32(payload)!==1))throw Error('External MP4 references unsupported');
    types.push(kind);start=stop;
  }
  return types;
}
function validateWav(raw:Uint8Array) {
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
  if(view.getUint32(4,true)+8!==raw.length)throw Error('Invalid WAV length');
  let fmt=false,frames=false,frameSize=0;
  for(let offset=12;offset+8<=raw.length;){
    const size=view.getUint32(offset+4,true),start=offset+8;if(size>raw.length-start)throw Error('Truncated WAV');
    const type=ascii(raw,offset,offset+4);
    if(type==='fmt '){
      if(size<16)throw Error('Invalid WAV format');const codec=view.getUint16(start,true),channels=view.getUint16(start+2,true),rate=view.getUint32(start+4,true),width=Math.ceil(view.getUint16(start+14,true)/8);
      if(codec===0xfffe){const pcm=[1,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113];if(size<40||!pcm.every((byte,i)=>raw[start+24+i]===byte))throw Error('Unsupported WAV codec');}
      else if(codec!==1)throw Error('Unsupported WAV codec');
      if(channels<1||channels>8||width<1||width>4||rate<1||rate>192000)throw Error('Unsupported WAV parameters');
      frameSize=channels*width;fmt=true;
    }
    if(type==='data'){if(!fmt||size<frameSize||size%frameSize)throw Error('Invalid WAV frames');frames=true;}
    offset=start+size+(size&1);
  }
  if(!fmt||!frames)throw Error('Missing WAV audio');
}
function imagePixels(raw:Uint8Array,mime:string) {
  const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);let width=0,height=0;
  if(mime==='image/png'){
    const first=pngChunks(raw)[0];if(first.name!=='IHDR'||first.data.length!==13)throw Error('Invalid PNG dimensions');
    const header=new DataView(first.data.buffer,first.data.byteOffset,first.data.byteLength);width=header.getUint32(0);height=header.getUint32(4);
  }else if(mime==='image/gif'){
    if(raw.length<13)throw Error('Invalid GIF header');width=view.getUint16(6,true);height=view.getUint16(8,true);
    let offset=13+(raw[10]&128?3*(2**((raw[10]&7)+1)):0);
    while(offset<raw.length&&raw[offset]!==0x2c){
      if(raw[offset]!==0x21||offset+2>=raw.length)throw Error('Invalid GIF frame');offset+=2;
      while(offset<raw.length&&raw[offset]){const size=raw[offset++];if(size>raw.length-offset)throw Error('Truncated GIF extension');offset+=size;}offset++;
    }
    if(offset+10>raw.length||view.getUint16(offset+1,true)+view.getUint16(offset+5,true)>width||view.getUint16(offset+3,true)+view.getUint16(offset+7,true)>height)throw Error('GIF frame exceeds canvas');
  }else if(mime==='image/webp'){
    const kind=ascii(raw,12,16);
    if(kind==='VP8X'&&raw.length>=30){width=1+(raw[24]|raw[25]<<8|raw[26]<<16);height=1+(raw[27]|raw[28]<<8|raw[29]<<16);}
    else if(kind==='VP8L'&&raw.length>=25&&raw[20]===47){const value=view.getUint32(21,true);width=(value&0x3fff)+1;height=((value>>>14)&0x3fff)+1;}
    else if(kind==='VP8 '&&raw.length>=30&&raw[23]===157&&raw[24]===1&&raw[25]===42){width=view.getUint16(26,true)&0x3fff;height=view.getUint16(28,true)&0x3fff;}
  }else{
    for(let offset=2;offset<raw.length;){
      if(raw[offset++]!==255)throw Error('Invalid JPEG marker');while(raw[offset]===255)offset++;const marker=raw[offset++];
      if(marker===0xda||marker===0xd9)break;if(marker===1||marker>=0xd0&&marker<=0xd8)continue;
      if(offset+2>raw.length)throw Error('Truncated JPEG');const size=view.getUint16(offset);if(size<2||size>raw.length-offset)throw Error('Invalid JPEG segment');
      if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
        if(size<8)throw Error('Invalid JPEG dimensions');height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;
      }
      offset+=size;
    }
  }
  if(!width||!height||width*height>32000000)throw Error('Image pixel limit');
}
async function validateImage(raw:Uint8Array,mime:string) {
  if(raw.length>16*1024*1024)throw Error('Image exceeds 16 MiB');imagePixels(raw,mime);
  const blob=new Blob([new Uint8Array(raw)],{type:mime});
  if(typeof createImageBitmap==='function'){
    const image=await createImageBitmap(blob);try{if(!image.width||!image.height||image.width*image.height>32000000)throw Error('Image pixel limit');}finally{image.close();}
  }else{
    const image=new Image(),url=URL.createObjectURL(blob);
    try{image.src=url;await image.decode();if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>32000000)throw Error('Image pixel limit');}finally{URL.revokeObjectURL(url);}
  }
}
export async function acceptDeviceMedia(raw:Uint8Array) {
  if(!raw.length||raw.length>MAX_PORTABLE_BYTES)throw Error('Media is empty or exceeds 32 MiB');
  let mime:string;
  if(raw.length>=12&&ascii(raw,0,4)==='RIFF'&&ascii(raw,8,12)==='WAVE'){validateWav(raw);mime='audio/wav';}
  else if(raw.length>=16&&ascii(raw,4,8)==='ftyp'){
    const types=mp4Boxes(raw,0,raw.length),size=new DataView(raw.buffer,raw.byteOffset,raw.byteLength).getUint32(0);
    if(!['ftyp','moov','mdat'].every(type=>types.includes(type))||size<16||!['isom','iso2','avc1','mp41','mp42','M4V ','dash'].includes(ascii(raw,8,12)))throw Error('Unsupported MP4 container');mime='video/mp4';
  }else {const image=imageMime(raw);if(!image)throw Error('Unsupported inert media');await validateImage(raw,image);mime=image;}
  return {raw,mime,id:new Sha256().update(raw).digest()};
}

export async function readDeviceAsset(owner:string,id:string) {
  if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid asset identity');
  const stored=await getMeta<{raw:Uint8Array;mime:string}>('asset:'+owner+':'+id);
  if(owner!==deviceOwner())throw Object.assign(Error('Account changed'),{status:409});
  if(!stored||!(stored.raw instanceof Uint8Array))throw Object.assign(Error('Missing asset bytes'),{status:409});
  if(!['image/png','image/jpeg','image/gif','image/webp','audio/wav','video/mp4'].includes(stored.mime)||new Sha256().update(stored.raw).digest()!==id)throw Object.assign(Error('Stored asset checksum or MIME mismatch'),{status:409});
  return stored;
}
export async function saveDeviceAsset(owner:string,asset:{id:string;raw:Uint8Array;mime:string}) {
  await appTransaction<void>(['meta'],'readwrite',(tx,done)=>{
    if(owner!==deviceOwner())throw Object.assign(Error('Account changed'),{status:409});
    tx.objectStore('meta').put({raw:asset.raw,mime:asset.mime},'asset:'+owner+':'+asset.id);done();
  });
}
export async function validateDeviceDocumentAssets(doc:PortableDocument,owner:string) {
  for(const asset of doc.assets)if(asset.asset_id){
    const stored=await readDeviceAsset(owner,asset.asset_id);
    if(!stored.mime.startsWith('image/')&&asset.rights_confirmed!==true)throw Error('Media requires rights confirmation');
    asset.media_type=stored.mime;
  }
}
