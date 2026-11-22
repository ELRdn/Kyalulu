import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CharacterInfo } from '../lib/api';
import { RuntimeImage } from '../components/RuntimeMedia';
import Icon from '../components/ui/Icon';
import CharacterCard from '../components/ui/CharacterCard';
import Button from '../components/ui/Button';
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
  const guest=isCloudGuest(useRuntimeAccess()),language=useLanguage(),t=labels[language],en=language==='en';
  const [characters,setCharacters]=useState<CharacterInfo[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState<{cause:unknown}|null>(null),[retry,setRetry]=useState(0);
  const prefs=usePreferences(),[adult]=useAdultContent();
  useDocumentTitle(null);
  useEffect(()=>{
    let active=true;setLoading(true);setError(null);
    fetchBrowseCatalog(guest,adult).then(([c])=>{if(active)setCharacters(c);})
      .catch(e=>{if(active)setError({cause:e});}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[adult,guest,retry]);
  const favorites=useSavedCharacters();
  const featured=recommend(characters,{...prefs,favorites},adult).slice(0,10);
  // One large "today's pick" that changes daily, then the rest in two columns and a way into Search (docs/MOBILE_UX_SPEC.md §5.1).
  const todayIndex=featured.length?Math.floor(Date.now()/864e5)%featured.length:0,today=featured[todayIndex],others=featured.filter((_,i)=>i!==todayIndex);
  const card=(c:CharacterInfo)=><CharacterCard key={c.id} id={c.id} displayName={c.display_name} hook={c.hook || c.description} tags={c.tags??[]} creator={c.official?'Kyalulu Official':en?'My library':'マイライブラリ'} portraitUrl={c.portrait_url}/>;
  return <div className="k-page k-page--home">
    {error&&<p role="alert">{friendlyMessage(error.cause,language)} <Button variant="secondary" onClick={()=>setRetry(v=>v+1)}>{en?'Retry':'再読み込み'}</Button></p>}
    {loading?<div className="k-home-today k-home-today--loading" aria-busy="true"><div className="k-skeleton-card"/></div>
      :today&&<section className="k-home-today" aria-labelledby="home-today">
        <h2 id="home-today" className="k-section__title">{en?"Today's pick":'今日の一人'}</h2>
        <div className="k-home-hero">
          <div className="k-home-hero__art">{today.portrait_url?<RuntimeImage src={today.portrait_url} alt="" className="k-home-hero__img"/>:<span className="k-char-card__initial" aria-hidden="true">{today.display_name.trim().charAt(0)}</span>}</div>
          <div className="k-home-hero__info">
            <p className="k-home-hero__eyebrow" aria-hidden="true">{en?"Today's pick":'今日の一人'}</p>
            <h3 className="k-home-hero__name">{today.display_name}</h3>
            <p className="k-home-hero__hook">{today.hook||today.description}</p>
            <Link to={`/characters/${encodeURIComponent(today.id)}`} className="k-btn k-btn--primary k-btn--lg k-home-hero__cta">{en?'Talk to them':'話してみる'}<Icon name="chevron" size={18}/></Link>
          </div>
        </div>
      </section>}
    <section className="k-section" aria-labelledby="home-recommendations">
      <h2 id="home-recommendations" className="k-section__title">{t.recommended}</h2>
      {loading?<div className="k-grid k-grid--characters" aria-busy="true">{[0,1,2,3].map(i=><div className="k-skeleton-card" key={i}/>)}</div>
        :!!others.length&&<div className="k-grid k-grid--characters">{others.map(card)}
          <Link to="/discover" className="k-home-more"><img src={`${import.meta.env.BASE_URL}mascot/v2/pose-wave.webp`} alt="" width={96} height={96}/><span>{en?'See everyone in Search':'さがすで全員を見る'}</span></Link>
        </div>}
      {!loading&&!error&&!featured.length&&<p>{en?'No recommendations yet.':'おすすめはまだありません。'}</p>}
    </section>
  </div>;
}
