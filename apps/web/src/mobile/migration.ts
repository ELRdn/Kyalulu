import { Sha256 } from './sha256';
import { parseBackup, type loadData } from './store';

export const migrationHash=(bytes:Uint8Array)=>new Sha256().update(bytes).digest();
export function migrationEnvelope(data:Awaited<ReturnType<typeof loadData>>) {
  const payload=JSON.stringify(data),bytes=new TextEncoder().encode(payload);
  return {format:'kyalulu-mobile-migration-v1',revision:1,bytes:bytes.length,sha256:migrationHash(bytes),payload};
}
export function parseMigration(text:string) {
  if(text.length>40*1024**2)throw Error('Migration exceeds 40 MiB');
  const envelope=JSON.parse(text);
  if(envelope?.format!=='kyalulu-mobile-migration-v1'||envelope.revision!==1||typeof envelope.payload!=='string')throw Error('Unsupported migration format');
  const bytes=new TextEncoder().encode(envelope.payload);
  if(bytes.length!==envelope.bytes||migrationHash(bytes)!==envelope.sha256)throw Error('Migration size or SHA-256 mismatch');
  return {data:parseBackup(envelope.payload),sha256:envelope.sha256 as string};
}
