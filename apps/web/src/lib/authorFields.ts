// Author-facing card fields (docs/MOBILE_UX_SPEC.md §6). Keep in sync with runtime/python/core/author_fields.py.
export const MAX_TAGS = 10, MAX_TAG_LENGTH = 20, MAX_HOOK_LENGTH = 60, MAX_OPENING_REPLIES = 3, MAX_REPLY_LENGTH = 100;
const BANNED = ['ロリ', 'ロリコン', 'ショタ', 'ショタコン', '幼女', '幼児', '園児', '小学生', '中学生', '児童',
  'JS', 'JC', 'loli', 'lolicon', 'shota', 'shotacon', 'underage', 'preteen', 'child', 'minor'];

const fold = (text: string) => text.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const cleanTag = (tag: string) => tag.normalize('NFKC').trim().replace(/^#+/, '').trim().split(/\s+/).filter(Boolean).join(' ');
/** Comparison key: "＃ネコ", "#ねこ" and "ネコ" are one tag. */
export const tagKey = (tag: string) => fold(tag.normalize('NFKC').trim().replace(/^#+/, '').trim().toLowerCase());
const BANNED_KEYS = new Set(BANNED.map(tagKey));

export type TagProblem = 'empty' | 'long' | 'banned' | 'duplicate' | 'full';
/** Why a new tag cannot be added to `tags`, or null when it can. */
export function tagProblem(tag: string, tags: unknown[]): TagProblem | null {
  const text = cleanTag(tag), key = tagKey(tag), existing = tags.filter((t): t is string => typeof t === 'string');
  if (!text) return 'empty';
  if (text.length > MAX_TAG_LENGTH) return 'long';
  if (BANNED_KEYS.has(key)) return 'banned';
  if (existing.some(t => tagKey(t) === key)) return 'duplicate';
  if (existing.length >= MAX_TAGS) return 'full';
  return null;
}
