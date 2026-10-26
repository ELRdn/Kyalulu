import { z } from 'zod';
import { PublicWorkSchema } from './community';
import { PortableDocumentSchema } from './portable';

export const PublicationSnapshotSchema=z.object({
  schema_version:z.literal(1),kind:z.literal('character'),name:z.string().trim().min(1).max(120),nsfw:z.boolean(),speaking_style:z.string(),
  data:z.object({description:z.string().optional(),personality:z.string().optional(),scenario:z.string().optional(),first_mes:z.string().optional(),mes_example:z.string().optional(),creator_notes:z.string().optional(),tags:z.array(z.string().max(80)).max(30).optional(),alternate_greetings:z.array(z.string().max(8000)).max(16).optional()}),
});

export const PublicationResultSchema=z.object({id:z.string(),revision:z.number().int().positive(),status:z.enum(['pending','approved','rejected','hidden','withdrawn'])});
export const PublicationSchema=PublicationResultSchema.extend({
  rating:z.enum(['general','adult']),reason:z.string(),document:PortableDocumentSchema,
  snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/),author_name:z.string(),owned:z.boolean(),
  source:z.object({item_id:z.string().nullable(),revision:z.number().int().positive()}),classification:z.literal('unknown'),
  events:z.array(z.object({revision:z.number().int().positive(),decision:z.string(),reason:z.string(),checks:z.string()})),
  reports:z.array(z.object({id:z.string(),revision:z.number().int().positive(),reason:z.string()})),
  appeals:z.array(z.object({id:z.string(),revision:z.number().int().positive(),reason:z.string()})),
});
export const PublicationQueueSchema=z.object({publications:z.array(PublicationSchema),moderator:z.boolean(),owner_scope:z.string().min(1),account_name:z.string()});
export const PublicationViewerSchema=z.object({authenticated:z.boolean(),owner_scope:z.string(),account_name:z.string()});
export const PublishedWorkSchema=PublicWorkSchema.extend({moderation_revision:z.number().int().positive(),snapshot_hash:z.string().regex(/^[a-f0-9]{64}$/),rating:z.enum(['general','adult'])});
export type Publication=z.infer<typeof PublicationSchema>;
export type PublishedWork=z.infer<typeof PublishedWorkSchema>;
