/**
 * 共通スキーマ — M3 Character Runtime
 * Frontend (Zod) と Backend (Pydantic) で共有する概念を定義
 */

import { z } from "zod";

export const VersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const RelationshipSchema = z.enum(["stranger", "acquaintance", "friend", "intimate", "partner"]);
export type RelationshipLevel = z.infer<typeof RelationshipSchema>;

// Character
export const CharacterCardSchema = z.object({
  id: z.string().min(1),
  version: VersionSchema.default("0.1.0"),
  display_name: z.string().min(1),
  description: z.string().default(""),
  species: z.string().default(""),
  age: z.string().default(""),
  personality: z.string().default(""),
  speaking_style: z.string().default(""),
  intro: z.string().default(""),
  tags: z.array(z.string()).default([]),
  difficulty: DifficultySchema.default("easy"),
  recommended_generation: z.record(z.unknown()).default({}),
  notes: z.string().default(""),
  nsfw: z.boolean().default(false),
});
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

// Persona
export const PersonaCardSchema = z.object({
  id: z.string().min(1),
  version: VersionSchema.default("0.1.0"),
  display_name: z.string().min(1),
  description: z.string().default(""),
  traits: z.string().default(""),
});
export type PersonaCard = z.infer<typeof PersonaCardSchema>;

// World
export const WorldCardSchema = z.object({
  id: z.string().min(1),
  version: VersionSchema.default("0.1.0"),
  display_name: z.string().min(1),
  description: z.string().default(""),
  rules: z.string().default(""),
});
export type WorldCard = z.infer<typeof WorldCardSchema>;

// State
export const RuntimeStateSchema = z.object({
  session_id: z.string().default("default"),
  turn: z.number().int().min(0).default(0),
  relationship: RelationshipSchema.default("stranger"),
  last_summary: z.string().default(""),
  character_id: z.string().nullable().default(null),
  persona_id: z.string().nullable().default(null),
  world_id: z.string().nullable().default(null),
  prompt_version: z.string().default("prompt:character-runtime@0.1.0"),
  state_version: z.string().default("0.1.0"),
});
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;

// Compiled Prompt
export const CompiledPromptSchema = z.object({
  system_prompt: z.string(),
  prompt_version: z.string().default("prompt:character-runtime@0.1.0"),
  character_version: z.string().nullable().default(null),
  persona_version: z.string().nullable().default(null),
  world_version: z.string().nullable().default(null),
  token_estimate: z.number().int().min(0).default(0),
  sections: z.record(z.string()).default({}),
});
export type CompiledPrompt = z.infer<typeof CompiledPromptSchema>;

// Scenario (M4)
export const ScenarioEventTypeSchema = z.enum([
  "normal",
  "preference_injection",
  "fact_injection",
  "promise_creation",
  "emotional_shift",
  "relationship_shift",
  "contradiction_challenge",
  "canon_challenge",
  "callback_opportunity",
  "story_progression",
  "user_agency_test",
]);
export type ScenarioEventType = z.infer<typeof ScenarioEventTypeSchema>;

export const ScenarioTurnSchema = z.object({
  turn: z.number().int().min(1),
  type: ScenarioEventType.default("normal"),
  user: z.string().min(1),
});
export type ScenarioTurn = z.infer<typeof ScenarioTurnSchema>;

export const ScenarioCardSchema = z.object({
  id: z.string().min(1),
  version: VersionSchema.default("0.1.0"),
  character: z.string().nullable().default(null),
  difficulty: DifficultySchema.default("easy"),
  persona: z.string().nullable().default(null),
  world: z.string().nullable().default(null),
  description: z.string().default(""),
  turns: z.array(ScenarioTurnSchema).min(1),
  nsfw: z.boolean().default(false),
  nsfw_level: z.enum(["innuendo", "explicit"]).nullable().default(null),
});
export type ScenarioCard = z.infer<typeof ScenarioCardSchema>;

export const ExperimentMetaSchema = z.object({
  experiment_id: z.string().min(1),
  runtime_version: z.string().default("0.1.0"),
  model_id: z.string().min(1),
  model_version: z.string().nullable().default(null),
  quantization: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
  generation_config: z.record(z.unknown()).default({}),
  character_id: z.string().nullable().default(null),
  character_version: z.string().nullable().default(null),
  world_id: z.string().nullable().default(null),
  world_version: z.string().nullable().default(null),
  persona_id: z.string().nullable().default(null),
  persona_version: z.string().nullable().default(null),
  prompt_id: z.string().nullable().default(null),
  prompt_version: z.string().default("prompt:character-runtime@0.1.0"),
  scenario_id: z.string().min(1),
  scenario_version: z.string().default("0.1.0"),
  run_number: z.number().int().min(1),
  seed: z.number().int().nullable().default(null),
  hardware_metadata: z.record(z.unknown()).default({}),
  timestamp: z.string(),
  turns: z.number().int().default(20),
  status: z.string().default("completed"),
  nsfw: z.boolean().default(false),
  nsfw_level: z.string().nullable().default(null),
});
export type ExperimentMeta = z.infer<typeof ExperimentMetaSchema>;
