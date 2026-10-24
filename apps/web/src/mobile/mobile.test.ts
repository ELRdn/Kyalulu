import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Sha256 } from './sha256';
import { initialData, newConversation, parseBackup } from './store';
import { fitContext, conversationTurns } from './context';
import { MODELS, validateCatalog, fingerprint } from './models';
import type { ChatTurn } from './types';

describe('streaming SHA-256',()=>{
  it.each([0,1,55,56,63,64,65,1000000])('matches independent crypto digest at %i bytes across chunk boundaries',length=>{
    const bytes=Uint8Array.from({length},(_,i)=>(i*17+31)%256),h=new Sha256();
    for(let i=0;i<bytes.length;i+=137)h.update(bytes.subarray(i,i+137));
    expect(h.digest()).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
describe('backup boundary',()=>{
  it('roundtrips unicode, a stopped response and a snapshot of a deleted character',()=>{
    const d=initialData(),c={...d.characters[0],id:'deleted',name:'ひろなおのキャラ'},s=newConversation(c,'kyalulu-iq3m');
    s.messages.push({id:'stop',role:'assistant',content:'途中…',state:'stopped'});d.conversations=[s];
    expect(parseBackup(JSON.stringify(d))).toEqual(d);
  });
  it('rejects malformed, future-version and duplicate records before a restore',()=>{
    expect(()=>parseBackup('{')).toThrow();
    expect(()=>parseBackup(JSON.stringify({...initialData(),version:2}))).toThrow();
    const d=initialData();d.characters.push(d.characters[0]);expect(()=>parseBackup(JSON.stringify(d))).toThrow();
    const e=initialData();e.conversations=[newConversation(e.characters[0],'kyalulu-iq3m')];
    e.conversations[0].messages.push(e.conversations[0].messages[0]);expect(()=>parseBackup(JSON.stringify(e))).toThrow();
  });
});
describe('context window',()=>{
  it('retains the system and newest user message without mutating the saved history',async()=>{
    const t:ChatTurn[]=[{role:'system',content:'設定'},{role:'user',content:'古い質問'},{role:'assistant',content:'古い応答'},{role:'user',content:'最新'}];
    const result=await fitContext(t,a=>a.length*600);
    expect(result.messages).toEqual([t[0],t[3]]);expect(result.omitted).toBe(2);expect(t).toHaveLength(4);
  });
  it('rejects an oversized setting/current message rather than truncating it',async()=>{
    await expect(fitContext([{role:'system',content:'x'.repeat(2000)},{role:'user',content:'hi'}])).rejects.toThrow('長すぎ');
  });
  it('does not feed interrupted assistant output into the next prompt',()=>{
    const d=initialData(),s=newConversation(d.characters[0],'kyalulu-iq3m');
    s.messages.push({id:'partial',role:'assistant',content:'UNFINISHED',state:'interrupted'});
    expect(conversationTurns(s).some(m=>m.content==='UNFINISHED')).toBe(false);
  });
  it('merges consecutive user turns after a stopped generation without deleting saved messages',()=>{
    const d=initialData(),s=newConversation(d.characters[0],'kyalulu-iq3m');
    s.messages.push({id:'a',role:'user',content:'前の入力'},{id:'b',role:'assistant',content:'途中',state:'stopped'},{id:'c',role:'user',content:'次の入力'});
    expect(conversationTurns(s).at(-1)).toEqual({role:'user',content:'前の入力\n\n次の入力'});
    expect(s.messages).toHaveLength(4);
  });
});
describe('pinned model catalog',()=>{
  it('has four explicitly selected variants and pins every distribution file',()=>{
    expect(MODELS.map(m=>m.id).sort()).toEqual(['google-mobile-onnx','google-q4','heretic-iq3m','kyalulu-iq3m']);
    for(const id of ['kyalulu-iq3m','heretic-iq3m']) {
      const m=MODELS.find(m=>m.id===id)!;expect(m.name).toContain('IQ3_M');
    }
    expect(()=>validateCatalog(MODELS)).not.toThrow();
    const onnx=MODELS.find(m=>m.runtime==='onnx')!;
    expect(onnx.files.some(f=>/audio|vision/.test(f.path))).toBe(false);
    expect(onnx.files.some(f=>f.path.endsWith('q2f16.onnx_data'))).toBe(true);
  });
  it('rejects mutable URLs, duplicate paths, wrong hashes and oversized GGUF',()=>{
    const m=structuredClone(MODELS.find(m=>m.runtime==='onnx')!);
    const original=structuredClone(m.files[0]);
    m.files[0].url=m.files[0].url.replace(m.revision,'main');expect(()=>validateCatalog([m])).toThrow();
    m.files=[original,original];expect(()=>validateCatalog([m])).toThrow();
    m.files=[{...original,sha256:'bad'}];expect(()=>validateCatalog([m])).toThrow();
    m.runtime='gguf';m.files=[{...original,bytes:2**31}];expect(()=>validateCatalog([m])).toThrow('2GiB');
  });
  it('invalidates readiness when a file hash changes',()=>{
    const m=structuredClone(MODELS.find(m=>m.runtime==='onnx')!);const old=fingerprint(m);
    m.files[0].sha256='0'.repeat(64);expect(fingerprint(m)).not.toBe(old);
  });
});
