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
const stem=(filename:string,fallback='character')=>Array.from(Array.from((filename.split(/[\\/]/).at(-1)??'').replace(/\.[^.]*$/,'')).map(char=>/[\p{L}\p{N}_ -]/u.test(char)?char:'_').join('').trim().split(/\s+/u).join('_')).slice(0,64).join('')||fallback;
const get=(value:RecordValue,key:string,fallback:any)=>key in value?value[key]:fallback;
const aliases:Record<string,string>={temp:'temperature',temperature:'temperature',topp:'top_p',top_p:'top_p',topk:'top_k',top_k:'top_k',minp:'min_p',min_p:'min_p',reppen:'repeat_penalty',repeatpenalty:'repeat_penalty',repetitionpenalty:'repeat_penalty',repeat_penalty:'repeat_penalty',repeatlastn:'repeat_last_n',repeat_last_n:'repeat_last_n',freqpen:'frequency_penalty',frequencypenalty:'frequency_penalty',frequency_penalty:'frequency_penalty',prespen:'presence_penalty',presencepenalty:'presence_penalty',presence_penalty:'presence_penalty',seed:'seed',maxtokens:'max_tokens',max_tokens:'max_tokens',maxlength:'max_tokens',max_length:'max_tokens',genamt:'max_tokens',stop:'stop',stopsequence:'stop',stop_sequence:'stop'};
function samplerSettings(obj:RecordValue,notices:Notice[]) {
  const candidates=new Map<string,any>(),settings:RecordValue={};let model_hint='';
  for(const key of ['generation_settings','sampler_settings','settings','samplers'])if(object(obj[key]))for(const [name,value] of Object.entries(obj[key]))if(!candidates.has(name))candidates.set(name,value);
  for(const [name,value] of Object.entries(obj))if(!['prompts','prompt_order','entries','worldinfo','world_info','lorebook','worldInfo','story_string','context','name','system_prompt','extensions','data'].includes(name)&&!candidates.has(name))candidates.set(name,value);
  for(const [name,value] of candidates){
    const lowered=name.toLowerCase();
    if(['model','model_name','llm_model','model_hint'].includes(lowered)){
      if(typeof value==='string'&&value&&!model_hint){model_hint=value;notices.push(note('generation_settings.'+name,'converted','Model name kept as a display hint only'));}continue;
    }
    if(/url|key|endpoint|secret|token|password|proxy|host|port|api_|apikey|plugin/i.test(name)&&!Object.hasOwn(aliases,lowered.replaceAll('_',''))){notices.push(note('generation_settings.'+name,'preserved','API URL, key, and endpoint configuration is never imported'));continue;}
    const key=Object.hasOwn(aliases,lowered.replace(/[-_]/g,''))?aliases[lowered.replace(/[-_]/g,'')]:Object.hasOwn(aliases,lowered)?aliases[lowered]:undefined;
    if(key)settings[key]=value;else notices.push(note('generation_settings.'+name,'preserved','Unknown generation setting kept in source only'));
  }
  return {settings,model_hint};
}
function normalizePrompt(input:any,notices:Notice[]) {
  if(!object(input))throw Error('Prompt preset entries must be objects');const prompt=structuredClone(input),identifier=pyText(get(prompt,'identifier',get(prompt,'name','')));
  if(!identifier)throw Error('Prompt preset entry is missing its identifier');let role=get(prompt,'role','system');
  if(!['system','user','assistant'].includes(role)){notices.push(note('profile.prompts.'+identifier,'preserved','Unsupported message role kept in source'));role='system';}
  return {...prompt,identifier,role,content:pyText(get(prompt,'content',get(prompt,'system_prompt',get(prompt,'prompt','')))),marker:portableTruthy(get(prompt,'marker',true)),enabled:portableTruthy(get(prompt,'enabled',true))};
}
function stPreset(obj:RecordValue,filename:string) {
  if(!obj.prompts.length||!obj.prompt_order.length)throw Error('SillyTavern preset requires prompts and prompt_order');
  const notices=[note('preset','converted','SillyTavern prompt preset imported as a profile')];
  const selected=obj.prompt_order.find((entry:any)=>object(entry)&&entry.character_id===100)??obj.prompt_order[0];
  if(!object(selected)||!Array.isArray(selected.order)||!selected.order.length)throw Error('Invalid SillyTavern prompt_order');
  if(selected.character_id!==100)notices.push(note('preset.prompt_order','preserved','No character_id 100 block found; first prompt_order block used'));
  const byId=new Map<string,any>(),referenced=new Set<string>(),prompts:any[]=[];
  for(const prompt of obj.prompts){if(!object(prompt))throw Error('SillyTavern prompts must be objects');const id=pyText(get(prompt,'identifier',get(prompt,'name','')));if(id&&!byId.has(id))byId.set(id,prompt);}
  for(const item of selected.order){
    if(!object(item)||typeof item.identifier!=='string'||!item.identifier)throw Error('Invalid prompt_order identifier');
    if(!byId.has(item.identifier)){notices.push(note('profile.prompts.'+item.identifier,'error','prompt_order references a prompt that is not defined'));continue;}
    const prompt=normalizePrompt(byId.get(item.identifier),notices);if('enabled' in item)prompt.enabled=portableTruthy(item.enabled);prompts.push(prompt);referenced.add(item.identifier);
  }
  const leftovers=obj.prompts.filter((prompt:any)=>!referenced.has(get(prompt,'identifier',get(prompt,'name',''))||''));
  for(const raw of leftovers){try{prompts.push({...normalizePrompt(raw,notices),enabled:false});}catch(error){notices.push(note('profile.prompts','error','Skipped malformed prompt: '+(error as Error).message));}}
  if(leftovers.length)notices.push(note('profile.prompts.unreferenced','converted',`${leftovers.length} prompt(s) outside prompt_order preserved but disabled`));
  const settings=samplerSettings(obj,notices),data:RecordValue={description:''};
  for(const key of ['worldinfo','world_info','worldInfo','lorebook'])if(object(obj[key])&&(object(obj[key].entries)||Array.isArray(obj[key].entries))){data.character_book={name:get(obj[key],'name',''),entries:normalizeImportedLore(obj[key].entries,'data.character_book',notices)};notices.push(note('preset.worldinfo','converted','Embedded world info normalized to a character book'));break;}
  return PortableDocumentSchema.parse({kind:'profile',name:pyText(obj.name||stem(filename,'SillyTavern Preset')).trim()||'SillyTavern Preset',data,
    profile:{...settings,system_prompt:pyText(get(obj,'system_prompt','')),context_template:pyText(obj.story_string||get(object(obj.context)?obj.context:{},'story_string','')),prompts},
    source_format:'sillytavern_preset',source:{filename,format:'sillytavern_preset',original:obj,prompt_order_selected:get(selected,'character_id',null)},notices});
}
function caiCharacter(obj:RecordValue,filename:string) {
  const name=pyText(get(obj,'name',''));if(!name.trim())throw Error('Character.AI character is missing its name');
  const unknown=Object.keys(obj).filter(key=>!['name','description','greeting','first_mes','definition'].includes(key)).sort(),notices=[note('character.definition','converted','Character.AI definition preserved verbatim; creator notes stay out of prompt text')];
  if(unknown.length)notices.push(note('character.top_level','preserved','Unknown fields kept: '+unknown.join(', ')));
  const greeting=pyText(get(obj,'greeting',get(obj,'first_mes','')));
  return PortableDocumentSchema.parse({name:name.trim(),data:{description:pyText(get(obj,'description','')),first_mes:greeting,greeting,definition:pyText(get(obj,'definition','')),personality:'',scenario:'',creator_notes:get(obj,'creator_notes',get(obj,'creatorNotes',''))},nsfw:portableTruthy(get(obj,'nsfw',false)),source_format:'characterai',source:{filename,format:'characterai',original:obj},notices});
}
function caiLore(entries:any[],name:string,filename:string,original:any) {
  const normalized=entries.map(raw=>{
    if(!object(raw)||!('content' in raw))throw Error('Character.AI lorebook entries require content');let keys=get(raw,'key',get(raw,'keys',[]));
    if(typeof keys==='string')keys=keys.split(',').map(key=>key.trim());if(!Array.isArray(keys))throw Error('Invalid lorebook keys');
    return {comment:pyText(get(raw,'comment',get(raw,'title',''))),keys:keys.map((key:any)=>pyText(key).trim()).filter(Boolean),content:pyText(raw.content),enabled:portableTruthy(get(raw,'enabled',true))};
  });
  return PortableDocumentSchema.parse({kind:'lorebook',name:(name||stem(filename,'Lorebook')).trim()||'Lorebook',data:{character_book:{name,entries:normalized}},source_format:'characterai_lorebook',source:{filename,format:'characterai_lorebook',original},notices:[note('lorebook','converted',`Character.AI lorebook imported with ${normalized.length} entries`)]});
}
function caiText(text:string,filename:string) {
  const lines=text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);if(lines.at(-1)==='')lines.pop();
  if(lines.some(line=>/^\s*(lorebook name|entry title)\s*:/i.test(line))){
    const name=lines.find(line=>/^\s*lorebook name\s*:/i.test(line))?.replace(/^\s*lorebook name\s*:/i,'').trim()||stem(filename,'Lorebook'),blocks:string[][]=[];
    for(const line of lines){const title=line.match(/^\s*entry title\s*:(.*)$/i);if(title)blocks.push([title[1].trim()]);else blocks.at(-1)?.push(line);}
    if(!blocks.length)throw Error('Character.AI lorebook text has no entries');
    const entries=blocks.map(block=>{
      let key:string[]=[],content:string|undefined;
      for(let i=1;i<block.length;i++){const keywords=block[i].match(/^\s*keywords\s*:(.*)$/i),body=block[i].match(/^\s*content\s*:(.*)$/i);if(keywords&&!key.length)key=keywords[1].split(',').map(item=>item.trim()).filter(Boolean);if(body){content=[body[1],...block.slice(i+1)].join('\n').trim();break;}}
      if(content===undefined)throw Error('Character.AI lorebook entry is missing its Content');return {comment:block[0],key,content};
    });return caiLore(entries,name,filename,{text});
  }
  const positions=new Map<string,{index:number;value:string}>();
  for(const [index,line] of lines.entries()){const match=line.match(/^\s*(name|description|greeting|definition)\s*:(.*)$/i);if(match&&!positions.has(match[1].toLowerCase()))positions.set(match[1].toLowerCase(),{index,value:match[2]});}
  if(!positions.has('name'))throw Error('Character.AI pasted text requires a Name label');
  const definition=positions.get('definition')?.index??lines.length,fields=[...positions].filter(([,field])=>field.index<=definition).sort(([,a],[,b])=>a.index-b.index),obj:RecordValue={description:'',greeting:'',definition:''};
  for(let i=0;i<fields.length;i++){
    const [key,field]=fields[i];if(key!=='definition')obj[key]=[field.value,...lines.slice(field.index+1,fields[i+1]?.[1].index??lines.length)].join('\n').trim();
    else {const original=text.match(/[^\r\n\v\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]|$)/g)??[],offset=original.slice(0,field.index).join('').length;let body=text.slice(offset+original[field.index].indexOf(':')+1);if(/^[ \t]/.test(body))body=body.slice(1);if(body.startsWith('\r\n'))body=body.slice(2);else if(body.startsWith('\n'))body=body.slice(1);obj[key]=body;}
  }
  const doc=caiCharacter(obj,filename);doc.source.pasted=true;return doc;
}
const looksLikeCaiLore=(entries:any[])=>entries.length>0&&entries.slice(0,3).every(entry=>object(entry)&&'content' in entry&&['comment','key','keys'].some(key=>key in entry));
function byafTimestamp(text:any) {
  // shortcut: accept calendar ISO dates with minute offsets; extend only with shared timestamp fixtures.
  if(typeof text!=='string')throw Error('BYAF timestamp must be a string');
  const match=text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})$/);
  if(!match)throw Error('BYAF timestamp requires an ISO date and timezone');
  const [year,month,day,hour,minute,second]=match.slice(1,7).map(value=>Number(value??0)),days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>59)throw Error('Invalid BYAF timestamp');
  const millis=Date.parse(text);if(!Number.isFinite(millis))throw Error('Invalid BYAF timezone');
  return BigInt(millis)*1000n+BigInt((match[7]??'').padEnd(6,'0').slice(3));
}
async function byafDocuments(files:Map<string,Uint8Array>,assets:Map<string,ExportAsset>) {
  const read=(path:any):RecordValue=>{if(typeof path!=='string'||!files.has(path))throw Error('BYAF manifest references a missing file');const value=json(files.get(path)!);if(!object(value)||value.schemaVersion!==1)throw Error('BYAF requires schemaVersion 1');return value;};
  const required=(value:any,fields:Record<string,string>)=>{
    if(!object(value))throw Error('BYAF entry must be an object');
    for(const [key,type] of Object.entries(fields))if(!(key in value)||(type==='array'?!Array.isArray(value[key]):type==='number'?!(typeof value[key]==='number'||typeof value[key]==='boolean'):typeof value[key]!==type))throw Error('BYAF field '+key+' is missing or invalid');
  };
  const manifest=read('manifest.json');required(manifest,{createdAt:'string',characters:'array',scenarios:'array'});byafTimestamp(manifest.createdAt);
  if(manifest.characters.length!==1||!manifest.scenarios.length)throw Error('BYAF v1 requires one character and at least one scenario');
  const characterPath=manifest.characters[0];if(typeof characterPath!=='string'||!/^characters\/[^/]+\/character\.json$/.test(characterPath))throw Error('Invalid BYAF character path');
  const char=read(characterPath);required(char,{id:'string',name:'string',displayName:'string',persona:'string',isNSFW:'boolean',createdAt:'string',updatedAt:'string',loreItems:'array',images:'array'});
  if(char.id!==characterPath.split('/')[1])throw Error('BYAF character ID and directory differ');byafTimestamp(char.createdAt);byafTimestamp(char.updatedAt);
  const charAssets:PortableAsset[]=[];
  for(const [index,image] of char.images.entries()){
    required(image,{path:'string',label:'string'});if(!/^images\/[^/]+\.(png|jpg|jpeg|webp|gif)$/i.test(image.path))throw Error('Invalid BYAF image path');
    const ref=characterPath.slice(0,characterPath.lastIndexOf('/')+1)+image.path,raw=files.get(ref);if(!raw)throw Error('BYAF image missing');charAssets.push(await storeAsset(assets,raw,ref,image.label,index===0?'icon':'emotion'));
  }
  const lore=char.loreItems.map((entry:any,index:number)=>{required(entry,{key:'string',value:'string'});return {keys:[entry.key],content:entry.value,enabled:true,insertion_order:index,use_regex:false,extensions:{}};}),documents:PortableDocument[]=[];
  for(const path of manifest.scenarios){
    if(typeof path!=='string'||!/^scenarios\/[^/]+\.json$/.test(path))throw Error('Invalid BYAF scenario path');
    const scenario=read(path);required(scenario,{formattingInstructions:'string',minP:'number',minPEnabled:'boolean',temperature:'number',repeatPenalty:'number',repeatLastN:'number',topK:'number',topP:'number',exampleMessages:'array',canDeleteExampleMessages:'boolean',firstMessages:'array',narrative:'string',messages:'array'});
    if(!('promptTemplate' in scenario)||!('grammar' in scenario)||scenario.firstMessages.length>1)throw Error('Invalid BYAF scenario formatting or firstMessages');
    const title=scenario.title||path.slice('scenarios/'.length,-5);if(typeof title!=='string')throw Error('Invalid BYAF title');
    const notices=[note('byaf','converted','BYAF v1 character and scenario combined; source retained')];
    for(const key of ['promptTemplate','grammar'])if(portableTruthy(scenario[key]))notices.push(note('scenario.'+key,'preserved','Model-specific formatting is stored, not executed'));
    const settings:RecordValue={temperature:scenario.temperature,repeat_penalty:scenario.repeatPenalty,repeat_last_n:scenario.repeatLastN,top_k:scenario.topK,top_p:scenario.topP};if(scenario.minPEnabled)settings.min_p=scenario.minP;
    const examples=scenario.exampleMessages.map((entry:any)=>{required(entry,{characterID:'string',text:'string'});return (entry.characterID===char.id?'{{char}}':'{{user}}')+': '+entry.text;});let first='';
    if(scenario.firstMessages.length){const greeting=scenario.firstMessages[0];required(greeting,{characterID:'string',text:'string'});if(greeting.characterID!==char.id)throw Error('BYAF greeting references an unknown character');first=greeting.text;}
    const messages=scenario.messages.map((message:any,index:number)=>{
      if(!object(message))throw Error('Invalid BYAF history message');let chosen:RecordValue;
      if(message.type==='human'){required(message,{text:'string',createdAt:'string',updatedAt:'string'});chosen=message;}
      else if(message.type==='ai'){
        if(!Array.isArray(message.outputs)||!message.outputs.length)throw Error('BYAF AI message has no outputs');
        for(const output of message.outputs){required(output,{text:'string',createdAt:'string',updatedAt:'string',activeTimestamp:'string'});byafTimestamp(output.activeTimestamp);}
        chosen=message.outputs.reduce((left:any,right:any)=>byafTimestamp(right.activeTimestamp)>=byafTimestamp(left.activeTimestamp)?right:left);
      }else throw Error('BYAF history contains an unsupported message type');
      byafTimestamp(chosen.createdAt);byafTimestamp(chosen.updatedAt);
      return {role:message.type==='human'?'user':'assistant',content:chosen.text,created_at:chosen.createdAt,origin:{source:'byaf',scenario:path,index,original:message,selected_active_timestamp:get(chosen,'activeTimestamp',null)}};
    });
    const docAssets=structuredClone(charAssets);
    if(scenario.backgroundImage){
      if(typeof scenario.backgroundImage!=='string')throw Error('Invalid BYAF background');const ref=scenario.backgroundImage,raw=files.get(ref)??files.get(path.slice(0,path.lastIndexOf('/')+1)+ref);
      if(!raw)throw Error('BYAF background image missing');docAssets.push(await storeAsset(assets,raw,ref,title,'background'));
    }
    const author=manifest.author||{};if(!object(author))throw Error('Invalid BYAF author');
    documents.push(PortableDocumentSchema.parse({name:(char.displayName||char.name)+(manifest.scenarios.length>1?' · '+title:''),data:{name:char.name,nickname:char.name,description:char.persona,scenario:scenario.narrative,first_mes:first,mes_example:examples.join('\n'),creator:get(author,'name',''),character_book:{entries:lore,extensions:{}}},nsfw:char.isNSFW,
      profile:{settings,system_prompt:scenario.formattingInstructions,model_hint:get(scenario,'model','')},assets:docAssets,histories:messages.length?[{name:title,messages}]:[],source_format:'byaf',
      source:{original:{manifest,character:char,scenario},scenario_path:path,spec_revision:'7ebf2fdbb06a36b4f900a8de45480c4a2965df03'},notices}));
  }
  return documents;
}
async function jsonDocument(input:any,filename:string,assets:Map<string,ExportAsset>) {
  if(Array.isArray(input)){if(looksLikeCaiLore(input))return caiLore(input,stem(filename,'Lorebook'),filename,input);throw Error('Unsupported JSON import');}
  if(!object(input))throw Error('Unsupported JSON import');
  const portable=!('spec' in input)&&!('spec_version' in input)&&(input.schema_version===1||input.kind||input.profile||input.histories||object(input.data)&&typeof input.name==='string');
  if(portable)return PortableDocumentSchema.parse(input);
  if((['story_string','system_prompt','input_sequence','output_sequence','temperature','temp','top_p','top_k'].some(key=>key in input)||'content' in input&&'name' in input&&!('description' in input))&&!['spec','description','first_mes','definition','prompts'].some(key=>key in input)){
    const notices=[note('preset','converted','Standalone SillyTavern profile imported')],settings=samplerSettings(input,notices);
    return PortableDocumentSchema.parse({kind:'profile',name:input.name||stem(filename),profile:{...settings,system_prompt:get(input,'system_prompt',get(input,'content','')),context_template:get(input,'story_string',''),post_history_instructions:get(input,'post_history_instructions','')},source_format:'sillytavern_preset',source:{original:input},notices});
  }
  if(Array.isArray(input.prompts)&&Array.isArray(input.prompt_order))return stPreset(input,filename);
  if(object(input.entries)||Array.isArray(input.entries)){
    if(Array.isArray(input.entries)&&looksLikeCaiLore(input.entries))return caiLore(input.entries,input.name||stem(filename,'Lorebook'),filename,input);
    const notices:Notice[]=[],entries=normalizeImportedLore(input.entries,'data.character_book',notices),reason=Array.isArray(input.entries)?'World entries imported as a lorebook':'SillyTavern world info imported as a lorebook';
    return PortableDocumentSchema.parse({kind:'lorebook',name:pyText(input.name||stem(filename,'World Info')).trim()||'World Info',data:{character_book:{name:get(input,'name',''),entries}},source_format:'sillytavern_worldinfo',source:{filename,format:'sillytavern_worldinfo',original:input},notices:[note('lorebook','converted',reason),...notices]});
  }
  if(!('spec' in input)&&!('spec_version' in input)&&!(object(input.data)||object(input.extensions)&&'risuai' in input.extensions)&&('greeting' in input||'definition' in input))return caiCharacter(input,filename);
  return cardDocument(input,filename,assets);
}
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
  const name=pyText(get(data,'name',''));if(!name.trim())throw Error('Character card is missing its name');
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
      if(!cardName){if(files.has('manifest.json'))return {documents:await byafDocuments(files,assets),assets};throw Error('Archive is not a supported character card or backup');}
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
    const text=utf8(raw);let input:any;
    try{input=JSON.parse(text);}catch{documents=[caiText(text,filename)];return {documents,assets};}
    documents=[await jsonDocument(input,filename,assets)];
  }
  return {documents,assets};
}
