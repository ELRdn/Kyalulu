import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Migration from '../pages/Migration';
import DeviceSettings from './DeviceSettings';

const fixture=vi.hoisted(()=>({
  language:'ja' as 'ja'|'en',owner:'owner',states:[] as any[],refs:[] as {current:any}[],
  effects:[] as {deps:unknown[];cleanup?:()=>void}[],pending:[] as (()=>void)[],stateIndex:0,refIndex:0,effectIndex:0,
  connect:vi.fn(),parse:vi.fn(),transaction:vi.fn(),importModel:vi.fn(),download:vi.fn(),remove:vi.fn(),ready:vi.fn(),confirm:vi.fn(),draft:vi.fn(),
  model:{id:'fixture-model',name:'原文モデル',runtime:'gguf',files:[{bytes:100,sha256:'fixture'}]},
}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:any)=>{const index=fixture.stateIndex++;if(!(index in fixture.states))fixture.states[index]=typeof initial==='function'?initial():initial;
    return [fixture.states[index],(value:any)=>{fixture.states[index]=typeof value==='function'?value(fixture.states[index]):value;}];},
  useRef:(initial:any)=>fixture.refs[fixture.refIndex++]??(fixture.refs[fixture.refIndex-1]={current:initial}),
  useEffect:(effect:()=>void|(()=>void),deps:unknown[])=>{const index=fixture.effectIndex++,previous=fixture.effects[index];
    if(!previous||deps.some((dep,i)=>dep!==previous.deps[i]))fixture.pending.push(()=>{previous?.cleanup?.();fixture.effects[index]={deps,cleanup:effect()||undefined};});},
}));
vi.mock('../lib/appContext',async original=>({...await original<typeof import('../lib/appContext')>(),
  useLanguage:()=>fixture.language,useDeviceOwner:()=>fixture.owner,deviceOwner:()=>fixture.owner,
  useExecutionTarget:()=> 'device',useGenerationBusy:()=>false,preferences:()=>({language:fixture.language}),
  savePreferences:(value:{language:'ja'|'en'})=>{fixture.language=value.language;},
}));
vi.mock('../mobile/models',()=>({MODELS:[fixture.model],fingerprint:()=> 'fixture',formatBytes:(bytes:number)=>String(bytes),modelBytes:()=>100,
  readyModels:fixture.ready,downloadModel:fixture.download,removeModel:fixture.remove,importModel:fixture.importModel}));
vi.mock('../mobile/migration',()=>({parseMigration:fixture.parse}));
vi.mock('../mobile/migrationChannel',()=>({APP_ORIGIN:'https://app.kyalulu.com',MOBILE_ORIGIN:'https://mobile.kyalulu.com',
  connectMigration:fixture.connect,validateManifest:(value:unknown)=>value}));
vi.mock('../lib/appStore',()=>({appTransaction:fixture.transaction,writeEntity:vi.fn(),newEntity:vi.fn()}));
vi.mock('../lib/chatRecovery',()=>({ChatRecovery:class {key='recovery-key';read(){}draft(value:string){fixture.draft(value);}}}));
vi.mock('./ui/Dialog',()=>({useConfirm:()=>[null,fixture.confirm]}));
vi.mock('react-router-dom',()=>({Link:({to,children}:any)=><a href={to}>{children}</a>}));
vi.mock('./UnifiedEntry',()=>({Interests:()=>null}));
vi.mock('./RemoteSetup',()=>({RemoteConnections:()=>null}));
vi.mock('./RuntimeSyncSettings',()=>({default:()=>null}));

function view(component:()=>ReactNode){fixture.stateIndex=fixture.refIndex=fixture.effectIndex=0;const tree=component();fixture.pending.splice(0).forEach(effect=>effect());return tree;}
function nodes(tree:ReactNode,match:(node:ReactElement<any>)=>boolean):ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node=>!isValidElement<{children?:ReactNode}>(node)?[]:[...(match(node)?[node]:[]),...nodes(node.props.children,match)]);
}
function button(tree:ReactNode,text:string){return nodes(tree,node=>node.props.onClick&&node.props.children===text)[0];}
function switchLanguage(component:()=>ReactNode,language:'ja'|'en'){
  nodes(view(component),node=>node.type==='select')[0].props.onChange({target:{value:language}});
  return renderToStaticMarkup(view(component));
}
const parsed={sha256:'a'.repeat(64),data:{characters:[],conversations:[]}};
const info={revision:1,models:[{id:'fixture-model',fingerprint:'fixture'}]};
beforeEach(()=>{
  vi.resetAllMocks();fixture.language='ja';fixture.owner='owner';fixture.states=[];fixture.refs=[];fixture.effects=[];fixture.pending=[];
  vi.stubGlobal('location',{origin:'https://app.kyalulu.com',pathname:'/migration/'});
  vi.stubGlobal('window',{open:vi.fn(()=>({}))});vi.stubGlobal('localStorage',{getItem:()=>null});
  fixture.parse.mockReturnValue(parsed);fixture.confirm.mockResolvedValue(true);fixture.ready.mockResolvedValue(new Set());
  fixture.transaction.mockResolvedValue({sessions:[{id:'chat',draft:'原文の下書き'}],repeated:false});
});
afterEach(()=>{fixture.effects.forEach(effect=>effect.cleanup?.());vi.unstubAllGlobals();});

it('updates a pending migration notice without reconnecting or aborting the live transfer',async()=>{
  let resolve!:(reader:any)=>void;
  fixture.connect.mockImplementation(()=>new Promise(value=>{resolve=value;}));
  const pending=button(view(Migration),'以前のMobileに接続').props.onClick();
  expect(fixture.states[6]).toEqual({kind:'waiting'});
  expect(switchLanguage(Migration,'en')).toContain('Allow transfer in the Mobile window.');
  expect(switchLanguage(Migration,'ja')).toContain('Mobileの画面で転送を許可してください。');
  expect(fixture.connect).toHaveBeenCalledOnce();expect(window.open).toHaveBeenCalledOnce();
  expect(fixture.connect.mock.calls[0][3].aborted).toBe(false);
  const reader={request:vi.fn().mockResolvedValue(info),backup:vi.fn().mockResolvedValue('backup')};resolve(reader);await pending;
  expect(reader.request).toHaveBeenCalledExactlyOnceWith('manifest');expect(fixture.parse).toHaveBeenCalledExactlyOnceWith('backup');
});

it('keeps imported drafts, selected models, percentages and success status through an in-flight language switch',async()=>{
  const reader={request:vi.fn().mockResolvedValue(info),backup:vi.fn().mockResolvedValue('backup'),close:vi.fn()};fixture.connect.mockResolvedValue(reader);
  await button(view(Migration),'以前のMobileに接続').props.onClick();
  nodes(view(Migration),node=>node.props.type==='checkbox')[0].props.onChange({target:{checked:true}});
  let finish!:()=>void;
  fixture.importModel.mockImplementation((_model,_signal,_read,progress)=>{progress(25,100);return new Promise<void>(resolve=>{finish=resolve;});});
  const pending=button(view(Migration),'取り込む').props.onClick();
  await vi.waitFor(()=>expect(fixture.importModel).toHaveBeenCalledOnce());
  expect(fixture.states[3]).toBe('imported');expect(fixture.states[6]).toEqual({kind:'model',name:'原文モデル',percent:25});
  expect(fixture.draft).toHaveBeenCalledExactlyOnceWith('原文の下書き');
  for(const language of ['en','ja'] as const){
    const html=switchLanguage(Migration,language);
    expect(html).toContain(language==='en'?'Conversations imported. Original data is unchanged.':'会話を取り込みました。元のデータは変更していません。');
    expect(html).toContain('原文モデル: 25%');expect(html).toContain('checked=""');
  }
  expect(fixture.transaction).toHaveBeenCalledOnce();expect(fixture.connect).toHaveBeenCalledOnce();expect(fixture.importModel.mock.calls[0][1].aborted).toBe(false);
  finish();await pending;expect(reader.close).toHaveBeenCalledOnce();
  expect(switchLanguage(Migration,'en')).toContain('Conversations imported.');expect(fixture.draft).toHaveBeenCalledOnce();
});

it('checks migration file size before reading and localizes retained errors in both languages',async()=>{
  const read=vi.fn(),target={files:[{size:40*1024**2+1,text:read}],value:'large.json'};
  await nodes(view(Migration),node=>node.props.type==='file')[0].props.onChange({target});
  expect(target.value).toBe('');expect(read).not.toHaveBeenCalled();expect(fixture.parse).not.toHaveBeenCalled();
  expect(switchLanguage(Migration,'en')).toContain('Choose a migration file up to 40 MiB.');
  expect(switchLanguage(Migration,'ja')).toContain('移行ファイルは40 MiB以下にしてください。');
  expect(fixture.transaction).not.toHaveBeenCalled();
});

it('keeps migration cancellation and account fences without importing on a language switch',async()=>{
  fixture.connect.mockImplementation((_popup,_origin,_token,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('Migration cancelled / 移行を中止しました')),{once:true});
  }));
  const pending=button(view(Migration),'以前のMobileに接続').props.onClick();switchLanguage(Migration,'en');
  button(view(Migration),'Cancel transfer').props.onClick();await pending;
  expect(renderToStaticMarkup(view(Migration))).toContain('Migration was canceled.');
  expect(switchLanguage(Migration,'ja')).toContain('移行を中止しました。');
  const read=vi.fn(async()=>{fixture.owner='other-owner';return 'backup';});
  await nodes(view(Migration),node=>node.props.type==='file')[0].props.onChange({target:{files:[{size:1,text:read}],value:'backup.json'}});
  expect(switchLanguage(Migration,'en')).toContain('The account changed.');expect(fixture.transaction).not.toHaveBeenCalled();
});

it('retains storage-failure recovery guidance without restoring drafts or starting model transfer',async()=>{
  fixture.transaction.mockRejectedValue(Error('Device save/read failed; original data retained / 保存・読込に失敗しました。原本は保持されています'));
  await nodes(view(Migration),node=>node.props.type==='file')[0].props.onChange({target:{files:[{size:1,text:async()=> 'backup'}],value:'backup.json'}});
  await button(view(Migration),'取り込む').props.onClick();
  expect(switchLanguage(Migration,'en')).toContain('Device save/read failed. Original data is retained.');
  expect(switchLanguage(Migration,'ja')).toContain('保存・読込に失敗しました。原本は保持されています。');
  expect(fixture.transaction).toHaveBeenCalledOnce();expect(fixture.draft).not.toHaveBeenCalled();expect(fixture.importModel).not.toHaveBeenCalled();
});

it.each([
  ['保存済みファイルを検証中','verifying','Verifying saved files'],['保存済みファイルを再利用','reusing','Reusing saved files'],
  ['ダウンロード中','downloading','Downloading'],['検証・保存完了','complete','Verified and saved'],
])('stores a model progress code for %s and relabels ARIA without restarting',async(stage,code,english)=>{
  let finish!:()=>void;
  fixture.download.mockImplementation((_model,_signal,progress)=>{progress(25,100,stage);return new Promise<void>(resolve=>{finish=resolve;});});
  const pending=button(view(DeviceSettings),'ダウンロード').props.onClick();
  await vi.waitFor(()=>expect(fixture.download).toHaveBeenCalledOnce());
  expect(fixture.states[4]).toEqual({loaded:25,total:100,stage:code});
  const readyCalls=fixture.ready.mock.calls.length;
  expect(switchLanguage(DeviceSettings,'en')).toContain(`aria-label="${english}"`);
  const progress=nodes(view(DeviceSettings),node=>node.type==='progress')[0];expect(progress.props.value).toBe(25);expect(progress.props.max).toBe(100);
  expect(switchLanguage(DeviceSettings,'ja')).toContain(`aria-label="${stage}"`);
  expect(fixture.download).toHaveBeenCalledOnce();expect(fixture.ready).toHaveBeenCalledTimes(readyCalls);expect(fixture.download.mock.calls[0][1].aborted).toBe(false);
  expect(fixture.confirm.mock.calls[0][0]).toMatchObject({cancelLabel:'キャンセル'});finish();await pending;
});

it('localizes retained download failures and cancels model downloads without creating an error',async()=>{
  fixture.download.mockRejectedValueOnce(Error('端末の保存容量が不足しています。不要なモデルを削除してください。'));
  await button(view(DeviceSettings),'ダウンロード').props.onClick();
  expect(switchLanguage(DeviceSettings,'en')).toContain('Device storage is full. Remove models you no longer need.');
  expect(switchLanguage(DeviceSettings,'ja')).toContain('端末の保存容量が不足しています。不要なモデルを削除してください。');
  fixture.download.mockImplementation((_model,signal:AbortSignal)=>new Promise((_resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});
  }));
  const pending=button(view(DeviceSettings),'ダウンロード').props.onClick();await vi.waitFor(()=>expect(fixture.download).toHaveBeenCalledTimes(2));
  switchLanguage(DeviceSettings,'en');button(view(DeviceSettings),'Cancel').props.onClick();await pending;
  expect(nodes(view(DeviceSettings),node=>node.props.role==='alert')).toHaveLength(0);
});

it('preserves unknown diagnostics and model names verbatim across languages',async()=>{
  const diagnostic='Error: CUSTOM HTTP 503 Timeout: 原文の診断';fixture.download.mockRejectedValue(Error(diagnostic));
  await button(view(DeviceSettings),'ダウンロード').props.onClick();
  for(const language of ['en','ja'] as const){
    const html=switchLanguage(DeviceSettings,language);expect(html).toContain('原文モデル');expect(html).toContain('Error: '+diagnostic);
  }
});

it('localizes model removal confirmation and retained failures without repeating deletion',async()=>{
  fixture.ready.mockResolvedValue(new Set(['fixture-model']));view(DeviceSettings);await vi.waitFor(()=>expect(fixture.states[1].has('fixture-model')).toBe(true));
  fixture.language='en';fixture.remove.mockRejectedValue(Error('Web Locks required / 対応ブラウザで開いてください'));
  await button(view(DeviceSettings),'Remove').props.onClick();
  expect(fixture.confirm).toHaveBeenCalledWith(expect.objectContaining({confirmLabel:'Remove',cancelLabel:'Cancel',danger:true}));
  expect(renderToStaticMarkup(view(DeviceSettings))).toContain('Open a browser that supports Web Locks.');
  expect(switchLanguage(DeviceSettings,'ja')).toContain('Web Locksに対応したブラウザーで開いてください。');expect(fixture.remove).toHaveBeenCalledOnce();
});

it('relabels an initial model-read failure without another storage read',async()=>{
  fixture.ready.mockRejectedValue(Error('このモデルの分割配布はまだ準備中です。'));view(DeviceSettings);
  await vi.waitFor(()=>expect(fixture.states[3]).toContain('分割配布'));
  expect(switchLanguage(DeviceSettings,'en')).toContain('Sharded downloads for this model are not available yet.');expect(fixture.ready).toHaveBeenCalledOnce();
});
