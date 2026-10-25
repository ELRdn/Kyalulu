/** Offline Portable adapters preserve source bytes elsewhere; no scripts/URLs execute. */
import { PortableDocumentSchema, PortableProfileSchema, PortableAssetSchema, type PortableDocument, type PortableAsset } from '../../../../packages/schemas/src';
import { MAX_PORTABLE_BYTES, openPortableZip, pngChunks, pngTexts, strictBase64 } from './portableBinary';
import { acceptDeviceMedia, imageMime } from './deviceAssets';
import { portableTruthy, unsupportedLoreCondition } from './devicePrompt';
import { Sha256 } from '../mobile/sha256';
import type { ExportAsset } from './deviceExport';

type RecordValue=Record<string,any>;
type Notice={path:string;status:'applied'|'converted'|'preserved'|'error';reason:string};
const object=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);
const utf8=(raw:Uint8Array)=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
function pyText(value:any):string {
  if(typeof value==='string')return value;
  if(value===null)return 'None';if(value===true)return 'True';if(value===false)return 'False';
  const repr=(item:any):string=>typeof item==='string'?"'"+item.replaceAll('\\','\\\\').replaceAll("'","\\'").replaceAll('\n','\\n').replaceAll('\r','\\r').replaceAll('\t','\\t')+"'":pyText(item);
  if(Array.isArray(value))return '['+value.map(repr).join(', ')+']';
  if(object(value))return '{'+Object.entries(value).map(([key,item])=>repr(key)+': '+repr(item)).join(', ')+'}';
  return String(value);
}
const note=(path:string,status:Notice['status'],reason:string):Notice=>({path,status,reason});
const json=(raw:Uint8Array)=>JSON.parse(utf8(raw));
const embedded=(uri:string)=>uri.startsWith('embeded://')||uri.startsWith('embedded://');
function dataUrl(uri:string) {
  const comma=uri.indexOf(',');if(comma<0||!uri.slice(0,comma).includes(';base64'))throw Error('Only base64 data URLs are supported');
  return strictBase64(uri.slice(comma+1).trim());
}
async function storeAsset(assets:Map<string,ExportAsset>,raw:Uint8Array,uri:string,name:string,type:string):Promise<PortableAsset> {
  const media=await acceptDeviceMedia(raw),typed=['audio','music','video'].includes(type);
  if(!media.mime.startsWith(typed?(type==='video'?'video/':'audio/'):'image/'))throw Error('Embedded media type does not match its declared use');
  assets.set(media.id,{raw:media.raw,mime:media.mime});
  return PortableAssetSchema.parse({name:name||'asset',type:type||'asset',uri:uri||'',media_type:media.mime,asset_id:media.id,...(typed?{rights_confirmed:false}:{})});
}
export function normalizeImportedLore(raw:any,prefix:string,notices:Notice[]) {
  let items:[string|number,any][];
  if(Array.isArray(raw))items=raw.map((value,index)=>[index,value]);
  else if(object(raw))items=Object.entries(raw).sort(([left],[right])=>{
    const numeric=(value:string)=>/^[+-]?\d+$/.test(value.trim())?BigInt(value.trim()):null,a=numeric(left),b=numeric(right);
    return a!==null&&b!==null?a<b?-1:a>b?1:0:a!==null?-1:b!==null?1:left<right?-1:left>right?1:0;
  });
  else throw Error('Lorebook entries must be an object or array');
  return items.map(([origin,raw],position)=>{
    if(!object(raw))throw Error('Lorebook entries must be objects');const entry=structuredClone(raw),ext=entry.extensions;
    if(object(ext))for(const key of ['useProbability','probability','delay','cooldown','sticky','selectiveLogic','matchWholeWords','excludeRecursion','preventRecursion','delayUntilRecursion','group'])if(key in ext&&!(key in entry))entry[key]=ext[key];
    const split=(value:any)=>{if(typeof value==='string')return value.split(',').map(key=>key.trim()).filter(Boolean);if(!Array.isArray(value))throw Error('Invalid Lore keys');return value.flatMap(key=>pyText(key).split(',')).map(key=>key.trim()).filter(Boolean);};
    entry.keys=split('keys' in entry?entry.keys:entry.key??[]);
    entry.secondary_keys=split('secondary_keys' in entry?entry.secondary_keys:'keysecondary' in entry?entry.keysecondary:entry.secondaryKeys??[]);
    entry.constant=portableTruthy(entry.constant??false);entry.enabled=portableTruthy('enabled' in entry?entry.enabled:!portableTruthy(entry.disable));
    entry.insertion_order='insertion_order' in entry?entry.insertion_order:entry.order??position;entry.case_sensitive='case_sensitive' in entry?entry.case_sensitive:entry.caseSensitive??false;
    entry.selective=portableTruthy(entry.selective??false);const location='position' in entry?entry.position:'after_char';entry.position=location===0||location===false?'before_char':location===1||location===true?'after_char':location;
    entry.content=pyText('content' in entry?entry.content:'');if(!('comment' in entry))entry.comment=entry.title??'';
    if(unsupportedLoreCondition(entry)&&entry.enabled){entry.enabled=false;notices.push(note(prefix+'.entries.'+origin,'converted','Unsupported advanced condition disabled (regex, probability, or time); source preserved'));}
    return entry;
  });
}
async function importRisu(risu:RecordValue,data:RecordValue,profile:RecordValue,assets:Map<string,ExportAsset>,notices:Notice[]) {
  const variables={...profile.variables};
  for(const key of ['staticVariables','defaultVariables','variables']){
    let values=risu[key];if(typeof values==='string')values=Object.fromEntries(values.split(/\r?\n/).flatMap(line=>{const match=line.match(/^([^=:\n]+)\s*[=:]\s*(.*)$/);return match?[[match[1].trim(),match[2]]]:[];}));
    if(!object(values))continue;
    for(const [name,value] of Object.entries(values))if(typeof value==='string'){if(!(name in variables))Object.defineProperty(variables,name,{value,writable:true,enumerable:true,configurable:true});}
    else notices.push(note('extensions.risuai.'+key+'.'+name,'preserved','Only static string variables are imported'));
  }
  if(Object.keys(variables).length){profile.variables=variables;notices.push(note('extensions.risuai.variables','converted','Static string variables mapped to the prompt profile'));}
  for(const [field,type] of [['emotions','emotion'],['additionalAssets','asset'],['background','background']]){
    let items=risu[field];if(items==null)continue;if(typeof items==='string'&&field==='background')items=[{name:'background',uri:items}];
    if(!Array.isArray(items)){notices.push(note('extensions.risuai.'+field,'preserved','Unsupported layout kept in source extensions'));continue;}
    for(const [index,raw] of items.entries()){
      const item=Array.isArray(raw)&&raw.length>=2?{name:raw[0],uri:raw[1]}:raw;if(!object(item))continue;
      const src=item.src??item.uri??item.url??'';if(typeof src!=='string'||!src)continue;const label=pyText(item.name??item.id??String(index)),entry={name:label,type,uri:src};
      data.assets??=[];if(!Array.isArray(data.assets))throw Error('Invalid Risu assets');
      if(!data.assets.some((asset:any)=>object(asset)&&Object.entries(entry).every(([key,value])=>asset[key]===value)))data.assets.push(entry);
      const path='extensions.risuai.'+field+'.'+label;
      if(src.startsWith('data:')){await storeAsset(assets,dataUrl(src),src,label,type);notices.push(note(path,'converted','Inline Risu asset stored by content hash'));}
      else notices.push(note(path,'preserved',embedded(src.toLowerCase())||/^https?:\/\//i.test(src)?'Risu asset reference kept without download: '+src:'Risu asset reference kept: '+src));
    }
  }
  for(const key of ['scripts','script','html','dynamicVariables','dynamic_variables','dynamicVars','triggerscript','customscript','backgroundHTML','virtualscript'])if(portableTruthy(risu[key]))notices.push(note('extensions.risuai.'+key,'preserved','Scripts, HTML, and dynamic variables are preserved without execution'));
}
async function cardDocument(input:unknown,filename:string,assets:Map<string,ExportAsset>,portrait?:Uint8Array,hint?:string):Promise<PortableDocument> {
  if(!object(input))throw Error('Character card must be a JSON object');
  const card=structuredClone(input),v3=card.spec==='chara_card_v3'||card.spec_version==='3.0',v2=card.spec==='chara_card_v2'||card.spec_version==='2.0',detected=v3?'ccv3':v2?'ccv2':'ccv1';
  if((v3||v2)&&!object(card.data))throw Error('Character card is missing its data object');
  const data:RecordValue=structuredClone(v3||v2?card.data:card),top=v3||v2?Object.fromEntries(Object.entries(card).filter(([key])=>!['spec','spec_version','data'].includes(key))):{};
  const notices=[note('card.spec','converted','Imported as '+detected)];
  for(const field of ['name','description','personality','scenario','first_mes','alternate_greetings','mes_example','system_prompt','post_history_instructions','character_book','creator','creator_notes'])if(field in data)notices.push(note('data.'+field,['creator','creator_notes'].includes(field)?'preserved':'applied',['creator','creator_notes'].includes(field)?'Creator metadata; excluded from generation':'Used as character configuration'));
  if(portableTruthy(data.extensions))notices.push(note('data.extensions','preserved','Unknown extensions are retained verbatim; only documented static fields are interpreted'));
  if(Object.keys(top).length)notices.push(note('card.top_level','preserved','Unknown top-level fields kept: '+Object.keys(top).sort().join(', ')));
  const name=pyText(data.name??'');if(!name.trim())throw Error('Character card is missing its name');
  const profile=PortableProfileSchema.parse({});let speaking='',adult=false;
  const kept=object(data.extensions)&&object(data.extensions.kyalulu)?data.extensions.kyalulu:null;
  if(kept){
    if('personality_without_style' in kept)data.personality=kept.personality_without_style;
    if('characterai_definition' in kept){data.definition=kept.characterai_definition;data.description=kept.characterai_description??'';}
    if(object(kept.v3_fields))for(const [key,value] of Object.entries(kept.v3_fields))if(!(key in data))Object.defineProperty(data,key,{value,writable:true,enumerable:true,configurable:true});
    speaking=typeof kept.speaking_style==='string'?kept.speaking_style:'';adult=portableTruthy(kept.nsfw??false);
    if(object(kept.profile)&&Object.keys(kept.profile).length){
      const parsed=PortableProfileSchema.safeParse(kept.profile);
      if(!parsed.success)notices.push(note('extensions.kyalulu.profile','preserved','Stored Kyalulu profile was malformed; live profile kept'));
      else {for(const key of ['settings','system_prompt','post_history_instructions','context_template','prompts','model_hint','variables'])if(!portableTruthy(profile[key])&&portableTruthy(parsed.data[key]))profile[key]=structuredClone(parsed.data[key]);notices.push(note('extensions.kyalulu.profile','converted','Restored prompt profile kept by a previous Kyalulu export'));}
    }
  }
  const risu=object(data.extensions)&&object(data.extensions.risuai)?data.extensions.risuai:null;let sourceFormat=hint??detected;
  if(risu&&Object.keys(risu).length){sourceFormat=hint??'risu';await importRisu(risu,data,profile,assets,notices);}
  const docAssets:PortableAsset[]=[];
  if(data.assets!=null&&!Array.isArray(data.assets))throw Error('Invalid card assets');
  for(const entry of data.assets??[]){
    if(!object(entry)||typeof entry.uri!=='string'||!entry.uri)continue;
    if(entry.uri.startsWith('data:')){
      const asset=await storeAsset(assets,dataUrl(entry.uri),entry.uri,entry.name??'asset',entry.type??'asset');docAssets.push(asset);
      notices.push(note('data.assets.'+asset.asset_id!.slice(0,8),'converted','Inline data URL asset stored by content hash'));
    }else {
      docAssets.push(PortableAssetSchema.parse({name:entry.name??'asset',type:entry.type??'asset',uri:entry.uri}));
      if(/^https?:\/\//i.test(entry.uri))notices.push(note('data.assets','preserved','Remote asset retained without downloading'));
    }
  }
  if(portrait){
    const asset=await storeAsset(assets,portrait,filename,'portrait','icon');if(!('name' in data))data.name=name;
    notices.push(note('assets.portrait','converted','Portrait stored by content hash'));docAssets.unshift(asset);
    for(let i=docAssets.length-1;i>0;i--)if(docAssets[i].uri==='ccdefault:')docAssets.splice(i,1);
  }
  if(object(data.character_book))data.character_book.entries=normalizeImportedLore(data.character_book.entries??[],'data.character_book',notices);
  const kind=kept?.kind??'character';
  return PortableDocumentSchema.parse({kind:['character','profile','lorebook'].includes(kind)?kind:'character',name:name.trim(),data,speaking_style:speaking,nsfw:portableTruthy(data.nsfw??false)||adult,profile,assets:docAssets,histories:[],source_format:sourceFormat,
    source:{filename,format:sourceFormat,card_spec:detected,original:card,top_unknown:top,...(risu&&Object.keys(risu).length?{risu:true}:{})},notices});
}
export async function parseDeviceImport(filename:string,raw:Uint8Array) {
  if(!raw.length||raw.length>MAX_PORTABLE_BYTES)throw Error('Upload is empty or exceeds 32 MiB');
  const assets=new Map<string,ExportAsset>();let documents:PortableDocument[];
  if(imageMime(raw)==='image/png'){
    const texts=await pngTexts(raw),payload=texts.get('ccv3')??texts.get('chara');if(payload===undefined)throw Error('PNG has no embedded character data');
    const card=payload.trim().startsWith('{')?JSON.parse(payload):json(strictBase64(payload.trim())),doc=await cardDocument(card,filename,assets,raw);
    for(let i=0;i<doc.assets.length;i++)if(doc.assets[i].uri.startsWith('__asset:')){
      const key='chara-ext-asset_:'+doc.assets[i].uri.slice('__asset:'.length);if(!texts.has(key))throw Error('PNG references a missing embedded asset');
      doc.assets[i]=await storeAsset(assets,strictBase64(texts.get(key)!),doc.assets[i].uri,doc.assets[i].name,doc.assets[i].type);
    }
    doc.source.png_text_fields=[...texts.keys()].sort();
    if(texts.has('ccv3')&&texts.has('chara'))doc.notices.push(note('png.ccv3','converted','Both chara and ccv3 chunks present; ccv3 preferred'));
    if(pngChunks(raw).some(chunk=>chunk.name==='acTL'))doc.notices.push(note('png.animated','converted','Animated PNG accepted; still image used as portrait'));
    documents=[doc];
  }else if(raw[0]===80&&raw[1]===75){
    const files=await openPortableZip(raw);let manifest:any;
    if(files.has('manifest.json')){try{manifest=json(files.get('manifest.json')!);}catch{/* Other archive adapters validate their own manifest. */}}
    if(object(manifest)&&manifest.format==='kyalulu_backup'){
      if(manifest.version!==1||!files.has('document.json'))throw Error('Invalid Kyalulu backup');
      const doc=PortableDocumentSchema.parse(json(files.get('document.json')!));
      for(const [name,bytes] of files){
        if(['manifest.json','document.json'].includes(name))continue;
        if(!name.startsWith('assets/')){doc.notices.push(note(name,'preserved','Unknown backup file kept without interpretation'));continue;}
        const id=name.split('/').at(-1)!;if(!/^[a-f0-9]{64}$/.test(id)||new Sha256().update(bytes).digest()!==id)throw Error('Backup asset checksum mismatch');
        const media=await acceptDeviceMedia(bytes);
        if(!media.mime.startsWith('image/')&&!doc.assets.some(asset=>asset.asset_id===id&&asset.rights_confirmed===true))throw Error('Backup media requires rights confirmation');
        assets.set(id,{raw:bytes,mime:media.mime});
      }
      if(doc.assets.some(asset=>asset.asset_id&&!assets.has(asset.asset_id)))throw Error('Backup document references missing asset');
      doc.source.backup_filename=filename;documents=[doc];
    }else{
      const cardName=['card.json','rootcard.json'].find(name=>files.has(name))??[...files.keys()].sort().find(name=>/(^|\/)(?:rootcard|card)\.json$/i.test(name));
      if(!cardName)throw Error('Archive is not a supported character card or backup');
      const doc=await cardDocument(json(files.get(cardName)!),filename,assets,undefined,'charx'),base=cardName.includes('/')?cardName.slice(0,cardName.lastIndexOf('/')+1):'',resolved=new Set<string>();
      for(let i=0;i<doc.assets.length;i++){
        const asset=doc.assets[i];if(!embedded(asset.uri))continue;const relative=asset.uri.split('://',2)[1];
        if(relative.startsWith('/')||relative.split('/').includes('..'))throw Error('Unsafe CHARX asset reference');
        const normalized=relative.split('/').filter(part=>part&&part!=='.').join('/'),bytes=files.get(base+normalized)??files.get(normalized);
        if(!bytes)throw Error('CHARX references missing embedded file');
        if(imageMime(bytes)||['audio','music','video'].includes(asset.type)){doc.assets[i]=await storeAsset(assets,bytes,asset.uri,asset.name,asset.type);resolved.add(asset.uri);}
        else doc.notices.push(note('assets.'+asset.name,'preserved','Unsupported media retained in original archive'));
      }
      doc.source.charx_card=cardName;doc.notices.push(note('charx.card','converted',`CHARX ${cardName} imported with ${resolved.size} embedded file(s)`));documents=[doc];
    }
  }else{
    const input=json(raw);if(!object(input))throw Error('Unsupported JSON import');
    // Retain the original browser adapter's raw Portable JSON route.
    const portable=!('spec' in input)&&!('spec_version' in input)&&(input.schema_version===1||input.kind||input.profile||input.histories||object(input.data)&&typeof input.name==='string');
    documents=portable?[PortableDocumentSchema.parse(input)]:[await cardDocument(input,filename,assets)];
  }
  return {documents,assets};
}
