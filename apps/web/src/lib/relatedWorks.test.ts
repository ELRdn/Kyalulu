import { expect, it } from 'vitest';
import { relatedPublicWorks } from './relatedWorks';
import type { PublicWork } from './community';
const work = (id: string, tags: string[], description = '', likes = 0) => ({ id, name: id, tags, description, likes } as PublicWork);
it('ranks by normalized public tags/content and ignores popularity, self and duplicates', () => {
  const source = work('source', ['Fantasy', '学園'], '秘密の図書館');
  const popular = work('popular', ['料理'], '', 100000);
  const tag = work('tag', ['ＦＡＮＴＡＳＹ']);
  const both = work('both', ['Fantasy', '学園']);
  const content = work('content', [], '秘密の図書館');
  expect(relatedPublicWorks(source, [popular, tag, both, source, content, tag]).map(work => work.id)).toEqual(['both', 'tag', 'content']);
});
it('returns no suggestion when public content does not match and bounds the result', () => {
  const source = work('source', ['学園']);
  expect(relatedPublicWorks(source, [work('other', ['料理'])])).toEqual([]);
  expect(relatedPublicWorks(source, [work('a', ['学園']), work('b', ['学園'])], 1).map(work => work.id)).toEqual(['a']);
});
