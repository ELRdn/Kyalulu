import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import RuntimeSyncSettings from './RuntimeSyncSettings';
import { runtimeConsent, setSyncConsent, syncNow, syncState } from '../lib/appSync';
import { cloudFetch } from '../lib/transport';

const fixture=vi.hoisted(()=>({language:'ja',owner:'fixture-owner',currentOwner:'fixture-owner',generation:false,
  states:[] as unknown[],next:0,confirm:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{
    const index=fixture.next++;
    if(!(index in fixture.states))fixture.states[index]=typeof initial==='function'?initial():initial;
    return [fixture.states[index],(value:unknown)=>{fixture.states[index]=typeof value==='function'?value(fixture.states[index]):value;}];
  },
}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language,useDeviceOwner:()=>fixture.owner,
  deviceOwner:()=>fixture.currentOwner,useGenerationBusy:()=>fixture.generation}));
vi.mock('../lib/appSync',()=>({runtimeConsent:vi.fn(),setSyncConsent:vi.fn(),syncNow:vi.fn(),syncState:vi.fn()}));
vi.mock('../lib/transport',()=>({cloudFetch:vi.fn()}));
vi.mock('./ui/Dialog',()=>({useConfirm:()=>[null,fixture.confirm]}));
vi.mock('./SyncDeletionReview',()=>({default:()=>null}));

function view(){fixture.next=0;return RuntimeSyncSettings();}
function find(tree:ReactNode,match:(node:ReactElement<any>)=>boolean):ReactElement<any>{
  for(const node of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(node))continue;
    if(match(node))return node;
    try{return find(node.props.children,match);}catch{/* Continue with siblings. */}
  }
  throw Error('Missing control');
}
const button=(label:string)=>find(view(),node=>node.props.children===label&&typeof node.props.onClick==='function');
const checkbox=()=>find(view(),node=>node.type==='input'&&node.props.type==='checkbox');
async function settled(){await Promise.resolve();await vi.waitFor(()=>expect(fixture.states[4]).toBe(false));return view();}
async function load(){button('設定を再読み込み').props.onClick();return settled();}
function switches(japanese:string,english:string,role='status'){
  const states=[...fixture.states],calls=[...vi.mocked(runtimeConsent).mock.calls];
  const counts=[vi.mocked(setSyncConsent).mock.calls.length,vi.mocked(syncNow).mock.calls.length,vi.mocked(cloudFetch).mock.calls.length,fixture.confirm.mock.calls.length];
  expect(renderToStaticMarkup(view())).toContain(fixture.language==='en'?english:japanese);
  for(const language of ['en','ja','en']){
    fixture.language=language;
    const tree=view(),html=renderToStaticMarkup(tree);
    expect(html).toContain(language==='en'?english:japanese);
    expect(html).not.toContain(language==='en'?japanese:english);
    expect(html).toContain(`role="${role}"`);
    fixture.states.forEach((value,index)=>expect(value).toBe(states[index]));
  }
  expect(vi.mocked(runtimeConsent).mock.calls).toEqual(calls);
  expect([vi.mocked(setSyncConsent).mock.calls.length,vi.mocked(syncNow).mock.calls.length,vi.mocked(cloudFetch).mock.calls.length,fixture.confirm.mock.calls.length]).toEqual(counts);
}

beforeEach(()=>{
  vi.resetAllMocks();fixture.language='ja';fixture.owner=fixture.currentOwner='fixture-owner';fixture.generation=false;fixture.states=[];
  fixture.confirm.mockResolvedValue(true);
  vi.mocked(runtimeConsent).mockImplementation(async(_owner,update)=>({revision:update?42:41,selected:update?.selected??[],accepted:update?.consent??false}));
  vi.mocked(setSyncConsent).mockResolvedValue(undefined);vi.mocked(syncNow).mockResolvedValue(undefined);
  vi.mocked(syncState).mockReturnValue({phase:'saved',pending:0,error:''});
  vi.mocked(cloudFetch).mockResolvedValue(Response.json({sessions:[{session_id:'chat-a',character_name:'原文の会話名',count:2}]}));
});

it.each([true,false])('relabels successful sync enabled=%s without changing selections, consent or requests',async enabled=>{
  await load();checkbox().props.onChange({target:{checked:true}});
  button(enabled?'選択を保存して有効にする':'コピーと端末同期を停止').props.onClick();await settled();
  expect(runtimeConsent).toHaveBeenLastCalledWith('fixture-owner',{revision:41,selected:enabled?['chat-a']:[],consent:enabled});
  expect(setSyncConsent).toHaveBeenLastCalledWith('fixture-owner',enabled);
  expect(syncNow).toHaveBeenCalledTimes(enabled?1:0);
  switches(enabled?'同期を有効にしました。コピーは別の会話として表示します。':'Cloudとのコピーと、この端末の同期を停止しました。保存済みコピーは残ります。',
    enabled?'Sync enabled. Copies are listed separately.':'Cloud copying and sync on this device stopped. Existing copies are retained.');
  expect(checkbox().props.checked).toBe(enabled);
  expect(renderToStaticMarkup(view())).toContain('原文の会話名');
});

it('uses the current language when an in-flight sync finishes, without repeating the request',async()=>{
  await load();checkbox().props.onChange({target:{checked:true}});
  let finish!:()=>void;
  vi.mocked(syncNow).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
  button('選択を保存して有効にする').props.onClick();
  await vi.waitFor(()=>expect(syncNow).toHaveBeenCalledOnce());
  fixture.language='en';expect(find(view(),node=>node.type==='fieldset').props.disabled).toBe(true);
  expect(checkbox().props.checked).toBe(true);
  finish();await settled();
  expect(renderToStaticMarkup(view())).toContain('Sync enabled. Copies are listed separately.');
  switches('同期を有効にしました。コピーは別の会話として表示します。','Sync enabled. Copies are listed separately.');
});

it.each(['http','shape','owner'])('relabels a %s verification failure without another load',async failure=>{
  if(failure==='owner')fixture.currentOwner='other-owner';
  else vi.mocked(cloudFetch).mockResolvedValueOnce(Response.json(failure==='shape'?{}:{sessions:[]},{status:failure==='http'?503:200}));
  await load();
  switches('Cloudの会話を確認できません','Could not verify Cloud conversations','alert');
  expect(setSyncConsent).not.toHaveBeenCalled();expect(syncNow).not.toHaveBeenCalled();
  expect(fixture.currentOwner).toBe(failure==='owner'?'other-owner':'fixture-owner');
});

it('relabels missing-settings failure and partial stop guidance without granting Cloud consent',async()=>{
  button('コピーと端末同期を停止').props.onClick();await settled();
  switches('Cloud側の設定は再読み込みして確認してください。','Reload Cloud settings to confirm the server-side change.','alert');
  switches('この端末の同期は停止しました。Cloud側のコピー停止は再試行して確認してください。',
    'Sync on this device is stopped. Retry to confirm that Cloud copying is also stopped.');
  expect(setSyncConsent).toHaveBeenCalledExactlyOnceWith('fixture-owner',false);
  expect(runtimeConsent).not.toHaveBeenCalled();expect(syncNow).not.toHaveBeenCalled();
});

it.each(['load','consent','sync','stop'])('preserves raw %s diagnostics and request IDs while relabeling only local guidance',async failure=>{
  const raw='Error: 未知の診断 request_id=fixture-request-42';
  if(failure==='load')vi.mocked(runtimeConsent).mockRejectedValueOnce(Error(raw));
  await load();
  if(failure!=='load'){
    checkbox().props.onChange({target:{checked:true}});
    if(failure==='consent')vi.mocked(runtimeConsent).mockRejectedValueOnce(Error(raw));
    else if(failure==='sync')vi.mocked(syncState).mockReturnValue({phase:'error',pending:1,error:raw});
    else vi.mocked(setSyncConsent).mockRejectedValueOnce(Error(raw));
    button(failure==='stop'?'コピーと端末同期を停止':'選択を保存して有効にする').props.onClick();await settled();
  }
  const calls=[vi.mocked(runtimeConsent).mock.calls.length,vi.mocked(setSyncConsent).mock.calls.length,vi.mocked(syncNow).mock.calls.length,vi.mocked(cloudFetch).mock.calls.length];
  for(const language of ['en','ja','en']){
    fixture.language=language;
    expect(renderToStaticMarkup(find(view(),node=>node.props.role==='alert'))).toContain('Error: '+raw);
    if(failure!=='load')expect(checkbox().props.checked).toBe(true);
  }
  expect([vi.mocked(runtimeConsent).mock.calls.length,vi.mocked(setSyncConsent).mock.calls.length,vi.mocked(syncNow).mock.calls.length,vi.mocked(cloudFetch).mock.calls.length]).toEqual(calls);
  if(failure==='stop')switches('この端末の同期は停止しました。Cloud側のコピー停止は再試行して確認してください。',
    'Sync on this device is stopped. Retry to confirm that Cloud copying is also stopped.');
});

it('keeps owner and explicit consent guards across language switches',async()=>{
  await load();checkbox().props.onChange({target:{checked:true}});
  fixture.confirm.mockResolvedValueOnce(false);
  button('選択を保存して有効にする').props.onClick();await settled();
  fixture.language='en';fixture.currentOwner='other-owner';
  button('Save selection and enable').props.onClick();await settled();
  expect(runtimeConsent).toHaveBeenCalledExactlyOnceWith('fixture-owner');
  expect(setSyncConsent).not.toHaveBeenCalled();expect(syncNow).not.toHaveBeenCalled();expect(checkbox().props.checked).toBe(true);
});

it('keeps the owner fence when the account changes during confirmation',async()=>{
  await load();
  fixture.confirm.mockImplementationOnce(async()=>{fixture.currentOwner='other-owner';return true;});
  button('選択を保存して有効にする').props.onClick();await settled();
  for(const language of ['en','ja']){
    fixture.language=language;
    expect(renderToStaticMarkup(view())).toContain(language==='en'?'Account changed':'アカウントが切り替わりました');
  }
  expect(runtimeConsent).toHaveBeenCalledExactlyOnceWith('fixture-owner');
  expect(setSyncConsent).not.toHaveBeenCalled();expect(syncNow).not.toHaveBeenCalled();
});
