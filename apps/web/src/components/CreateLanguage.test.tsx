import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Create from '../pages/Create';
import ImportSource from './ImportSource';
import UrlImportBox from './UrlImportBox';
import { PortableDocumentSchema } from '../lib/library';
import { friendlyMessage } from '../lib/errors';

const fixture=vi.hoisted(()=>({language:'en',cloud:false,administrative:false,params:new URLSearchParams(),
  states:[] as unknown[],next:0,updates:[] as {index:number;value:unknown}[],
  fetch:vi.fn(),save:vi.fn(),preview:vi.fn(),request:vi.fn(),navigate:vi.fn(),query:vi.fn(),
  confirm:vi.fn(),commit:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useEffect:vi.fn(),useRef:(value:unknown)=>({current:value}),
  useState:(initial:unknown)=>{const index=fixture.next++;return [fixture.states[index]??(typeof initial==='function'?initial():initial),
    (value:unknown)=>fixture.updates.push({index,value})];}}));
vi.mock('../lib/appContext',async original=>({...await original<typeof import('../lib/appContext')>(),useLanguage:()=>fixture.language}));
vi.mock('../lib/capabilities',()=>({useCapabilities:()=>({capabilities:{features:{community:false}}})}));
vi.mock('../lib/title',()=>({useDocumentTitle:vi.fn()}));
vi.mock('../lib/adult',()=>({useAdultContent:()=>[false]}));
vi.mock('../lib/cloudMode',()=>({cloudOwner:()=> 'fictional-owner'}));
vi.mock('../lib/remoteStore',()=>({scopedKey:(key:string)=>key+':fixture-owner'}));
vi.mock('../lib/library',async original=>({...await original<typeof import('../lib/library')>(),
  fetchLibrary:fixture.fetch,saveLibraryItem:fixture.save,commitImport:fixture.commit,libraryRequest:fixture.request}));
vi.mock('../lib/hubs',async original=>({...await original<typeof import('../lib/hubs')>(),previewUrl:fixture.preview}));
vi.mock('./RuntimeGate',()=>({useRuntimeAccess:()=>({cloud_mode:fixture.cloud}),useAdministrative:()=>fixture.administrative}));
vi.mock('react-router-dom',()=>({useSearchParams:()=>[fixture.params,fixture.query],useNavigate:()=>fixture.navigate,
  Link:({to,children,...props}:any)=><a href={to} {...props}>{children}</a>}));
vi.mock('./ui/Dialog',()=>({default:({open,children}:any)=>open?<div>{children}</div>:null,useConfirm:()=>[null,fixture.confirm]}));
vi.mock('./PortableEditor',()=>({default:({document}:any)=><p>{document.name}</p>}));
vi.mock('./HubLinks',()=>({default:()=>null}));
vi.mock('./PublishWorkButton',()=>({default:()=>null}));
vi.mock('./PublicationSubmit',()=>({default:()=>null}));
vi.mock('./RuntimeMedia',()=>({RuntimeDownload:({href,children}:any)=><a data-runtime-download={href}>{children}</a>}));
const document=PortableDocumentSchema.parse({name:'原文のプロット',data:{description:'Original text',unknown:{retained:true}}});
const item={id:'fictional-item',document,revision:4,original_id:'fictional-original'};
const suffix=' この下書きと保存IDは残っています。内容を変えずに再保存すると同じ保存IDで結果を確認します。内容を変える前にライブラリの保存結果を確認してください。';
function view(render:()=>ReactNode,states:unknown[]){fixture.next=0;fixture.states=states;return render();}
function workspace(patch:Record<number,unknown>={}){
  const states:unknown[]=[false,false,'new-character',null,[item],false,false,'',null,[],undefined,false,null,'',false,{},'',[],null,'ccv3-json',null];
  for(const [index,value] of Object.entries(patch))states[Number(index)]=value;
  return view(()=>{const page=Create();return (page.type as any)(page.props);},states);
}
function nodes(tree:ReactNode,match:(node:ReactElement<any>)=>boolean):ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node=>!isValidElement<{children?:ReactNode}>(node)?[]:
    [...(match(node)?[node]:[]),...nodes(node.props.children,match)]);
}
beforeEach(()=>{vi.clearAllMocks();fixture.language='en';fixture.cloud=false;fixture.administrative=false;fixture.params=new URLSearchParams();fixture.updates=[];
  const stored=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>stored.set(key,value),removeItem:(key:string)=>stored.delete(key)});
});
afterEach(()=>vi.unstubAllGlobals());

it('translates library controls while retaining item IDs, versions and authored text',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(workspace());
    expect(html).toContain(document.name);expect(html).toContain(language==='en'?'Version 4':'版4');
    expect(html).toContain(language==='en'?'Retrieve URLs on the PC':'URLからの取得はサーバー側のPC');
    expect(fixture.fetch).not.toHaveBeenCalled();expect(fixture.save).not.toHaveBeenCalled();
  }
});

it('retains draft/uncertain-save warnings and live notices in either language',()=>{
  fixture.params=new URLSearchParams('edit=new');
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(workspace({12:document,13:'Error: Failed to fetch'+suffix,16:{kind:'draft'}}));
    expect(html).toContain(language==='en'?'This draft and its save ID are retained':'この下書きと保存IDは残っています');
    expect(html).toContain(language==='en'?'A temporary draft was saved in this browser':'一時下書きをこのブラウザーに保存しました');
    expect(html).toContain(document.name);expect(fixture.save).not.toHaveBeenCalled();
  }
});

it('retains original export format IDs and the pinned revision across language switches',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(workspace({18:item,20:{notices:[],filename:'original-name.json'}}));
    expect(html).toContain(`/api/library/${item.id}/export?format=ccv3-json&amp;revision=4&amp;download=true`);
    expect(html).toContain('value="original"');expect(html).toContain('original-name.json');
    expect(html).toContain(language==='en'?'Imported original':'取り込んだ原本');
    expect(fixture.request).not.toHaveBeenCalled();
  }
});

it('keeps the matching payload and request ID when an explicit save cannot be verified',async()=>{
  fixture.params=new URLSearchParams('edit=new');fixture.save.mockRejectedValue(Error('Failed to fetch'));
  const tree=workspace({12:document});
  nodes(tree,node=>node.props.children==='Save')[0].props.onClick();
  await vi.waitFor(()=>expect(fixture.save).toHaveBeenCalledOnce());
  const [payload,editing,id]=fixture.save.mock.calls[0];
  expect(payload).toEqual(document);expect(editing).toBeUndefined();expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const stored=JSON.parse(sessionStorage.getItem('kyalulu-create-draft-v1:fixture-owner:editor:new-character')!);
  expect(stored.request_id).toBe(id);expect(stored.document).toEqual(document);
  await vi.waitFor(()=>expect(fixture.updates.some(update=>update.index===13&&String(update.value).endsWith(suffix))).toBe(true));
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it('keeps browser provenance distinct from retrieved originals and rejects untrusted source links',()=>{
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(ImportSource({value:{source:'Original source',author:'原文の作者',license:'Custom license',transport:'browser',source_url:'https://attacker.example.test/file'}}));
    expect(html).toContain('原文の作者');expect(html).toContain('Custom license');
    expect(html).toContain(language==='en'?'Provenance is supplied by the user.':'出典は利用者の申告');
    expect(html).not.toContain('href=');
  }
});

it('retains URL draft/format/licensing and requires explicit retrieval in both languages',async()=>{
  const url='https://realm.risuai.net/character/fictional',received=vi.fn(),busy=vi.fn();
  fixture.preview.mockResolvedValue({preview_id:'fictional'});
  for(const language of ['ja','en']){
    fixture.language=language;
    const tree=view(()=>UrlImportBox({onPreview:received,onBusyChange:busy}),[url,'json-v3',true,false,'']);
    const html=renderToStaticMarkup(tree);
    expect(html).toContain(url);expect(html).toContain('selected=""');expect(html).toContain('checked=""');
    expect(fixture.preview).not.toHaveBeenCalled();
    nodes(tree,node=>node.type==='form')[0].props.onSubmit({preventDefault(){}});
    await vi.waitFor(()=>expect(received).toHaveBeenCalledWith({preview_id:'fictional'}));
    expect(fixture.preview).toHaveBeenCalledWith({url,format:'json-v3',non_commercial:true},expect.any(AbortSignal));
    received.mockClear();fixture.preview.mockClear();
  }
});

it('keeps URL input available when reading browser draft storage throws',()=>{
  vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('blocked storage');}});
  const html=renderToStaticMarkup(view(()=>UrlImportBox({onPreview:vi.fn()}),[]));
  expect(html).toContain('Public URL to import');expect(fixture.preview).not.toHaveBeenCalled();
});

it('does not let a generic network error hide the stable-save recovery instructions',()=>{
  const raw=Error('Failed to fetch'+suffix);
  expect(friendlyMessage(raw,'en')).toContain('same ID');
  expect(friendlyMessage(raw,'en')).toContain('before changing the content');
  expect(friendlyMessage(raw,'ja')).toContain('同じ保存ID');
});

it('retains HTTP permission metadata and singular import counts when display language changes',()=>{
  const error=Object.assign(Error('fixture permission detail'),{status:403});
  for(const language of ['ja','en']){
    fixture.language=language;
    const html=renderToStaticMarkup(workspace({13:error,16:{kind:'imported',count:1}}));
    expect(html).toContain(language==='en'?'You do not have permission':'権限がありません');
    expect(html).toContain(language==='en'?'Saved 1 item to':'1件を');
    expect(html).not.toContain('1 items');
  }
});
