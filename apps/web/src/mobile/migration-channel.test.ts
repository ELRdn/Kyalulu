import { afterEach, expect, it, vi } from 'vitest';
import { initialData, newConversation } from './store';
import { migrationEnvelope, migrationHash, parseMigration } from './migration';
import { MIGRATION_CHUNK, MIGRATION_LIMIT, MigrationReader, serveMigration, trustedMigrationEvent, validateManifest, type MigrationManifest, type ChunkRequest } from './migrationChannel';

const cleanup:(()=>void)[]=[];
afterEach(()=>{cleanup.splice(0).forEach(stop=>stop());vi.useRealTimers();});
function connection(manifest:MigrationManifest,read:(r:ChunkRequest)=>Promise<Uint8Array>) {
  const ports=new MessageChannel(),abort=new AbortController(),closed=vi.fn();
  const stop=serveMigration(ports.port2,manifest,read,closed),reader=new MigrationReader(ports.port1,abort.signal);
  cleanup.push(()=>{reader.close();stop();});return {reader,abort,closed};
}
const manifest:MigrationManifest={revision:1,backup:{bytes:2,sha256:migrationHash(new TextEncoder().encode('{}'))},models:[]};
it('requires the exact origin, window, nonce and message type',()=>{
  const popup={} as Window,token='a'.repeat(32),origin='https://mobile.kyalulu.com';
  const event={source:popup,origin,data:{type:'ready',token}} as unknown as MessageEvent;
  expect(trustedMigrationEvent(event,popup,origin,token,'ready')).toBe(true);
  for(const patch of [{source:{}},{origin:origin+'.evil.test'},{data:{type:'ready',token:'b'.repeat(32)}},{data:{type:'connect',token}}])
    expect(trustedMigrationEvent({...event,...patch} as MessageEvent,popup,origin,token,'ready')).toBe(false);
  expect(trustedMigrationEvent(event,null,origin,token,'ready')).toBe(false);
});
it('rejects unsupported revisions, oversize data and duplicate model descriptors',()=>{
  expect(validateManifest(manifest)).toEqual(manifest);
  for(const value of [{...manifest,revision:2},{...manifest,backup:{...manifest.backup,bytes:MIGRATION_LIMIT+1}},
    {...manifest,backup:{...manifest.backup,sha256:'bad'}},{...manifest,models:[{id:'a',fingerprint:'a'},{id:'a',fingerprint:'a'}]}])
    expect(()=>validateManifest(value)).toThrow('manifest');
});
it('transfers a multichunk Unicode backup with exact integrity and stopped/draft state',async()=>{
  const data=initialData(),session=newConversation(data.characters[0],'kyalulu-iq3m');
  data.conversations=[session];session.draft='未送信🌸';
  for(let i=0;i<12;i++)session.messages.push({id:String(i),role:'assistant',content:'星'.repeat(32000),state:'stopped'});
  const bytes=new TextEncoder().encode(JSON.stringify(migrationEnvelope(data))),read=vi.fn(async(r:ChunkRequest)=>bytes.slice(r.offset,r.offset+MIGRATION_CHUNK));
  const info={...manifest,backup:{bytes:bytes.length,sha256:migrationHash(bytes)}},c=connection(info,read);
  expect(bytes.length).toBeGreaterThan(MIGRATION_CHUNK);
  expect(validateManifest(await c.reader.request('manifest'))).toEqual(info);
  expect(parseMigration(await c.reader.backup(info)).data).toEqual(data);
  expect(read.mock.calls.map(([r])=>r.offset)).toEqual([0,MIGRATION_CHUNK]);
});
it('rejects corruption and short chunks before importing anything',async()=>{
  const corrupt=connection(manifest,async()=>new Uint8Array([1,2]));
  await expect(corrupt.reader.backup(manifest)).rejects.toThrow('SHA-256');
  const short=connection(manifest,async()=>new Uint8Array([1]));
  await expect(short.reader.backup(manifest)).rejects.toThrow('size');
});
it('cancels a pending request and rejects concurrent requests',async()=>{
  const ports=new MessageChannel(),abort=new AbortController(),reader=new MigrationReader(ports.port1,abort.signal);
  cleanup.push(()=>{reader.close();ports.port2.close();});
  const pending=reader.request('manifest');
  await expect(reader.request('manifest')).rejects.toThrow('Concurrent');
  abort.abort();await expect(pending).rejects.toThrow('cancelled');
  await expect(reader.request('manifest')).rejects.toThrow('closed');
});
it('rejects a reply from a different request instead of applying it',async()=>{
  const ports=new MessageChannel(),reader=new MigrationReader(ports.port1,new AbortController().signal);
  cleanup.push(()=>{reader.close();ports.port2.close();});
  ports.port2.onmessage=event=>{if(event.data.op==='manifest')ports.port2.postMessage({id:event.data.id+1,value:manifest});};
  await expect(reader.request('manifest')).rejects.toThrow('out of order');
});
it('bounds a stalled connection without leaving a pending promise',async()=>{
  vi.useFakeTimers();const ports=new MessageChannel(),reader=new MigrationReader(ports.port1,new AbortController().signal);
  cleanup.push(()=>{reader.close();ports.port2.close();});
  const pending=expect(reader.request('manifest')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(30000);await pending;
});
it('refuses misaligned offsets at the source before reading storage',async()=>{
  const read=vi.fn(async()=>new Uint8Array([1,2])),c=connection(manifest,read);
  await expect(c.reader.request('read',{kind:'backup',offset:1})).rejects.toThrow('read failed');
  expect(read).not.toHaveBeenCalled();
});
