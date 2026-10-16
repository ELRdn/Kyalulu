import {afterEach,expect,it,vi} from 'vitest';
import {fetchCharacters,streamChat} from './api';
import {setCloud,setCloudOwner} from './cloudMode';
import {scopedKey} from './remoteStore';
import {cloudJson} from './cloud';
import type { CloudQuote } from './quoteConsent';
import { QuoteConsent } from './quoteConsent';
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
it('automatically sends ordinary quotes, reports their cap and keeps the durable ID',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'q',max_credits:91,route:{display_name:'Cloud Standard',provider:'deepseek',model:'deepseek-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch',fetch);const confirm=vi.fn(async (_quote:CloudQuote)=>false);const shown=vi.fn();
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{generation_id:'g'},
    {confirmQuote:confirm,onQuote:shown,onToken:vi.fn(),onDone:()=>resolve(),onError:error=>reject(Error(error))}));
  expect(confirm).not.toHaveBeenCalled();
  expect(shown).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({max_credits:91}));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({generation_id:'g',quote_id:'q',max_credits:91});
});
it('declined training-required quotes never POST a generation',async()=>{
  setCloud(true);const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({quote_id:'q',max_credits:1,route:{display_name:'Baidu',provider:'openrouter',model:'deepseek-flash',training_consent_required:true}})));
  vi.stubGlobal('fetch',fetch);const rejected=vi.fn();
  await new Promise<void>(resolve=>streamChat('cloud-standard',[],{}, {confirmQuote:async()=>false,onToken:vi.fn(),onRejected:rejected,onError:()=>resolve()}));
  expect(rejected).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
});
it('sends an ordinary quote without either optional quote callback', async () => {
  setCloud(true);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ quote_id: 'ordinary', max_credits: 5,
    route: { display_name: 'Cloud', provider: 'openrouter', model: 'fixture', training_consent_required: false } }))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch', fetch);
  await new Promise<void>((resolve, reject) => streamChat('cloud', [], {}, {
    onToken: vi.fn(), onDone: () => resolve(), onError: error => reject(Error(error)),
  }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ quote_id: 'ordinary', max_credits: 5, provider_training_consent: false });
});
it.each(['expiry', 'identity', 'abort', 'invalid'] as const)('rejects an ordinary quote on %s without dispatch or retry', async reason => {
  setCloud(true); setCloudOwner('a');
  const fetch = vi.fn().mockResolvedValue(Response.json({ quote_id: 'ordinary', max_credits: reason === 'invalid' ? -1 : 5,
    expires_in: 1, route: { display_name: 'Cloud', provider: 'openrouter', model: 'fixture' } }));
  vi.stubGlobal('fetch', fetch);
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  const rejected = vi.fn(); const dispatch = vi.fn(); const shown = vi.fn(() => {
    if (reason === 'expiry') vi.mocked(Date.now).mockReturnValue(now + 1000);
    if (reason === 'identity') setCloudOwner('b');
    if (reason === 'abort') stop();
  });
  const stop = streamChat('cloud', [], {}, { onToken: vi.fn(), onQuote: shown, onDispatch: dispatch, onRejected: rejected });
  await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce());
  expect(shown).toHaveBeenCalledTimes(reason === 'invalid' ? 0 : 1);
  expect(dispatch).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
});
it.each([true, false])('Baidu consent sends only after confirmation (accept=%s)', async accepted => {
  setCloud(true);
  const preview = { quote_id: 'baidu-q', max_credits: 12, route: { display_name: 'Baidu', provider: 'openrouter',
    upstream: 'Baidu', model: 'deepseek', training: true, retains_prompts: true, training_consent_required: true } };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(preview))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch', fetch);
  const shown = vi.fn(); const consent = new QuoteConsent(shown); const rejected = vi.fn();
  const completed = new Promise<void>((resolve, reject) => streamChat('cloud-deepseek-baidu', [], { provider_training_consent: true }, {
    confirmQuote: consent.request, onToken: vi.fn(), onDone: () => resolve(), onRejected: rejected,
    onError: error => accepted ? reject(Error(error)) : resolve(),
  }));
  await vi.waitFor(() => expect(shown).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('provider_training_consent');
  consent.accept(); // Even prefilled caller options cannot bypass the unchecked quote.
  expect(fetch).toHaveBeenCalledOnce();
  consent.acknowledgeProviderTraining('baidu-q', true);
  expect(fetch).toHaveBeenCalledOnce(); // The checkbox alone does not send.
  if (accepted) consent.accept(); else consent.cancel();
  await completed;
  if (accepted) {
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ quote_id: 'baidu-q', provider_training_consent: true });
    expect(rejected).not.toHaveBeenCalled();
  } else {
    expect(fetch).toHaveBeenCalledOnce(); expect(rejected).toHaveBeenCalledOnce();
  }
});
it('does not grant provider training on a nontraining quote even with stale caller consent', async () => {
  setCloud(true);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ quote_id: 'flex-q', max_credits: 12,
    route: { display_name: 'Flex', provider: 'openrouter', upstream: 'OpenAI', model: 'GPT', training: false, training_consent_required: false, retains_prompts: true } }))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch', fetch);
  await new Promise<void>((resolve, reject) => streamChat('cloud-gpt-luna-flex', [], { provider_training_consent: true }, {
    confirmQuote: async () => true, onToken: vi.fn(), onDone: () => resolve(), onError: error => reject(Error(error)),
  }));
  expect(JSON.parse(fetch.mock.calls[1][1].body).provider_training_consent).toBe(false);
});
it('browser recovery/model caches use distinct account scopes',()=>{
  vi.stubGlobal('window',{location:{origin:'https://cloud.test'}});setCloud(true);setCloudOwner('a');const a=scopedKey('model');
  setCloudOwner('b');expect(scopedKey('model')).not.toBe(a);
});
it('reports the pinned upstream without confirmation and preserves contributor options',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'q',max_credits:1,route:{display_name:'Cloud',provider:'openrouter',upstream:'InferenceNet',model:'deepseek/deepseek-v4.1-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch',fetch);const confirm=vi.fn(async (_quote:CloudQuote)=>true);const shown=vi.fn();
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{route_profile:'auto',contributor_training_consent:false},
    {confirmQuote:confirm,onQuote:shown,onToken:vi.fn(),onDone:()=>resolve(),onError:error=>reject(Error(error))}));
  expect(confirm).not.toHaveBeenCalled();
  expect(shown.mock.calls[0][0].route).toMatchObject({provider:'openrouter',upstream:'InferenceNet'});
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({route_profile:'auto',contributor_training_consent:false});
  expect(JSON.parse(fetch.mock.calls[1][1].body).contributor_training_consent).toBe(false);
});
it('preserves the quoted spend cap while settling a lower actual charge without a hold',async()=>{
  setCloud(true);
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({quote_id:'private-q',max_credits:120,credit_reservation:false,safety_screening:false,
    route:{display_name:'Cloud',provider:'openrouter',upstream:'InferenceNet',model:'deepseek/deepseek-v4.1-flash'}})))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe","charged_credits":3}\n\n'));
  vi.stubGlobal('fetch',fetch);const shown=vi.fn();
  const done=vi.fn();
  await new Promise<void>((resolve,reject)=>streamChat('cloud-standard',[{role:'user',content:'hi'}],{},
    {onQuote:shown,onToken:vi.fn(),onDone:(full,meta)=>{done(full,meta);resolve();},onError:error=>reject(Error(error))}));
  expect(shown.mock.calls[0][0].max_credits).toBe(120);
  expect(shown.mock.calls[0][0]).toMatchObject({credit_reservation:false,safety_screening:false});
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({quote_id:'private-q',max_credits:120});
  expect(done).toHaveBeenCalledWith('safe',expect.objectContaining({charged_credits:3}));
});
