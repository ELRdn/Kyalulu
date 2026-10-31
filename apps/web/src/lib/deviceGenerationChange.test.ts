import { expect,it } from 'vitest';
import { generationChangeView,validateGenerationReceipt,type GenerationChange } from './deviceGenerationChange';
import { deviceExecutionLockName } from './deviceExecution';
import { Sha256 } from '../mobile/sha256';

const hash=(value:string)=>new Sha256().update(new TextEncoder().encode(value)).digest();
const user={id:1,uuid:'user',role:'user',content:'Tea 茶🙂'},oldReply={id:2,uuid:'old',role:'assistant',content:'Old reply',before:{state:{turn:0},memories:[]},unknown:{keep:true}};
const source={storage_policy:'local',settings:{session_id:'chat'},state:{turn:1},memories:[],summaries:[],draft:'Keep draft',last_generation:{generation_id:'prior'},unknown:{keep:true}};
const receipt=(status:string,userId=1)=>({generation_id:'next',session_id:'chat',status,user_id:userId,assistant_id:status==='completed'?3:null,
  user_content_sha256:hash(user.content),execution_lock:deviceExecutionLockName('owner'),...(status==='completed'?{reply:'New reply',full:'New reply'}:{})});
const apply=(messages:any[],original:any,change:GenerationChange):Record<string,any>=>{
  const view=generationChangeView(change),retained=messages.flatMap(message=>{const result=view.message(message);return result===null?[]:[result];});
  return {...view.finish(original),messages:[...retained,...change.append]};
};

it.each(['pending','completed','failed'])('preserves the original reply during regeneration except completed replacement (%s)',status=>{
  const baseline=structuredClone({source,messages:[user,oldReply]}),pending=receipt('pending');
  const original={...source,...(status==='pending'?{}:{pending_generation:'next'})};
  const change:GenerationChange={metadata:{...source,pending_generation:status==='pending'?'next':null},regenerate:2,receipt:receipt(status),
    append:status==='completed'?[{id:3,uuid:'new',role:'assistant',content:'New reply'}]:[]};
  validateGenerationReceipt('owner','chat',change,status==='pending'?undefined:pending);
  const next=apply([user,oldReply],original,change);
  expect(next.messages).toEqual(status==='completed'?[user,change.append[0]]:[user,oldReply]);
  for(const key of ['settings','state','memories','summaries','draft','unknown'])expect(next[key]).toEqual(source[key as keyof typeof source]);
  expect(next.last_generation).toEqual(status==='completed'?change.receipt:source.last_generation);
  expect({source,messages:[user,oldReply]}).toEqual(baseline);
});

it('admits one durable user and retains it when generation fails',()=>{
  const first:GenerationChange={metadata:{...source,pending_generation:'next'},append:[user],receipt:receipt('pending')};
  const admitted=apply([],source,first);expect(admitted.messages).toEqual([user]);
  const failure:GenerationChange={metadata:{...source,pending_generation:null},append:[],receipt:receipt('failed')};
  const next=apply(admitted.messages,admitted,failure);expect(next.messages).toEqual([user]);expect(next.pending_generation).toBeNull();
});

it.each(['owner','session','user','hash','status','duplicate'])('rejects forged or reused receipts (%s)',fault=>{
  const previous=receipt('pending'),change:GenerationChange={metadata:{...source,pending_generation:null},append:[],receipt:receipt('failed')};
  if(fault==='owner')change.receipt.execution_lock=deviceExecutionLockName('foreign');
  if(fault==='session')change.receipt.session_id='foreign';
  if(fault==='user')previous.user_id=99;
  if(fault==='hash')previous.user_content_sha256=hash('different user');
  if(fault==='status')previous.status='completed';
  if(fault==='duplicate')change.receipt.status='pending';
  expect(()=>validateGenerationReceipt('owner','chat',change,previous)).toThrow('Generation receipt changed');
});

it.each(['pending','policy','tail','reply','identity'])('rejects a stale source or invalid append (%s)',fault=>{
  const original={...source,pending_generation:'next'},append={id:3,uuid:'new',role:'assistant',content:'New reply'};
  const change:GenerationChange={metadata:{...source,pending_generation:null},regenerate:2,receipt:receipt('completed'),append:[append]};
  if(fault==='pending')original.pending_generation='other';
  if(fault==='policy')change.metadata.storage_policy='sync';
  if(fault==='tail')change.regenerate=99;
  if(fault==='reply')append.content='Forged reply';
  if(fault==='identity')append.id=2;
  expect(()=>apply([user,oldReply],original,change)).toThrow();
});
