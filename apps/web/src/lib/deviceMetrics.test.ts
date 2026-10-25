import { expect, it } from 'vitest';
import fixture from '../../../../tests/fixtures/device-research.json';
import { computeDeviceMetrics, memoryMetrics, memoryProbe, metricRound } from './deviceMetrics';
import { retrieveMemories } from './deviceCore';
import { MemoryOptionsSchema, ScenarioCardSchema } from '../../../../packages/schemas/src';

it('matches Native metrics, keyword diagnostics, memory summaries and binary-float rounding',()=>{
  for(const row of fixture.metrics)expect(computeDeviceMetrics(row.turns)).toEqual(row.expected);
  for(const row of fixture.probes){const p=row.input;expect(memoryProbe(p.expect,p.forbid,p.reply,p.context,p.stored,p.trace)).toEqual(row.expected);}
  expect(memoryMetrics(fixture.summary.turns)).toEqual(fixture.summary.expected);
  for(const row of fixture.rounding)expect(metricRound(row.value,row.digits)).toBe(row.expected);
});
it('preserves probe contracts and rejects duplicate scenario turns and invalid memory limits',()=>{
  const turn={turn:1,user:'hello',new_session:true,expect_recall:['tea'],forbid_recall:['coffee']};
  expect(ScenarioCardSchema.parse({id:'test',turns:[turn]}).turns[0]).toMatchObject(turn);
  expect(()=>ScenarioCardSchema.parse({id:'test',turns:[turn,turn]})).toThrow('unique');
  expect(()=>MemoryOptionsSchema.parse({top_k:0})).toThrow();
  const memories=Array.from({length:3},(_,i)=>({id:String(i),type:'semantic' as const,content:'記憶'+i,origin:'manual',supported:true,status:'active'}));
  expect(retrieveMemories(memories,'unrelated',{fill_recent:false}).injected).toEqual([]);
  expect(retrieveMemories(memories,'unrelated',{top_k:1}).injected).toEqual(['2']);
});
