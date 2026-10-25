import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RemoteSetup, { RemoteBanner, RemoteConnections } from './RemoteSetup';
import RuntimeGate, { DeviceRegistration } from './RuntimeGate';
import { friendlyMessage } from '../lib/errors';

const fixture=vi.hoisted(()=>({language:'en',target:'pc',active:null as any,
  access:{remote_mode:true,authenticated:false,device_name:'原文の端末'},
  states:[] as unknown[],next:0,updates:[] as {index:number;value:unknown}[],
  select:vi.fn(),remove:vi.fn(),devices:vi.fn(),api:vi.fn(),navigate:vi.fn(),refresh:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:vi.fn(),useCallback:(fn:unknown)=>fn,
  useContext:()=>fixture.access,useRef:(value:unknown)=>({current:value}),
  useState:(initial:unknown)=>{const index=fixture.next++;return [fixture.states[index]??(typeof initial==='function'?initial():initial),
    (value:unknown)=>fixture.updates.push({index,value})];}}));
vi.mock('../lib/appContext',async original=>({...await original<typeof import('../lib/appContext')>(),
  useLanguage:()=>fixture.language,executionTarget:()=>fixture.target}));
vi.mock('../lib/remoteStore',()=>({activeRemote:()=>fixture.active,remoteDevices:fixture.devices,deleteRemote:fixture.remove,
  restoreRemote:vi.fn(),selectRemote:fixture.select,connectionScope:()=> 'fixture-scope'}));
vi.mock('../lib/transport',()=>({apiFetch:fixture.api}));
vi.mock('../lib/cloud',()=>({setCloud:vi.fn(),setCloudOwner:vi.fn()}));
vi.mock('../lib/accountProfile',()=>({refreshAccountProfile:fixture.refresh}));
vi.mock('react-router-dom',()=>({useLocation:()=>({pathname:'/chats/fixture',search:''}),useNavigate:()=>fixture.navigate}));
vi.mock('./ConnectionSettings',()=>({default:()=>null}));
vi.mock('./CloudRouteChoice',()=>({default:()=>null}));
const device={id:'fictional-key',name:'原文の端末',hostName:'原文のPC',hostId:'host-fixture',relay:'https://relay.example.test',
  token:'PRIVATE_TOKEN_CANARY',privateKey:'PRIVATE_KEY_CANARY'};
function view(render:()=>ReactNode,states:unknown[]){fixture.next=0;fixture.states=states;return render();}
function nodes(tree:ReactNode,match:(node:ReactElement<any>)=>boolean):ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node=>!isValidElement<{children?:ReactNode}>(node)?[]:
    [...(match(node)?[node]:[]),...nodes(node.props.children,match)]);
}
beforeEach(()=>{vi.clearAllMocks();fixture.language='en';fixture.target='pc';fixture.active=null;fixture.updates=[];
  vi.stubGlobal('location',{host:'runtime.example.test'});});
afterEach(()=>vi.unstubAllGlobals());

it('keeps pairing device names and confirmation codes without exposing stored keys across languages',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(view(()=>RemoteSetup({entry:{invitation:{version:1} as any},children:<p>runtime</p>}),
      [true,'','入力途中の名前',true,'123456']));
    expect(html).toContain('入力途中の名前');expect(html).toContain('123456');
    expect(html).toContain(language==='en'?'Waiting for PC approval…':'PCの承認を待っています…');
    expect(html).toContain(language==='en'?'Only this device and the PC decrypt':'この端末とPCだけで復号');
    expect(html).not.toContain(device.token);expect(html).not.toContain(device.privateKey);
    expect(fixture.api).not.toHaveBeenCalled();expect(fixture.select).not.toHaveBeenCalled();
  }
});

it('retains destination isolation, key-revocation guidance and explicit selection in JA/EN',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(view(RemoteConnections,[[device],device,'']));
    expect(html).toContain(device.hostName);expect(html).toContain(device.name);expect(html).toContain(device.relay);
    expect(html).toContain(language==='en'?'Unsent drafts are saved separately':'未送信の下書きは接続先ごと');
    expect(html).toContain(language==='en'?'Revoke access on the PC':'PC側の登録解除');
    expect(html).not.toContain(device.token);expect(html).not.toContain(device.privateKey);
    expect(fixture.select).not.toHaveBeenCalled();expect(fixture.remove).not.toHaveBeenCalled();
  }
});

it('surfaces blocked switch and key removal without hiding the original guard diagnostic',async()=>{
  const message='Stop generation and confirm its saved result before switching.';
  fixture.select.mockImplementation(()=>{throw Error(message);});fixture.remove.mockRejectedValue(Error(message));
  const tree=view(RemoteConnections,[[device],device,'']);
  nodes(tree,node=>node.props.children==='Switch')[0].props.onClick();
  await nodes(tree,node=>node.props.children==='Remove key from this device')[0].props.onClick();
  expect(fixture.updates.filter(update=>String(update.value).includes(message))).toHaveLength(2);
  expect(friendlyMessage(message,'ja')).toContain('保存結果を確認');
  expect(friendlyMessage(message,'en')).toBe(message);
});

it('translates relay connection status while preserving authored host names',()=>{
  fixture.active=device;
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(view(RemoteBanner,[true]));
    expect(html).toContain(device.hostName);expect(html).toContain('href="#/profile"');
    expect(html).toContain(language==='en'?'Encrypted connection':'暗号化接続中');
    expect(html).toContain(language==='en'?'Conversations saved on PC':'会話はPCに保存');
    expect(html).not.toContain(device.privateKey);
  }
  fixture.target='cloud';expect(view(RemoteBanner,[true])).toBeNull();
});

it('preserves direct registration fields, digit constraints and lockout diagnostics in both languages',async()=>{
  const error='登録コードが無効になりました。サーバーで新しいコードを発行してください。';
  for(const language of ['ja','en']){
    fixture.language=language;
    const tree=view(()=>RuntimeGate({children:<p>runtime</p>}),[fixture.access,false,error,'12345678','原文の登録名']);
    const html=renderToStaticMarkup(tree);
    expect(html).toContain('12345678');expect(html).toContain('原文の登録名');
    expect(html).toContain(language==='en'?'The registration code is locked.':'登録コードが無効');
    const code=nodes(tree,node=>node.type==='input'&&node.props.inputMode==='numeric')[0];
    expect(code.props.minLength).toBe(8);expect(code.props.maxLength).toBe(8);expect(code.props.pattern).toBe('[0-9]{8}');
    expect(fixture.api).not.toHaveBeenCalled();
  }
  fixture.api.mockResolvedValue(new Response(JSON.stringify({code:'pair_locked'}),{status:403}));
  const tree=view(()=>RuntimeGate({children:null}),[fixture.access,false,'','12345678','原文の登録名']);
  await nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
  expect(fixture.api).toHaveBeenCalledWith('/api/mobile/pair',expect.objectContaining({method:'POST',body:JSON.stringify({code:'12345678',name:'原文の登録名'})}));
  expect(fixture.updates).toContainEqual({index:2,value:error});
  expect(fixture.updates).not.toContainEqual({index:3,value:''});
});

it('keeps direct-device revocation explicit and explains retained local drafts',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(view(DeviceRegistration,['',false]));
    expect(html).toContain('原文の端末');
    expect(html).toContain(language==='en'?'Drafts saved on this device are retained.':'端末に保存した下書きは残ります。');
    expect(fixture.api).not.toHaveBeenCalled();
  }
  fixture.active=device;expect(view(DeviceRegistration,['',false])).toBeNull();
});

it('translates known relay failures and preserves HTTP connection diagnostics',()=>{
  const raw='接続を確認して再試行してください（HTTP 503）。';
  expect(friendlyMessage(raw,'en')).toBe('Check the connection and try again (HTTP 503).');
  expect(friendlyMessage(raw,'ja')).toBe(raw);
  for(const raw of ['登録用QRの期限が切れました。','接続先が登録用QRと一致しません。','PCへの接続・承認がタイムアウトしました。']){
    expect(friendlyMessage(raw,'en')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(friendlyMessage(raw,'ja')).toBe(raw);
  }
});
