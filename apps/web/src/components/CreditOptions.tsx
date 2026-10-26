import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cloudJson } from '../lib/cloud';
import { useExecutionTarget, useLanguage, labels, switchTarget, useGenerationBusy } from '../lib/appContext';
import { connectionScope } from '../lib/remoteStore';
import Dialog from './ui/Dialog';
import Button from './ui/Button';
import { useRuntimeAccess } from './RuntimeGate';

type Offer={id:string;duration_seconds:number;credits:number;frame_url:string;state:string};
export type AppCommercialStatus={enabled:boolean;subscriber:boolean;ads_available:boolean;banner:string|null;billing_available?:boolean};
export function isolatedAdUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.origin===location.origin||url.username||url.password||url.hash)throw Error('Untrusted advertisement URL');
  return url.href;
}
export function AdBanner() {
  const target=useExecutionTarget(),{cloud_mode,authenticated}=useRuntimeAccess(),language=useLanguage();
  const [status,setStatus]=useState<AppCommercialStatus|null>(null);
  useEffect(()=>{let alive=true;if(cloud_mode)void cloudJson(authenticated?'app/status':'status').then(s=>{if(alive)setStatus(authenticated?s:s.app_commercial??null);}).catch(()=>{});return()=>{alive=false;};},[cloud_mode,authenticated]);
  if(target!=='cloud'||!status?.enabled||status.subscriber)return null;
  let url='';try{if(status.banner)url=isolatedAdUrl(status.banner);}catch{/* Fail closed for an invalid ad provider. */}
  return <div className="k-ad-slot" aria-label={labels[language].ad}>
    {url?<iframe src={url} title={labels[language].ad} sandbox="allow-scripts" referrerPolicy="no-referrer"/>:<span className="k-ad-label">{labels[language].ad}</span>}
  </div>;
}

export default function CreditOptions() {
  const language=useLanguage(),en=language==='en',t=labels[language],target=useExecutionTarget(),busy=useGenerationBusy(),navigate=useNavigate();
  const [open,setOpen]=useState(false),[offer,setOffer]=useState<Offer|null>(null),[playing,setPlaying]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const key='kyalulu-reward:'+connectionScope();
  useEffect(()=>{
    const show=()=>{setOpen(true);setError('');};window.addEventListener('kyalulu-insufficient-credits',show);
    const pending=localStorage.getItem(key);if(pending&&target==='cloud')void cloudJson('app/rewards/'+encodeURIComponent(pending)).then(result=>{setOffer(result);setOpen(true);}).catch(()=>{});
    return()=>window.removeEventListener('kyalulu-insufficient-credits',show);
  },[key,target]);
  useEffect(()=>{
    if(!open||!offer?.id||offer.state!=='pending')return;
    let active=true;
    const timer=setInterval(()=>void cloudJson('app/rewards/'+encodeURIComponent(offer.id)).then(value=>{
      if(!active)return;
      if(value.state!=='pending'){setOffer({...offer,...value});setPlaying(false);localStorage.removeItem(key);}
    }).catch(e=>{if(active)setError(String(e));}),3000);
    return()=>{active=false;clearInterval(timer);};
  },[open,offer?.id,offer?.state,key]);
  if(target!=='cloud')return null;
  return <Dialog open={open} onClose={()=>{setOpen(false);setPlaying(false);}} label={t.balance}>
    <h2>{t.balance}</h2><div className="k-unified-actions">
      <Button onClick={()=>{setOpen(false);navigate('/profile');}}>{t.buy}</Button>
      <Button variant="secondary" disabled={loading||offer?.state==='pending'} onClick={async()=>{
        setLoading(true);setError('');try{const value=await cloudJson('app/rewards',{method:'POST'});isolatedAdUrl(value.frame_url);setOffer(value);localStorage.setItem(key,value.id);}catch(e){setError(en?'Reward ads are unavailable.':'現在、報酬動画を利用できません。');}finally{setLoading(false);}
      }}>{t.watch}</Button>
    </div>
    {offer&&<div role="status"><p>{offer.duration_seconds??(offer as any).seconds}s · {offer.credits} Credits · {offer.state==='granted'?(en?'Added':'付与済み'):offer.state==='expired'?(en?'Expired':'期限切れ'):t.pending}</p>
      {offer.state==='pending'&&offer.frame_url&&!playing&&<Button onClick={()=>setPlaying(true)}>{en?'Play video':'動画を再生'}</Button>}
      {playing&&<iframe src={isolatedAdUrl(offer.frame_url)} title={t.watch} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{width:'100%',height:240,border:0}}/>}
    </div>}
    {error&&<p role="alert">{error}</p>}
    <div className="k-unified-actions"><Button variant="secondary" disabled={busy} onClick={()=>switchTarget('device')}>{t.device}</Button><Button variant="secondary" disabled={busy} onClick={()=>switchTarget('pc')}>{t.pc}</Button><Button variant="ghost" onClick={()=>{setOpen(false);setPlaying(false);}}>{t.close}</Button></div>
  </Dialog>;
}
