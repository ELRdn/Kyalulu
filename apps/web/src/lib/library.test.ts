import {afterEach,expect,it,vi} from 'vitest';
import {libraryRequest,saveLibraryItem,uploadAsset,PortableDocumentSchema} from './library';
import {setCloud,setCloudOwner} from './cloudMode';

afterEach(()=>{setCloud(false);vi.unstubAllGlobals();vi.restoreAllMocks();});
it('adds explicit rights confirmation for local WAV/MP4 without changing image uploads',async()=>{
  const fetch=vi.fn().mockImplementation(async()=>Response.json({name:'media',type:'audio',media_type:'audio/wav',asset_id:'a'}));vi.stubGlobal('fetch',fetch);
  const wav=new File(['RIFF'],'voice.wav',{type:'audio/wav'});
  await uploadAsset(wav,{rights_confirmed:true});
  expect(fetch.mock.calls[0][1].body.get('rights_confirmed')).toBe('true');
  expect(fetch.mock.calls[0][1].body.get('file').type).toBe('audio/wav');
  await uploadAsset(new File(['mp4'],'scene.mp4',{type:'video/mp4'}),{rights_confirmed:true});
  expect(fetch.mock.calls[1][1].body.get('file').type).toBe('video/mp4');
  await uploadAsset(new File(['png'],'icon.png',{type:'image/png'}));
  expect(fetch.mock.calls[2][1].body.has('rights_confirmed')).toBe(false);
});
it('rejects missing rights, over-limit/empty/unsupported media and Cloud uploads before network',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const wav=new File(['RIFF'],'voice.wav',{type:'audio/wav'});
  await expect(uploadAsset(wav,{rights_confirmed:false})).rejects.toThrow('権利');
  const large=new File(['RIFF'],'large.wav',{type:'audio/wav'});Object.defineProperty(large,'size',{value:32*1024*1024+1});
  await expect(uploadAsset(large,{rights_confirmed:true})).rejects.toThrow('32MiB');
  await expect(uploadAsset(new File([],'empty.wav',{type:'audio/wav'}),{rights_confirmed:true})).rejects.toThrow('32MiB');
  await expect(uploadAsset(new File(['ogg'],'audio.ogg',{type:'audio/ogg'}),{rights_confirmed:true})).rejects.toThrow('WAV');
  setCloud(true);await expect(uploadAsset(wav,{rights_confirmed:true})).rejects.toThrow('クラウド');
  expect(fetch).not.toHaveBeenCalled();
});
it('uses a supplied idempotency UUID for new saves and edits while preserving update CAS',async()=>{
  const document=PortableDocumentSchema.parse({kind:'character',name:'Test',data:{}});
  const item={id:'lib_test',revision:1,original_id:null,document};
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(item))));vi.stubGlobal('fetch',fetch);
  const requestId='5de31593-32ee-4c68-9941-b73567772961';
  await saveLibraryItem(document,undefined,requestId);
  await saveLibraryItem(document,item,requestId);
  expect(new Headers(fetch.mock.calls[0][1].headers).get('Idempotency-Key')).toBe(requestId);
  expect(new Headers(fetch.mock.calls[1][1].headers).get('Idempotency-Key')).toBe(requestId);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(document);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({document,expected_revision:1});
});
it('rejects saved/library data from an owner who changed during JSON body reading',async()=>{
  setCloud(true);setCloudOwner('a');
  const response=new Response('{}');
  vi.spyOn(response,'json').mockImplementation(async()=>{setCloudOwner('b');return {id:'old-owner-item'};});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
  await expect(libraryRequest('/api/library')).rejects.toThrow('アカウントが切り替わりました');
});
it('rejects an old owner failed response after delayed JSON body reading',async()=>{
  setCloud(true);setCloudOwner('failed-body-a');
  let finishBody!:(body:unknown)=>void;
  const response=new Response('{}',{status:409});
  const json=vi.spyOn(response,'json').mockImplementation(()=>new Promise(resolve=>{finishBody=resolve;}));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
  const rejected=expect(libraryRequest('/api/library/x',{method:'PUT'})).rejects.toThrow('アカウントが切り替わりました');
  await vi.waitFor(()=>expect(json).toHaveBeenCalledOnce());
  setCloudOwner('failed-body-b');finishBody({error:'revision_conflict'});
  await rejected;
});
it('preserves CAS status and limits reads, while screened writes have no forced deadline',async()=>{
  const timeout=new AbortController();
  const fetch=vi.fn().mockResolvedValueOnce(new Response('{"error":"changed"}',{status:409}))
    .mockImplementationOnce((_url,init)=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
    }));
  vi.stubGlobal('fetch',fetch);
  await expect(libraryRequest('/api/library/x',{method:'PUT'})).rejects.toMatchObject({status:409});
  vi.spyOn(AbortSignal,'timeout').mockReturnValueOnce(timeout.signal);
  expect(fetch.mock.calls[0][1].signal).toBeUndefined();
  const failed=expect(libraryRequest('/api/library')).rejects.toThrow('deadline');
  timeout.abort(Error('deadline'));await failed;
  expect(fetch).toHaveBeenCalledTimes(2);
});
