import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sessionTitle, type SessionInfo, type WorldInfo, type CharacterInfo } from '../lib/api';
import CharacterCard from '../components/ui/CharacterCard';
import WorldCard from '../components/ui/WorldCard';
import Avatar from '../components/ui/Avatar';
import Button from '../components/ui/Button';
import { cleanPreview, formatRelative } from '../lib/text';
import { useDisplayName } from '../lib/profile';
import { useAdultContent } from '../lib/adult';
import { useDocumentTitle } from '../lib/title';
import { friendlyMessage } from '../lib/errors';
import { useRuntimeAccess } from '../components/RuntimeGate';
import { fetchBrowseCatalog, isCloudGuest } from '../lib/cloudGuest';
import { labels, useLanguage, usePreferences } from '../lib/appContext';
import { recommend } from '../lib/recommendations';
import './pages.css';
import { useSavedCharacters } from '../lib/saved';

export default function Home() {
  const guest=isCloudGuest(useRuntimeAccess()),navigate=useNavigate(),language=useLanguage(),t=labels[language],en=language==='en';
  const [sessions,setSessions]=useState<SessionInfo[]>([]),[worlds,setWorlds]=useState<WorldInfo[]>([]),[characters,setCharacters]=useState<CharacterInfo[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState<{cause:unknown}|null>(null),[retry,setRetry]=useState(0);
  const prefs=usePreferences(),[adult]=useAdultContent(),name=useDisplayName();
  useDocumentTitle(null);
  useEffect(()=>{
    let active=true;setLoading(true);setError(null);
    fetchBrowseCatalog(guest,adult).then(([c,w,s])=>{if(active){setCharacters(c);setWorlds(w);setSessions(s);}})
      .catch(e=>{if(active)setError({cause:e});}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[adult,guest,retry]);
  const favorites=useSavedCharacters();
  const featured=recommend(characters,{...prefs,favorites},adult).slice(0,10),recent=sessions.filter(s=>s.count>0).slice(0,4);
  // One large "today's pick" that changes daily, then the rest in two columns (docs/MOBILE_UX_SPEC.md §5.1).
  const todayIndex=featured.length?Math.floor(Date.now()/864e5)%featured.length:0,today=featured[todayIndex],others=featured.filter((_,i)=>i!==todayIndex);
  const card=(c:CharacterInfo)=><CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} tags={c.tags??[]} creator={c.official?'Kyalulu Official':en?'My library':'マイライブラリ'} portraitUrl={c.portrait_url}/>;
  return <div className="k-page k-page--home">
    <header className="k-home-identity"><img src={`${import.meta.env.BASE_URL}mascot/v2/pose-wave.webp`} alt="" width={72} height={72}/><div><h1>Kyalulu</h1><p>{en?`Welcome, ${name}`:`${name}、今日は誰と話す？`}</p></div></header>
    {error&&<p role="alert">{friendlyMessage(error.cause,language)} <Button variant="secondary" onClick={()=>setRetry(v=>v+1)}>{en?'Retry':'再読み込み'}</Button></p>}
    <section className="k-section" aria-labelledby="home-recommendations">
      <div className="k-section__head"><h2 id="home-recommendations" className="k-section__title">{t.recommended}</h2><Link to="/discover">{t.discover}</Link></div>
      {loading?<div className="k-grid k-grid--characters" aria-busy="true">{[0,1,2,3].map(i=><div className="k-skeleton-card" key={i}/>)}</div>:<>
        {today&&<div className="k-home-today"><p className="k-home-today__label">{en?"Today's pick":'今日の一人'}</p>{card(today)}</div>}
        {!!others.length&&<div className="k-grid k-grid--characters">{others.map(card)}</div>}
      </>}
      {!loading&&!error&&!featured.length&&<p>{en?'No recommendations yet.':'おすすめはまだありません。'}</p>}
    </section>
    {!!recent.length&&<section className="k-section" aria-labelledby="home-recent">
      <div className="k-section__head"><h2 id="home-recent" className="k-section__title">{t.resume}</h2><Link to="/chats">{t.chats}</Link></div>
      <div className="k-resume-grid">{recent.map(s=><Link key={s.session_id} to={`/chats/${encodeURIComponent(s.session_id)}`} className="k-resume-card">
        <div className="k-resume-card__top"><Avatar name={sessionTitle(s,language)} size="lg" src={s.portrait_url} mascot={!s.character_name}/><div className="k-resume-card__who"><span className="k-resume-card__name">{sessionTitle(s,language)}</span><span className="k-resume-card__time">{formatRelative(s.last_at, language)}</span></div></div>
        <p className="k-resume-card__preview">{cleanPreview(s.last_preview,90)}</p>
      </Link>)}</div>
    </section>}
    {!!worlds.length&&<section className="k-section"><h2 className="k-section__title">{en?'Worlds':'ワールド'}</h2><div className="k-grid k-grid--worlds">{worlds.map(w=><WorldCard key={w.id} id={w.id} displayName={w.display_name} description={w.description} onClick={()=>navigate(`/discover?world=${encodeURIComponent(w.id)}`)}/>)}</div></section>}
  </div>;
}
