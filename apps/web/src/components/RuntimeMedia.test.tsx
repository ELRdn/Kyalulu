import { Children, type ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeDownload, RuntimeImage } from './RuntimeMedia';
import { apiFetch } from '../lib/transport';

const fixture = vi.hoisted(() => ({scope:'device:owner-a', epoch:1, errors:vi.fn(), language:'en', target:'device'}));
vi.mock('react', async original => ({...await original<typeof import('react')>(),
  useEffect:()=>{},useRef:(value:unknown)=>({current:value}),useState:(value:unknown)=>[value,typeof value==='string'?fixture.errors:vi.fn()]}));
vi.mock('../lib/transport',()=>({apiFetch:vi.fn()}));
vi.mock('../lib/remoteStore',()=>({activeRemote:()=>null,connectionScope:()=>fixture.scope}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>fixture.language,executionTarget:()=>fixture.target,useExecutionTarget:()=>fixture.target,useDeviceOwner:()=>fixture.scope}));
vi.mock('../lib/cloudMode',()=>({cloudEpoch:()=>fixture.epoch}));
let anchor:{href:string;download:string;click:ReturnType<typeof vi.fn>;remove:ReturnType<typeof vi.fn>};
const event=()=>({preventDefault:vi.fn(),defaultPrevented:false});
function link(props:Parameters<typeof RuntimeDownload>[0]={href:'/api/experiments/fixture/export',download:true}) {
  return Children.toArray(RuntimeDownload({...props,children:'Download'}).props.children)[0] as ReactElement<any>;
}
beforeEach(()=>{
  fixture.scope='device:owner-a';fixture.epoch=1;fixture.language='en';fixture.target='device';fixture.errors.mockReset();vi.mocked(apiFetch).mockReset();
  vi.useFakeTimers();
  anchor={href:'',download:'',click:vi.fn(),remove:vi.fn()};
  vi.stubGlobal('document',{createElement:vi.fn(()=>anchor),body:{appendChild:vi.fn()}});
  vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:fixture');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

it.each(['device:owner-a','remote:owner-a:pc','cloud:owner-a','local'])('exports through the selected %s transport with a server filename',async scope=>{
  fixture.scope=scope;
  vi.mocked(apiFetch).mockResolvedValue(new Response('{"private":"fixture"}',{headers:{'Content-Type':'application/json','Content-Disposition':"attachment; filename*=UTF-8''%E7%B5%90%E6%9E%9C.json"}}));
  const action=link(),click=event();
  expect(action.props.href).toBeUndefined();await action.props.onClick(click);
  expect(click.preventDefault).toHaveBeenCalled();expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch).toHaveBeenCalledWith('/api/experiments/fixture/export',expect.objectContaining({signal:expect.any(AbortSignal)}));
  expect(anchor.download).toBe('結果.json');expect(anchor.href).toBe('blob:fixture');expect(anchor.click).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
});

it.each(['scope','epoch','target'])('discards a response if %s changes while its private body loads',async changed=>{
  const response=new Response('{}');response.blob=async()=>{if(changed==='scope')fixture.scope='device:owner-b';else if(changed==='target')fixture.target='local';else fixture.epoch++;return new Blob(['private']);};
  vi.mocked(apiFetch).mockResolvedValue(response);
  await link().props.onClick(event());
  expect(anchor.click).not.toHaveBeenCalled();expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(fixture.errors).toHaveBeenLastCalledWith('Account or execution target changed. Export again.');
});

it('does not turn an HTTP error or denied permission into a downloaded file',async()=>{
  vi.mocked(apiFetch).mockResolvedValue(new Response('{"error":"denied"}',{status:403}));
  await link().props.onClick(event());expect(anchor.click).not.toHaveBeenCalled();
  expect(fixture.errors).toHaveBeenLastCalledWith('Could not retrieve the export.');
});

it('suppresses duplicate clicks while a request is pending and permits a retry after failure',async()=>{
  let reject!:(error:Error)=>void;
  vi.mocked(apiFetch).mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
  const action=link(),first=action.props.onClick(event());await action.props.onClick(event());
  expect(apiFetch).toHaveBeenCalledOnce();reject(Error('offline'));await first;
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}',{headers:{'Content-Disposition':'attachment; filename="experiment.json"'}}));
  await action.props.onClick(event());expect(apiFetch).toHaveBeenCalledTimes(2);expect(anchor.download).toBe('experiment.json');
});

it.each(['Enter',' '])('supports keyboard activation with %j',key=>{
  const click=vi.fn(),press={key,defaultPrevented:false,preventDefault:vi.fn(),currentTarget:{click}};
  link().props.onKeyDown(press);expect(press.preventDefault).toHaveBeenCalledOnce();expect(click).toHaveBeenCalledOnce();
});

it('preserves explicit filenames and recovers from malformed UTF-8 headers',async()=>{
  vi.mocked(apiFetch).mockImplementation(async()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Disposition':"attachment; filename*=UTF-8''%broken"}}));
  await link().props.onClick(event());expect(anchor.download).toBe('kyalulu-export.json');
  await link({href:'/api/creator/persona/id/export',download:'../persona.json'}).props.onClick(event());expect(anchor.download).toBe('persona.json');
});
it('prevents imported device metadata from loading third-party images or bypassing the Runtime transport',()=>{
  for(const src of ['https://invalid.test/tracking.png','/api/library/assets/private']){
    const image=RuntimeImage({src,alt:'Private',srcSet:'https://invalid.test/large.png'});
    expect(image.type).toBe('span');expect(image.props.role).toBe('img');expect(image.props['aria-label']).toBe('Private');
  }
  expect(apiFetch).not.toHaveBeenCalled();
});
it('retains bundled mascot images without honoring untrusted device srcSet',()=>{
  const image=RuntimeImage({src:'/mascot/kyalulu.webp',srcSet:'https://invalid.test/large.png'});
  expect(image.type).toBe('img');expect(image.props.src).toBe('/mascot/kyalulu.webp');expect(image.props.srcSet).toBeUndefined();
});
