import {afterEach,expect,it,vi} from 'vitest';
import {fetchCharacters,streamChat} from './api';
import {setCloud,setCloudOwner} from './cloudMode';
import {scopedKey} from './remoteStore';
import {cloudJson} from './cloud';
afterEach(()=>{setCloud(false);vi.unstubAllGlobals();vi.restoreAllMocks();});
it.each([200,409])('rejects cloud HTTP %s after an owner change during JSON body reading',async status=>{
  setCloud(true);setCloudOwner('a');
  const response=new Response('{}',{status});
  vi.spyOn(response,'json').mockImplementation(async()=>{setCloudOwner('b');return {token:'old-owner-token'};});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
  await expect(cloudJson('sync/device')).rejects.toThrow('アカウントが切り替わりました');
});
it('preserves proxy/auth errors, accepts no-content, and keeps caller headers',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response('<html>proxy error</html>',{status:502}))
    .mockResolvedValueOnce(new Response(JSON.stringify({detail:'account_not_allowed'}),{status:403}))
    .mockResolvedValueOnce(new Response(null,{status:204}));
  vi.stubGlobal('fetch',fetch);
  await expect(cloudJson('account')).rejects.toThrow('サーバーでエラー');
  await expect(cloudJson('account')).rejects.toThrow('テストに招待');
  expect(await cloudJson('auth/logout',{headers:new Headers({'X-Test':'kept'})})).toEqual({});
  expect(fetch.mock.calls[2][1].headers.get('X-Test')).toBe('kept');
  expect(fetch.mock.calls[2][1].headers.get('Content-Type')).toBe('application/json');
});
it('bounds cloud requests and forwards caller cancellation without retrying',async()=>{
  const controller=new AbortController();
  const timeout=new AbortController();
  vi.spyOn(AbortSignal,'timeout').mockReturnValueOnce(timeout.signal);
  const fetch=vi.fn((_url,init)=>new Promise<Response>((_resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
  }));
  vi.stubGlobal('fetch',fetch);
  const request=cloudJson('profile',{signal:controller.signal});
  const failed=expect(request).rejects.toThrow('deadline');
  timeout.abort(Error('deadline'));await failed;
  expect(fetch).toHaveBeenCalledOnce();
  expect(controller.signal.aborted).toBe(false);
  vi.restoreAllMocks();
});
it('keeps cloud writes free of a forced deadline while forwarding explicit cancellation',async()=>{
  const controller=new AbortController();
  const timeout=vi.spyOn(AbortSignal,'timeout');
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}')));
  vi.stubGlobal('fetch',fetch);
  await cloudJson('profile',{method:'PUT',body:'{}'});
  await cloudJson('sync/device',{method:'POST',signal:controller.signal});
  expect(fetch.mock.calls[0][1].signal).toBeUndefined();
  expect(fetch.mock.calls[1][1].signal).toBe(controller.signal);
  expect(timeout).not.toHaveBeenCalled();
});
it('requests the SFW server catalog in cloud even from detail/chat callers asking for all characters',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({characters:[{id:'mocha_sfw',intro:'Server plot'}]})));
  vi.stubGlobal('fetch',fetch);
  expect(await fetchCharacters(true)).toEqual([{id:'mocha_sfw',intro:'Server plot'}]);
  expect(fetch.mock.calls[0][0]).toBe('/api/characters?include_nsfw=false');
});
it('preserves the local catalog adult-content request',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({characters:[]})));
  vi.stubGlobal('fetch',fetch);
  await fetchCharacters(true);
  expect(fetch.mock.calls[0][0]).toBe('/api/characters?include_nsfw=true');
});
it('reserves only after explicit maximum confirmation and keeps the durable ID',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'q',max_credits:91,route:{display_name:'Cloud Standard',provider:'deepseek',model:'deepseek-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch',fetch);const confirm=vi.fn((_message:string)=>true);vi.stubGlobal('window',{confirm});
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{generation_id:'g'},
    {onToken:vi.fn(),onDone:()=>resolve(),onError:error=>reject(Error(error))}));
  expect(confirm.mock.calls[0][0]).toContain('91 K-Credits');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({generation_id:'g',quote_id:'q',max_credits:91});
});
it('declined quotes never POST a generation',async()=>{
  setCloud(true);const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({quote_id:'q',max_credits:1,route:{display_name:'Cloud',provider:'deepseek',model:'deepseek-flash'}})));
  vi.stubGlobal('fetch',fetch);vi.stubGlobal('window',{confirm:()=>false});const rejected=vi.fn();
  await new Promise<void>(resolve=>streamChat('cloud-standard',[],{}, {onToken:vi.fn(),onRejected:rejected,onError:()=>resolve()}));
  expect(rejected).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
});
it('browser recovery/model caches use distinct account scopes',()=>{
  vi.stubGlobal('window',{location:{origin:'https://cloud.test'}});setCloud(true);setCloudOwner('a');const a=scopedKey('model');
  setCloudOwner('b');expect(scopedKey('model')).not.toBe(a);
});
it('shows the pinned upstream and keeps training consent in the quoted request',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'q',max_credits:1,route:{display_name:'Cloud',provider:'openrouter',upstream:'InferenceNet',model:'deepseek/deepseek-v4.1-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch',fetch);const confirm=vi.fn((_message:string)=>true);vi.stubGlobal('window',{confirm});
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{route_profile:'auto',contributor_training_consent:false},
    {onToken:vi.fn(),onDone:()=>resolve(),onError:error=>reject(Error(error))}));
  expect(confirm.mock.calls[0][0]).toContain('openrouter / InferenceNet');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({route_profile:'auto',contributor_training_consent:false});
  expect(JSON.parse(fetch.mock.calls[1][1].body).contributor_training_consent).toBe(false);
});
it('keeps the integer credit reservation for a funded private account',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'private-q',max_credits:120,
    route:{display_name:'Cloud',provider:'openrouter',upstream:'InferenceNet',model:'deepseek/deepseek-v4.1-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe","charged_credits":3}\n\n'));
  vi.stubGlobal('fetch',fetch);const confirm=vi.fn((_message:string)=>true);vi.stubGlobal('window',{confirm});
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{},
    {onToken:vi.fn(),onDone:()=>resolve(),onError:error=>reject(Error(error))}));
  expect(confirm.mock.calls[0][0]).toContain('120 K-Credits');
  expect(confirm.mock.calls[0][0]).not.toContain('BYOKの提供元');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({quote_id:'private-q',max_credits:120});
});
