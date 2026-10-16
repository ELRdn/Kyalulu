import { z } from 'zod';

export const CastMemberSchema = z.object({
  id: z.string().min(1).max(80), display_name: z.string().min(1).max(120),
  personality: z.string().max(2000).default(''), speaking_style: z.string().max(1000).default(''),
  knowledge: z.string().max(2000).default(''), relationships: z.string().max(2000).default(''),
}).strict();
const inventoryName = z.string().trim().min(1).max(120);
export const RuleActionSchema = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(120), trigger: z.string().min(1).max(120),
  skill: z.string().max(80).default(''), difficulty: z.number().int().min(1).max(100).default(10),
  hp_delta: z.number().int().min(-10000).max(10000).default(0),
  inventory_add: z.array(inventoryName).max(20).default([]), inventory_remove: z.array(inventoryName).max(20).default([]),
}).strict();
export const RPGOptionsSchema = z.object({
  initial_hp: z.number().int().min(1).max(100000).default(100),
  initial_inventory: z.array(inventoryName).max(100).default([]),
  skills: z.record(z.string().trim().min(1).max(80), z.number().int().min(-20).max(20)).default({}),
  actions: z.array(RuleActionSchema).max(50).default([]),
}).strict().superRefine((value, context) => {
  if (Object.keys(value.skills).length > 50) context.addIssue({ code: 'custom', message: '技能は50件までです', path: ['skills'] });
  if (new Set(value.actions.map(action => action.id)).size !== value.actions.length ||
      new Set(value.actions.map(action => action.trigger.toLowerCase())).size !== value.actions.length) {
    context.addIssue({ code: 'custom', message: '行動ID・判定キーワードは重複できません', path: ['actions'] });
  }
  value.actions.forEach((action, index) => { if (action.skill && !(action.skill in value.skills)) context.addIssue({ code: 'custom', message: '使う技能を先に登録してください', path: ['actions', index, 'skill'] }); });
});
export type CastMember = z.infer<typeof CastMemberSchema>;
export type RPGOptions = z.infer<typeof RPGOptionsSchema>;
