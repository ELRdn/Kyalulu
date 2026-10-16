import {afterEach,expect,it,vi} from 'vitest';
import {accountProfile,accountProfileState,changeAccountProfile,refreshAccountProfile} from './accountProfile';
import {setCloud,setCloudOwner} from './cloudMode';

afterEach(()=>{setCloud(false);vi.unstubAllGlobals();});
function setup(owner:string) {
  setCloud(true);setCloudOwner(owner);vi.stubGlobal('window',{dispatchEvent:vi.fn()});
}
const profile=(revision:number,name='Owner')=>({revision,display_name:name,saved_characters:[],pinned_sessions:[]});
it('serializes changes against confirmed revisions and clears data for a different account',async()=>{
  setup('serial-owner');
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profile(0))))
    .mockResolvedValueOnce(new Response(JSON.stringify(profile(1,'A'))))
    .mockResolvedValueOnce(new Response(JSON.stringify(profile(2,'B'))));
  vi.stubGlobal('fetch',fetch);
  await refreshAccountProfile();
  await Promise.all([changeAccountProfile({display_name:'A'}),changeAccountProfile({display_name:'B'})]);
  expect(JSON.parse(fetch.mock.calls[2][1].body).revision).toBe(1);
  expect(accountProfile()?.display_name).toBe('B');
  setCloudOwner('someone-else');expect(accountProfile()).toBeNull();
});
it('refreshes a conflict without overwriting the other device change',async()=>{
  setup('conflict-owner');
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profile(0))))
    .mockResolvedValueOnce(new Response(JSON.stringify({error:'profile_conflict'}),{status:409}))
    .mockResolvedValueOnce(new Response(JSON.stringify(profile(1,'Other device'))));
  vi.stubGlobal('fetch',fetch);await refreshAccountProfile();
  await expect(changeAccountProfile({display_name:'My edit'})).rejects.toThrow('別の端末');
  expect(accountProfile()?.display_name).toBe('Other device');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('does not send an old owner edit after the initial read emits a scope change',async()=>{
  setup('initial-read-owner-a');
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(profile(0)))));
  vi.stubGlobal('fetch',fetch);
  const dispatch=vi.mocked(window.dispatchEvent);
  dispatch.mockImplementation(()=>{
    if (accountProfileState().profile) setCloudOwner('initial-read-owner-b');return false;
  });
  await expect(changeAccountProfile({display_name:'Owner A edit'})).rejects.toThrow('アカウントが切り替わりました');
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1].method).toBeUndefined();
  expect(accountProfileState()).toMatchObject({owner:'initial-read-owner-b',profile:null,pending:0,error:''});
});
it('does not leak an old owner conflict or events after switching during conflict reload',async()=>{
  setup('conflict-reload-a');
  let respondA!:(value:Response)=>void;
  let respondB!:(value:Response)=>void;
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(profile(0,'A'))))
    .mockResolvedValueOnce(new Response('{"error":"profile_conflict"}',{status:409}))
    .mockImplementationOnce(()=>new Promise<Response>(resolve=>{respondA=resolve;}))
    .mockImplementationOnce(()=>new Promise<Response>(resolve=>{respondB=resolve;}));
  vi.stubGlobal('fetch',fetch);await refreshAccountProfile();
  const failed=expect(changeAccountProfile({display_name:'A edit'})).rejects.toThrow('別の端末');
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));
  setCloudOwner('conflict-reload-b');
  const loadingB=refreshAccountProfile();
  const dispatch=vi.mocked(window.dispatchEvent);dispatch.mockClear();
  respondA(new Response(JSON.stringify(profile(1,'A other device'))));
  await failed;
  await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(4));
  expect(accountProfileState()).toMatchObject({owner:'conflict-reload-b',profile:null,pending:0,error:''});
  expect(dispatch).not.toHaveBeenCalled();
  respondB(new Response(JSON.stringify(profile(2,'B'))));await loadingB;
  expect(accountProfileState()).toMatchObject({error:'',pending:0,profile:profile(2,'B')});
});
it('does not adopt a response after the signed-in account changes',async()=>{
  setup('old-owner');let resolve!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{resolve=r;})));
  const loading=refreshAccountProfile();await new Promise(r=>setTimeout(r,0));
  setCloudOwner('new-owner');resolve(new Response(JSON.stringify(profile(1,'Private old name'))));
  await loading;expect(accountProfile()).toBeNull();
});
it('releases the saving state when initial profile loading fails',async()=>{
  setup('offline-owner');
  const fetch=vi.fn().mockRejectedValue(Error('Offline'));
  vi.stubGlobal('fetch',fetch);
  await expect(changeAccountProfile({display_name:'My name'})).rejects.toThrow('Offline');
  expect(accountProfileState().pending).toBe(0);
  expect(accountProfileState().error).toBeTruthy();
});
it('discards queued edits across logout/login even for the same owner',async()=>{
  setup('returning-owner');let resolve!:(value:Response)=>void;
  const fetch=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetch);
  const loading=refreshAccountProfile();await new Promise(r=>setTimeout(r,0));
  const change=changeAccountProfile({display_name:'Old queued edit'});
  const failed=expect(change).rejects.toThrow('アカウントが切り替わりました');
  setCloudOwner('');setCloudOwner('returning-owner');
  resolve(new Response(JSON.stringify(profile(0))));await loading;await failed;
  expect(fetch).toHaveBeenCalledOnce();expect(accountProfile()).toBeNull();
  expect(accountProfileState().pending).toBe(0);
});
