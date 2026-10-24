import { moodsOf } from './moodTaxonomy';
import type { AppPreferences } from './appContext';

type Candidate={id:string;tags?:string[];nsfw?:boolean;blocked?:boolean;status?:string;official?:boolean};
export function recommend<T extends Candidate>(items:T[], prefs:AppPreferences, adult=false):T[] {
  const interests=new Set([...prefs.genres,...prefs.moods,...prefs.activities]);
  return items.filter(c=>(adult||!c.nsfw)&&!c.blocked&&(!c.status||c.status==='approved')&&!prefs.dismissed.includes(c.id))
    .map((c,i)=>({c,i,score:moodsOf(c.tags).reduce((n,m)=>n+(interests.has(m.tag)?3:0),0)
      +(prefs.favorites.includes(c.id)?5:0)+(c.official?1:0)}))
    .sort((a,b)=>b.score-a.score||a.i-b.i).map(v=>v.c);
}
