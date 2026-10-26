/** Card contents and loss notices follow python.core.portable_export. */
import { PortableDocumentSchema } from '../../../../packages/schemas/src';
import { base64, neutralPng, pngWithText, portableZip } from './portableBinary';

type Notice={path:string;status:string;reason:string};
export type ExportAsset={raw:Uint8Array;mime:string};
const encoder=new TextEncoder();
const dump=(value:unknown)=>encoder.encode(JSON.stringify(value,null,2));
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function rewrite(value:any,mapping:Map<string,string>):any {
  if(typeof value==='string')return mapping.get(value)??value;
  if(Array.isArray(value))return value.map(item=>rewrite(item,mapping));
  return record(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item,mapping)])):value;
}
export function exportPortable(input:unknown,format:string,assets:Map<string,ExportAsset>=new Map()) {
  if(!['ccv2-json','ccv3-json','ccv2-png','ccv3-png','charx','backup'].includes(format))throw Error('Unsupported export format');
  const doc=structuredClone(PortableDocumentSchema.parse(input)),notices:Notice[]=[];
  const note=(path:string,reason:string,status='converted')=>notices.push({path,status,reason});
  const stem=Array.from(Array.from(doc.name).map(character=>/[\p{L}\p{N}_ -]/u.test(character)?character:'_').join('').trim().split(/\s+/u).join('_')).slice(0,64).join('')||'character';
  for(const asset of doc.assets)if(asset.asset_id&&(!/^[a-f0-9]{64}$/.test(asset.asset_id)||!assets.has(asset.asset_id)))throw Error('Missing asset bytes; export cannot preserve the document');
  const files=new Map<string,Uint8Array>();
  if(format==='backup'){
    files.set('manifest.json',dump({format:'kyalulu_backup',version:1}));files.set('document.json',dump(doc));
    for(const asset of doc.assets)if(asset.asset_id)files.set('assets/'+asset.asset_id,assets.get(asset.asset_id)!.raw);
    return {raw:portableZip(files),mime:'application/zip',filename:stem+'.kyalulu-backup.zip',notices};
  }
  const v2=format.startsWith('ccv2'),data:Record<string,any>=doc.data;
  for(const key of ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','creator','character_version']){
    if(!(key in data))data[key]='';
    if(typeof data[key]!=='string')throw Error('Invalid character field: '+key);
  }
  data.name=doc.name;
  if(!('tags' in data))data.tags=[];if(!('alternate_greetings' in data))data.alternate_greetings=[];
  if(!('extensions' in data))data.extensions={};
  if(!record(data.extensions))throw Error('Invalid character extensions');
  if(!('kyalulu' in data.extensions))data.extensions.kyalulu={};
  if(!record(data.extensions.kyalulu))throw Error('Invalid Kyalulu extensions');
  const ext=data.extensions.kyalulu;
  Object.assign(ext,{schema_version:1,speaking_style:doc.speaking_style,nsfw:doc.nsfw,profile:doc.profile,kind:doc.kind});
  if(data.definition){
    if(typeof data.definition!=='string')throw Error('Invalid character definition');
    const definition=data.definition;delete data.definition;ext.characterai_definition=definition;ext.characterai_description=data.description;
    data.description=[data.description,definition].filter(Boolean).join('\n\n');
  }
  if(doc.profile.system_prompt&&!data.system_prompt)data.system_prompt=doc.profile.system_prompt;
  if(doc.profile.post_history_instructions&&!data.post_history_instructions)data.post_history_instructions=doc.profile.post_history_instructions;
  if(doc.speaking_style){ext.personality_without_style=data.personality;data.personality=[data.personality,doc.speaking_style].filter(Boolean).join('\n\n');}
  if(doc.kind!=='character')note('kind','Standalone profile/Lore exported as a carrier card; use backup for native library restoration');
  if(doc.histories.length)note('histories','CCv2/CCv3 cards exclude conversation history; use backup or original');
  const generationProfile=Object.keys(doc.profile.settings).length||doc.profile.prompts.length||doc.profile.context_template;
  if(generationProfile||Object.keys(doc.profile.variables).length)note('profile','Generation settings, prompt ordering and static variables are stored in Kyalulu extensions; destination apps may not apply them');
  if(data.attached_profile_lore)note('attached_profile_lore','Attached preset Lore is preserved as a Kyalulu field; use backup for faithful restoration');
  for(const notice of doc.notices)if(['preserved','error'].includes(notice.status))note(notice.path,notice.reason,'preserved');
  if(record(data.character_book)){
    const book=data.character_book;if(!('extensions' in book))book.extensions={};
    if(book.entries!==undefined&&!Array.isArray(book.entries))throw Error('Invalid Lore entries');
    for(const [index,entry] of (book.entries??[]).entries()){
      if(!record(entry))throw Error('Invalid Lore entry');
      for(const [key,value] of Object.entries({keys:[],content:'',enabled:true,insertion_order:index,extensions:{},...(!v2?{use_regex:false}:{})}))if(!(key in entry))entry[key]=value;
    }
  }
  const fields:Record<string,string>={},metas:Record<string,unknown>[]=[],mapping=new Map<string,string>();
  const portrait=doc.assets.find(asset=>asset.type==='icon'&&asset.asset_id);
  for(const asset of doc.assets){
    const meta={type:asset.type,name:asset.name,uri:asset.uri,ext:extensions[asset.media_type]??'unknown'};
    if(asset.asset_id){
      const {raw,mime}=assets.get(asset.asset_id)!,extname=extensions[mime]??'bin';meta.ext=extname;
      if(format==='charx'){const path='assets/'+asset.asset_id+'.'+extname;files.set(path,raw);meta.uri='embeded://'+path;}
      else if(format.endsWith('png')){
        if(asset===portrait)meta.uri='ccdefault:';
        else {meta.uri='__asset:'+asset.asset_id;fields['chara-ext-asset_:'+asset.asset_id]=base64(raw);}
      }else meta.uri='data:'+mime+';base64,'+base64(raw);
      if(asset.uri)mapping.set(asset.uri,meta.uri);
    }
    metas.push(meta);
  }
  data.extensions=rewrite(data.extensions,mapping);
  if(v2){
    const v3:Record<string,unknown>={};
    for(const key of ['nickname','group_only_greetings','creator_notes_multilingual','source','creation_date','modification_date'])if(key in data){v3[key]=data[key];delete data[key];}
    if(Object.keys(v3).length){data.extensions.kyalulu.v3_fields=v3;note('ccv2','V3-only fields preserved in extensions.kyalulu.v3_fields');}
    delete data.assets;
    if(doc.assets.length)note('assets','CCv2 exposes one PNG portrait; other assets remain available in CHARX/backup');
    if(generationProfile)note('profile','Generation profile is preserved in extensions; other apps may not apply it');
  }else{
    data.assets=metas;
    if(format==='ccv3-json'&&doc.assets.some(asset=>asset.asset_id))note('assets','JSON uses data URIs; use CHARX if the destination does not support them');
  }
  const top=doc.source.top_unknown??{};if(!record(top))throw Error('Invalid original top-level fields');
  if(Object.keys(top).length)note('export.top_level','Unknown top-level fields preserved','preserved');
  const card={...top,spec:v2?'chara_card_v2':'chara_card_v3',spec_version:v2?'2.0':'3.0',data};
  if(format.endsWith('json'))return {raw:dump(card),mime:'application/json',filename:stem+'.'+format+'.json',notices};
  if(format==='charx'){files.set('card.json',dump(card));return {raw:portableZip(files),mime:'application/zip',filename:stem+'.charx',notices};}
  let base:Uint8Array=neutralPng();
  if(portrait?.asset_id&&assets.get(portrait.asset_id)!.mime==='image/png')base=assets.get(portrait.asset_id)!.raw;
  else note('assets.portrait','No PNG portrait available; neutral placeholder used (original kept in backup)','preserved');
  if(v2){for(const key of Object.keys(fields))delete fields[key];fields.chara=base64(dump(card));}
  else {
    fields.ccv3=base64(dump(card));
    const fallback=structuredClone(card);fallback.spec='chara_card_v2';fallback.spec_version='2.0';delete fallback.data.assets;
    fallback.data.creator_notes+='\nBackfilled from CCv3. Use a CCv3-compatible application for all features.';fields.chara=base64(dump(fallback));
  }
  return {raw:pngWithText(base,fields),mime:'image/png',filename:stem+'.'+format+'.png',notices};
}
