import { Children, isValidElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import NativeSyncSettings from './NativeSyncSettings';
import { apiFetch } from '../lib/transport';

const fixture=vi.hoisted(()=>({language:'ja',states:[] as unknown[],next:0,confirm:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:()=>{},useRef:(initial:unknown)=>({current:initial}),useState:(initial:unknown)=>[fixture.states[fixture.next++]??initial,vi.fn()]}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language}));
vi.mock('../lib/transport',()=>({apiFetch:vi.fn()}));
vi.mock('./ui/Dialog',()=>({useConfirm:()=>[null,fixture.confirm]}));

function button(tree:ReactNode,label:string):ReactElement<any>{
  for(const node of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(node))continue;
    if(node.props.children===label)return node;
    try{return button(node.props.children,label);}catch{/* Continue with siblings. */}
  }
  throw Error('Missing button: '+label);
}
const settings={origin:'https://app.test',owner:'fixture-owner',connected:true,enabled:false,selected:['restored'],pending:true,phase:'off',error:'',restores:{restored:'review-fixture'},sessions:[{id:'restored',count:2,preview:'Restored fixture'}]};
beforeEach(()=>{
  fixture.next=0;fixture.confirm.mockReset().mockResolvedValue(false);
  fixture.states=[settings,['restored'],true,true,'',false,false,'',false,[]];
  vi.mocked(apiFetch).mockReset().mockImplementation(async()=>new Response(JSON.stringify(settings),{headers:{'Content-Type':'application/json'}}));
});

it.each(['ja','en'])('keeps restore upload behind explicit review in %s',async language=>{
  fixture.language=language;
  const tree=NativeSyncSettings(),html=renderToStaticMarkup(tree);
  expect(html).toContain(language==='en'?'restored; review required':'復元・再確認が必要');
  if(language==='en')expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  button(tree,language==='en'?'Save sync settings':'同期設定を保存').props.onClick();
  await Promise.resolve();
  expect(fixture.confirm).toHaveBeenCalledOnce();
  const warning=renderToStaticMarkup(fixture.confirm.mock.calls[0][0].description);
  expect(warning).toContain(language==='en'?'Earlier Cloud chats stay unchanged':'以前のCloud会話は変更しません');
  expect(warning).toContain('Restored fixture');
  expect(apiFetch).not.toHaveBeenCalled();
});

it('sends only the displayed owner and restore confirmation after acceptance',async()=>{
  fixture.language='en';fixture.confirm.mockResolvedValue(true);
  const tree=NativeSyncSettings();
  button(tree,'Save sync settings').props.onClick();
  await vi.waitFor(()=>expect(apiFetch).toHaveBeenCalled());
  const [path,init]=vi.mocked(apiFetch).mock.calls[0];
  expect(path).toBe('/api/local/app-sync');expect(init?.method).toBe('PUT');
  expect(JSON.parse(String(init?.body))).toMatchObject({expected_owner:'fixture-owner',selected:['restored'],consent:true,restore_confirmations:{restored:'review-fixture'}});
});

it('retains a missing selected chat as an explicit deselection choice',()=>{
  fixture.language='en';fixture.states[1]=['missing'];
  const html=renderToStaticMarkup(NativeSyncSettings());
  expect(html).toContain('Chat data is missing. Deselect it or check your backup.');
  expect(apiFetch).not.toHaveBeenCalled();
});
