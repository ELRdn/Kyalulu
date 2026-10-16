import { z } from 'zod';
import { PortableDocumentSchema } from './portable';
export const PublicWorkSchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), tags: z.array(z.string()),
  author_id: z.string(), author_name: z.string(), revision: z.number().int().positive(),
  likes: z.number().int().nonnegative(), saves: z.number().int().nonnegative(), comments: z.number().int().nonnegative(),
  document: PortableDocumentSchema, reactions: z.array(z.enum(['like', 'save'])).default([]),
  following: z.boolean().default(false), owned: z.boolean().default(false),
});
export type PublicWork = z.infer<typeof PublicWorkSchema>;
export const CommentSchema = z.object({ id: z.string(), text: z.string(), author_id: z.string(), author_name: z.string(), created: z.number() });
export type WorkComment = z.infer<typeof CommentSchema>;

export const PublicAuthorSchema = z.object({ id: z.string(), name: z.string(), followers: z.number().int().nonnegative() });
