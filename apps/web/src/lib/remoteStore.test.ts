import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteRemote, selectRemote } from './remoteStore';

const fixture=vi.hoisted(()=>({busy:true}));
vi.mock('./appContext',()=>({generationBusy:()=>fixture.busy}));
beforeEach(()=>{fixture.busy=true;});
afterEach(()=>vi.unstubAllGlobals());

it('retains device keys before a generation-blocked switch can fail',async()=>{
  const open=vi.fn();vi.stubGlobal('indexedDB',{open});
  await expect(deleteRemote('fictional-key')).rejects.toThrow('Stop generation and confirm its saved result');
  expect(open).not.toHaveBeenCalled();
});

it('keeps selected key, execution target and location unchanged during generation',()=>{
  const setItem=vi.fn(),removeItem=vi.fn(),reload=vi.fn(),location={hash:'#/chats/original',reload};
  vi.stubGlobal('localStorage',{setItem,removeItem});vi.stubGlobal('location',location);
  expect(()=>selectRemote(null)).toThrow('Stop generation and confirm its saved result');
  expect(setItem).not.toHaveBeenCalled();expect(removeItem).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();expect(location.hash).toBe('#/chats/original');
});

it('allows explicit key removal to reach storage after generation has stopped',async()=>{
  fixture.busy=false;
  const open=vi.fn(()=>{throw Error('fictional storage failure');});vi.stubGlobal('indexedDB',{open});
  await expect(deleteRemote('fictional-key')).rejects.toThrow('fictional storage failure');
  expect(open).toHaveBeenCalledOnce();
});
