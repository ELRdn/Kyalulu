import { expect, it, vi } from 'vitest';
vi.mock('./transport',()=>({apiFetch:vi.fn(async()=>new Response('{"error":"publication_revision_conflict"}',{status:409,headers:{'Content-Type':'application/json'}}))}));
import { cloudJson } from './cloud';
it('preserves a structured API code while retaining the existing friendly message',async()=>{
  await expect(cloudJson('app/publications')).rejects.toMatchObject({code:'publication_revision_conflict',message:expect.stringContaining('利用条件')});
});
