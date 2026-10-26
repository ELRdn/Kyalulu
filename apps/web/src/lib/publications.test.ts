import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({owner:'a',scope:'device:a',epoch:1,calls:[] as any[],result:{} as any}));
vi.mock('./cloud',()=>({cloudJson:vi.fn(async(path,init)=>{fixture.calls.push({path,init});return fixture.result;})}));
vi.mock('./cloudMode',()=>({cloudEpoch:()=>fixture.epoch,subscribeCloudIdentity:()=>()=>{}}));
vi.mock('./remoteStore',()=>({connectionScope:()=>fixture.scope}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,preferences:()=>({country:'JP'}),useDeviceOwner:()=>fixture.owner,useExecutionTarget:()=> 'device'}));
import { cloudJson } from './cloud';
import { PortableDocumentSchema } from './library';
import { fetchPublishedWorks, publicSnapshot, submitPublication, publicationError } from './publications';
beforeEach(()=>{fixture.owner='a';fixture.scope='device:a';fixture.epoch=1;fixture.calls=[];fixture.result={works:[]};vi.stubGlobal('localStorage',{getItem:()=> 'signed-fixture-ticket'});});
afterEach(()=>{vi.unstubAllGlobals();vi.mocked(cloudJson).mockReset();vi.mocked(cloudJson).mockImplementation(async(path,init)=>{fixture.calls.push({path,init});return fixture.result;});});
it('removes private fields before submission and pins the displayed Library version',async()=>{
  const raw=PortableDocumentSchema.parse({name:'Guide',data:{description:'public',memories:'PRIVATE',tags:['fantasy']},profile:{system_prompt:'PRIVATE'},source:{original:'PRIVATE'},histories:[{name:'PRIVATE',messages:[]}],assets:[{name:'PRIVATE',uri:'https://invalid.test/PRIVATE'}]});
  const document=publicSnapshot(raw);expect(JSON.stringify(document)).not.toContain('PRIVATE');
  fixture.result={id:'fixture',revision:1,status:'pending'};
  await submitPublication(document,{item_id:'library',revision:7},'request-1','cloud-owner');
  expect(fixture.calls[0].init.headers.get('X-Kyalulu-Owner')).toBe('cloud-owner');
  expect(fixture.calls[0].path).toBe('app/publications');expect(JSON.parse(fixture.calls[0].init.body)).toMatchObject({document,source:{item_id:'library',revision:7},request_id:'request-1'});
});
it('sends only region proof on public browsing, never interests or conversation data',async()=>{
  await fetchPublishedWorks('sea','fantasy');
  const call=fixture.calls[0];expect(call.path).toContain('rating=general');expect([...call.init.headers.entries()]).toEqual([['x-kyalulu-country','JP'],['x-kyalulu-eligibility','signed-fixture-ticket']]);
  expect(call.init.body).toBeUndefined();
});
it.each(['owner','scope','epoch'])('discards delayed publication JSON after %s changes',async field=>{
  vi.mocked(cloudJson).mockImplementationOnce(async()=>{if(field==='owner')fixture.owner='b';else if(field==='scope')fixture.scope='pc:other';else fixture.epoch++;return {works:[]};});
  await expect(fetchPublishedWorks()).rejects.toThrow('account_changed');
});
it('rejects invalid public field types instead of sending nested private objects',()=>{
  expect(()=>publicSnapshot(PortableDocumentSchema.parse({name:'Guide',data:{description:{private:'NEVER'}}}))).toThrow();
});
it('explains stale revisions using the retained API code without exposing it in the UI',()=>{
  const error=Object.assign(Error('Generic friendly message'),{code:'publication_revision_conflict'});
  expect(publicationError(error,true)).toContain('Reload');expect(publicationError(error,false)).toContain('再読込');
});
