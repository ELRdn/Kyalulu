import { z } from 'zod';

export const CapabilitiesSchema = z.object({
  schema_version: z.literal(1), mode: z.enum(['local', 'cloud']),
  safety_screening: z.boolean().optional(), credit_reservation: z.boolean().optional(),
  features: z.object({
    regenerate: z.boolean(), suggestions: z.boolean(), stored_context: z.boolean(),
    progress: z.boolean(), branch: z.boolean(), permanent_delete: z.boolean(),
    summaries: z.boolean(), world_memory: z.boolean(), story_rules: z.boolean(),
    community: z.boolean(), media_playback: z.boolean(), media_generation: z.boolean(),
  }),
  model_selection: z.enum(['local', 'cloud-routes']),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;
export const GenerationProgressSchema = z.object({
  stage: z.enum(['queue', 'input_safety', 'generation', 'output_safety', 'save']),
  elapsed_ms: z.number().finite().nonnegative(),
});
export type GenerationProgress = z.infer<typeof GenerationProgressSchema>;
export const ConversationSummarySchema = z.object({
  id: z.string().min(1), kind: z.enum(['chapter', 'arc']), text: z.string(),
  revision: z.union([z.string().min(1), z.number().int().positive()]), source_message_ids: z.array(z.number().int()), method: z.string(),
});
export const ChatContextSchema = z.object({
  history_revision: z.string(), summaries: z.array(ConversationSummarySchema),
});
export type ChatContext = z.infer<typeof ChatContextSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
