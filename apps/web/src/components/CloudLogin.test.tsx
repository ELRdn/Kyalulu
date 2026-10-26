import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CloudLogin from './CloudLogin';

const fixture=vi.hoisted(()=>({language:'en',states:[] as any[],refs:[] as {current:any}[],effects:[] as (()=>(()=>void)|void)[],
  next:0,ref:0,request:vi.fn(),analytics:vi.fn(),navigate:vi.fn(),assign:vi.fn(),remember:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:any)=>{const index=fixture.next++;if(fixture.states[index]===undefined)fixture.states[index]=typeof initial==='function'?initial():initial;return [fixture.states[index],(value:any)=>{fixture.states[index]=value;}];},
  useRef:(value:any)=>{const index=fixture.ref++;return fixture.refs[index]??(fixture.refs[index]={current:value});},
  useEffect:(effect:()=>void)=>{fixture.effects.push(effect);},
}));
vi.mock('react-router-dom',()=>({useNavigate:()=>fixture.navigate}));
vi.mock('../lib/cloud',()=>({cloudJson:fixture.request}));
vi.mock('../lib/analytics',()=>({analyticsConsent:fixture.analytics}));
vi.mock('../lib/cloudGuest',()=>({clearLoginReturn:vi.fn(),rememberLoginReturn:fixture.remember}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language,preferences:()=>({language:fixture.language}),
  savePreferences:(value:{language:string})=>{fixture.language=value.language;}}));

function find(tree:ReactNode,predicate:(node:ReactElement<any>)=>boolean):ReactElement<any>{
  for(const node of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(node))continue;
    if(predicate(node))return node;
    try{return find(node.props.children,predicate);}catch{}
  }
  throw Error('Missing login control');
}
function view(){fixture.next=fixture.ref=0;return CloudLogin({returnTo:'/chats/selected'});}
function submit(tree:ReactNode){find(tree,node=>node.type==='form').props.onSubmit({preventDefault:vi.fn()});}
function analytics(tree:ReactNode){return find(find(tree,node=>node.type==='label'&&Children.toArray(node.props.children).some(child=>typeof child==='string'&&child.includes('Enable usage analytics'))),node=>node.type==='input');}
beforeEach(()=>{
  vi.clearAllMocks();fixture.language='en';fixture.refs=[];fixture.effects=[];
  fixture.states=['fixture@example.test',true,'JP',true,false,null,'deepseek',{provider:'deepseek',safety:{enabled:false}},
    '2026-10-03-provider-routing-v2-deepseek-direct-generation',true,false,true,0];
  vi.stubGlobal('location',{hash:'',assign:fixture.assign});
  vi.stubGlobal('localStorage',{getItem:()=> 'fixture-eligibility'});
});
afterEach(()=>vi.unstubAllGlobals());

it('renders both languages without changing the entered email, country or consent',()=>{
  let tree=view(),html=renderToStaticMarkup(tree);
  expect(html).toContain('Sign in / Create an account');expect(html).toContain('DeepSeek V4.1 Flash');
  expect(html.replace('>日本語<','><')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  find(tree,node=>node.type==='select'&&node.props['aria-label']==='Language').props.onChange({target:{value:'ja'}});
  tree=view();html=renderToStaticMarkup(tree);expect(html).toContain('ログイン / 新規登録');
  expect(find(tree,node=>node.type==='input'&&node.props.type==='email').props.value).toBe('fixture@example.test');
  expect(find(tree,node=>node.type==='select'&&node.props['aria-label']==='居住国').props.value).toBe('JP');
  expect(fixture.states[1]).toBe(true);expect(fixture.request).not.toHaveBeenCalled();
});
it('does not start authentication while provider confirmation is unavailable',()=>{
  fixture.states[9]=false;submit(view());expect(fixture.request).not.toHaveBeenCalled();expect(fixture.remember).not.toHaveBeenCalled();
});
it('rerenders the original error code in the current language without retrying',()=>{
  fixture.states[5]={cause:Object.assign(Error('Previously rendered message'),{code:'login_cancelled'})};
  expect(renderToStaticMarkup(view())).toContain('Login was canceled');fixture.language='ja';
  expect(renderToStaticMarkup(view())).toContain('ログインをキャンセルしました');expect(fixture.request).not.toHaveBeenCalled();
});
it('keeps analytics revoked while an earlier login request completes',async()=>{
  let resolve!:(value:unknown)=>void;fixture.request.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const tree=view();fixture.effects[0]();submit(tree);
  expect(fixture.request).toHaveBeenCalledOnce();
  const body=JSON.parse(fixture.request.mock.calls[0][1].body);
  expect(body).toMatchObject({email:'fixture@example.test',country:'JP',consent:true,eligibility_ticket:'fixture-eligibility',
    operator_backend:'deepseek',provider_consent_version:fixture.states[8],provider_disclosure_version:fixture.states[8]});
  analytics(tree).props.onChange({target:{checked:false}});resolve({});
  await vi.waitFor(()=>expect(fixture.states[5]).toBe('email'));
  expect(fixture.analytics.mock.calls.map(call=>call[0])).toEqual(['denied','denied']);
  fixture.language='ja';expect(renderToStaticMarkup(view())).toContain('確認メールを送りました');expect(fixture.request).toHaveBeenCalledOnce();
});
it('uses the latest explicit analytics choice when it is enabled again before login finishes',async()=>{
  let resolve!:(value:unknown)=>void;fixture.request.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const tree=view();fixture.effects[0]();submit(tree);
  analytics(tree).props.onChange({target:{checked:false}});analytics(tree).props.onChange({target:{checked:true}});resolve({});
  await vi.waitFor(()=>expect(fixture.states[5]).toBe('email'));
  expect(fixture.analytics.mock.calls.map(call=>call[0])).toEqual(['denied','granted']);
});
it('ignores an authentication reply after the login page is left',async()=>{
  let resolve!:(value:unknown)=>void;fixture.request.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const tree=view(),cleanup=fixture.effects[0]();submit(tree);cleanup?.();resolve({url:'https://oauth.fixture.test/authorize'});
  await Promise.resolve();await Promise.resolve();
  expect(fixture.analytics).not.toHaveBeenCalled();expect(fixture.assign).not.toHaveBeenCalled();expect(fixture.states[5]).toBeNull();
});
