import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import CloudSettings from './CloudSettings';
import LocalCloudSync from './LocalCloudSync';
import { cloudJson } from '../lib/cloud';
import { apiFetch } from '../lib/transport';

const fixture=vi.hoisted(()=>({language:'en',states:[] as unknown[],next:0,confirm:vi.fn()}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),
  useEffect:()=>{},useState:(initial:unknown)=>[fixture.states[fixture.next++]??initial,vi.fn()]}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language}));
vi.mock('../lib/cloud',()=>({cloudJson:vi.fn()}));
vi.mock('../lib/transport',()=>({apiFetch:vi.fn()}));
vi.mock('../lib/accountProfile',()=>({useAccountProfile:()=>({profile:{},pending:0,error:''}),refreshAccountProfile:vi.fn()}));
vi.mock('../lib/analytics',()=>({syncAppAnalytics:()=>false}));
vi.mock('./RuntimeGate',()=>({useRuntimeAccess:()=>({cloud_mode:true})}));
vi.mock('./ui/Dialog',()=>({useConfirm:()=>[null,fixture.confirm]}));
vi.mock('./AnalyticsConsent',()=>({default:()=>null}));
vi.mock('./RuntimeSyncSettings',()=>({default:()=>null}));
vi.mock('./SyncDevices',()=>({default:()=>null}));

function button(tree:ReactNode,label:string):ReactElement<any> {
  for(const node of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(node))continue;
    if(node.props.children===label)return node;
    try{return button(node.props.children,label);}catch{/* Continue with siblings. */}
  }
  throw Error('Missing button: '+label);
}
beforeEach(()=>{fixture.next=0;fixture.states=[];fixture.confirm.mockReset().mockResolvedValue(false);vi.mocked(cloudJson).mockReset();vi.mocked(apiFetch).mockReset();});

it.each(['ja','en'])('keeps billing closed and destructive confirmation explicit in %s',async language=>{
  fixture.language=language;
  fixture.states=[false,{
    wallet:{credits:50000,used_credits:150,plan:'plus',lots:[{remaining:50000,expires:1800000000,kind:'purchase'}]},
    entitlements:{storage_bytes:250000000},storage_bytes:1000,plans:[],sync:{mode:'off'},
    billing_available:false,billing_portal_available:false,byok_configured:false,private_test:true,
    identity:{id:'fixture-account'},routes:[],
  },'','',false,false,'','',[{id:'fixture-backup',created:1700000000}]];
  const tree=CloudSettings(),html=renderToStaticMarkup(tree);
  expect(html).toContain(language==='en'?'Cloud storage':'クラウド保存');
  expect(html).toContain(language==='en'?'60 days':'60日');
  expect(html).toContain(language==='en'?'180 days':'180日');
  expect(html).not.toContain('credits_5');expect(html).not.toContain('Manage subscription and billing');
  if(language==='en')expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  button(tree,language==='en'?'Delete Cloud copy':'クラウドコピーを削除').props.onClick();
  await Promise.resolve();
  const review=fixture.confirm.mock.calls[0][0];
  expect(review.description).toContain(language==='en'?'Local data stays':'ローカルのデータは残ります');
  expect(review.description).toContain(language==='en'?'retention period':'期間満了');
  expect(cloudJson).not.toHaveBeenCalled();expect(apiFetch).not.toHaveBeenCalled();
});

it.each(['ja','en'])('renders legacy backup consent and keeps adoption behind confirmation in %s',language=>{
  fixture.language=language;
  fixture.states=[{mode:'all',selected:[],connected:true,origin:'https://app.test',revision:1},'all','','',false,false,'',false,false];
  const tree=LocalCloudSync(),html=renderToStaticMarkup(tree);
  expect(html).toContain(language==='en'?'accepted provider':'同意済み提供元');
  expect(html).toContain(language==='en'?'1 MB':'1MB');
  if(language==='en')expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  const action=button(tree,language==='en'?'Adopt Cloud version (back up local data)':'クラウド版を採用（ローカルをバックアップ）');
  const confirm=vi.fn().mockReturnValue(false);vi.stubGlobal('window',{confirm});
  try{action.props.onClick();expect(confirm).toHaveBeenCalledWith(language==='en'?'Save a separate copy of the current local data, then adopt the Cloud version?':'今のローカル版を別コピーに保存して、クラウド版を採用しますか？');expect(apiFetch).not.toHaveBeenCalled();}
  finally{vi.unstubAllGlobals();}
});

it('shows subscription quantities before secondary top-ups without starting checkout',()=>{
  fixture.language='en';
  fixture.states=[false,{wallet:{credits:0,plan:'free',lots:[]},entitlements:{storage_bytes:250000000},storage_bytes:0,
    plans:[{id:'plus',monthly_usd:5,monthly_credits:50000}],sync:{mode:'off'},billing_available:true,billing_portal_available:false},'','',false,false,'','',[]];
  const html=renderToStaticMarkup(CloudSettings());
  expect(html).toContain('plus $5/month · 50,000 K-Credits');
  expect(html).toContain('Add $5 · 37,500 K-Credits');
  expect(html.indexOf('plus $5')).toBeLessThan(html.indexOf('Add $5'));
  expect(cloudJson).not.toHaveBeenCalled();
});
