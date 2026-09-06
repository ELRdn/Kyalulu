import { z } from 'zod';

export const ImportNoticeSchema = z.object({ path: z.string(), status: z.enum(['applied', 'converted', 'preserved', 'error']), reason: z.string() });
export const PortableAssetSchema = z.object({ name: z.string(), type: z.string().default('icon'), uri: z.string().default(''), media_type: z.string().default(''), asset_id: z.string().nullable().default(null) }).passthrough();
export const PortableProfileSchema = z.object({ settings: z.record(z.unknown()).default({}), system_prompt: z.string().default(''), post_history_instructions: z.string().default(''), context_template: z.string().default(''), prompts: z.array(z.record(z.unknown())).default([]), model_hint: z.string().default(''), variables: z.record(z.string()).default({}) }).passthrough();
export const PortableHistorySchema = z.object({ name: z.string().default('Imported conversation'), messages: z.array(z.record(z.unknown())).default([]) }).passthrough();
export const PortableDocumentSchema = z.object({ schema_version: z.literal(1).default(1), kind: z.enum(['character', 'profile', 'lorebook']).default('character'), name: z.string(), data: z.record(z.unknown()).default({}), speaking_style: z.string().default(''), nsfw: z.boolean().default(false), profile: PortableProfileSchema.default({}), assets: z.array(PortableAssetSchema).default([]), histories: z.array(PortableHistorySchema).default([]), source_format: z.string().default('kyalulu'), source: z.record(z.unknown()).default({}), notices: z.array(ImportNoticeSchema).default([]) }).passthrough();
export const LibraryItemSchema = z.object({ id: z.string(), revision: z.number().int().positive(), document: PortableDocumentSchema, original_id: z.string().nullable().default(null) });
export const LibraryRefSchema = z.object({ id: z.string(), revision: z.number().int().positive() });
export const LibraryBindingSchema = z.object({ character: LibraryRefSchema.nullable().default(null), profile: LibraryRefSchema.nullable().default(null), lorebooks: z.array(LibraryRefSchema).default([]), expression_asset_id: z.string().nullable().default(null) });
export const ImportPreviewSchema = z.object({ preview_id: z.string(), filename: z.string(), source_hash: z.string(), documents: z.array(PortableDocumentSchema) });
export const ImportCommitSchema = z.object({ request_id: z.string().min(1).max(128), selections: z.array(z.object({ index: z.number().int().nonnegative(), document: PortableDocumentSchema, history_indices: z.array(z.number().int().nonnegative()).default([]), target_id: z.string().nullable().default(null), expected_revision: z.number().int().positive().nullable().default(null) })).min(1) });
export type PortableDocument = z.infer<typeof PortableDocumentSchema>;
export type PortableAsset = z.infer<typeof PortableAssetSchema>;
export type LibraryItem = z.infer<typeof LibraryItemSchema>;
export type LibraryBinding = z.infer<typeof LibraryBindingSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportCommit = z.infer<typeof ImportCommitSchema>;
