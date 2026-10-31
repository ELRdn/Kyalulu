import { expect,it,vi } from 'vitest';
vi.mock('./appContext',()=>({deviceOwner:()=> 'owner'}));
import { storageStep,storageWrite } from './segmentedStorage';

it('stops queued and nested callbacks after the first storage failure',()=>{
  const abort=vi.fn(()=>{if(abort.mock.calls.length>1)throw new DOMException('Transaction finished','InvalidStateError');});
  const tx={abort} as unknown as IDBTransaction,late=vi.fn();
  let complete!:()=>void;
  storageWrite(tx,next=>{complete=next;});
  storageWrite(tx,()=>{storageStep(tx,()=>{throw Error('Missing required snapshot');});complete();});
  storageWrite(tx,late);
  expect(()=>complete()).not.toThrow();
  storageStep(tx,late);
  expect(abort).toHaveBeenCalledTimes(1);expect(late).not.toHaveBeenCalled();
  const another={abort:vi.fn()} as unknown as IDBTransaction;
  storageStep(another,late);expect(late).toHaveBeenCalledTimes(1);expect(another.abort).not.toHaveBeenCalled();
});
