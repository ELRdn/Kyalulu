import type { PublicWork } from './community';
const normalize = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase('ja');
const words = (work: PublicWork) => new Set(normalize(`${work.name} ${work.description}`).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3));

/** Uses only public tags/text. Counts, author identity and private activity never affect ranking. */
export function relatedPublicWorks(source: PublicWork, candidates: PublicWork[], limit = 4): PublicWork[] {
  const tags = new Set(source.tags.map(normalize).filter(Boolean));
  const content = words(source);
  const unique = new Map(candidates.filter(work => work.id !== source.id).map(work => [work.id, work]));
  return [...unique.values()].map(work => ({ work, score:
    [...new Set(work.tags.map(normalize).filter(Boolean))].filter(tag => tags.has(tag)).length * 4 +
    [...words(work)].filter(word => content.has(word)).length,
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.work.id.localeCompare(b.work.id))
    .slice(0, limit).map(item => item.work);
}
