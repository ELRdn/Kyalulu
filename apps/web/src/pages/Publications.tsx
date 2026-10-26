import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchLibrary, type LibraryItem } from '../lib/library';
import { appealPublication, fetchPublicationQueue, publicationAdultConsent, publicationError, publicationScope, reviewPublication, usePublicationScope, withdrawPublication, type Publication } from '../lib/publications';
import { useLanguage } from '../lib/appContext';
import PublicationSubmit from '../components/PublicationSubmit';
import Button from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { useConfirm } from '../components/ui/Dialog';
import { useDocumentTitle } from '../lib/title';
import './pages.css';

const statuses={ja:{pending:'確認待ち',approved:'承認済み',rejected:'公開不可',hidden:'非表示',withdrawn:'取り下げ済み'},en:{pending:'Pending',approved:'Approved',rejected:'Rejected',hidden:'Hidden',withdrawn:'Withdrawn'}};
function ReviewItem({item,moderator,actor,reload}:{item:Publication;moderator:boolean;actor:string;reload:()=>Promise<void>}) {
  const en=useLanguage()==='en',scope=publicationScope();
  const actions=en?{approved:'Approve and publish',rejected:'Reject',hidden:'Hide'}:{approved:'承認して公開',rejected:'公開不可にする',hidden:'非表示にする'};
  const [reason,setReason]=useState(''),[checks,setChecks]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dialog,confirm]=useConfirm();
  const flight=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function act(action:()=>Promise<unknown>){if(flight.current)return;flight.current=true;setBusy(true);setError('');try{await action();if(mounted.current&&scope===publicationScope())await reload();}catch(error){if(mounted.current&&scope===publicationScope())setError(publicationError(error,en));}finally{flight.current=false;if(mounted.current)setBusy(false);}}
  return <article className="k-card" style={{padding:16,marginBlock:12,overflowWrap:'anywhere'}}>{dialog}<h2>{item.document.name}</h2>
    <p>{statuses[en?'en':'ja'][item.status]} · {item.rating==='adult'?(en?'Adult':'成人区分'):(en?'General':'一般')} · {en?'Fixed version':'固定版'} {item.source.revision} · {en?'Review revision':'審査版'} {item.revision}</p>
    <p>{item.author_name}</p>{item.reason!=='manual_review_required'&&<p style={{whiteSpace:'pre-wrap'}}>{item.reason}</p>}
    {item.status==='approved'&&<Link to={`/published/${encodeURIComponent(item.id)}`}>{en?'View public version':'公開版を確認'}</Link>}
    <details><summary>{en?'Fixed public snapshot':'固定した公開用データ'}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflow:'auto'}}>{JSON.stringify(item.document,null,2)}</pre><p>{en?'Snapshot checksum':'スナップショット照合値'}: {item.snapshot_hash}</p></details>
    {moderator&&item.reports.length>0&&<section><h3>{en?'Reports':'通報'}</h3>{item.reports.map(report=><p key={report.id} style={{whiteSpace:'pre-wrap'}}>{report.reason}</p>)}</section>}
    {item.appeals.length>0&&<section><h3>{en?'Appeals':'異議申立て'}</h3>{item.appeals.map(appeal=><p key={appeal.id} style={{whiteSpace:'pre-wrap'}}>{appeal.reason}</p>)}</section>}
    {item.status!=='withdrawn'&&(moderator||item.owned&&['rejected','hidden'].includes(item.status))&&<label>{en?'Reason':'理由'}<Textarea value={reason} maxLength={1000} onChange={event=>setReason(event.target.value)} disabled={busy}/></label>}
    {moderator&&item.status!=='withdrawn'&&<>
      <label><input type="checkbox" checked={checks} disabled={busy} onChange={event=>setChecks(event.target.checked)}/>{en?'I reviewed every public field and author name, confirmed the rating, and found no prohibited content.':'公開する全項目と作者名を確認し、年齢区分が適切で禁止内容がないことを確認しました。'}</label>
      <div className="k-create-actions">{(['approved','rejected','hidden'] as const).map(decision=><Button key={decision} variant={decision==='approved'?'primary':'secondary'} disabled={busy||!reason.trim()||decision==='approved'&&!checks} onClick={()=>void act(async()=>{
        if(!await confirm({title:actions[decision],description:reason,confirmLabel:en?'Record decision':'判断を記録'})||scope!==publicationScope())return;
        return reviewPublication(item.id,item.revision,decision,reason.trim(),checks,actor);
      })}>{actions[decision]}</Button>)}</div>
    </>}
    {item.owned&&['rejected','hidden'].includes(item.status)&&<Button disabled={busy||!reason.trim()} onClick={()=>void act(()=>appealPublication(item.id,item.revision,reason.trim(),actor))}>{en?'Request another review':'異議申立てを送る'}</Button>}
    {item.owned&&item.status!=='withdrawn'&&<Button variant="danger" disabled={busy} onClick={()=>void act(async()=>{
      if(!await confirm({title:en?'Withdraw this public version?':'この公開版を取り下げますか？',description:en?'This stops publication. Your Library original and review records are retained.':'公開を停止します。ライブラリの原本と審査記録は保持します。',confirmLabel:en?'Withdraw':'取り下げる',danger:true})||scope!==publicationScope())return;
      return withdrawPublication(item.id,item.revision,actor);
    })}>{en?'Withdraw':'取り下げる'}</Button>}
    {error&&<p role="alert">{error}</p>}
  </article>;
}
export default function Publications(){const scope=usePublicationScope();return <Queue key={scope}/>;}
function Queue(){
  const en=useLanguage()==='en',scope=publicationScope(),[items,setItems]=useState<Publication[]>([]),[moderator,setModerator]=useState(false),[library,setLibrary]=useState<LibraryItem[]>([]),[selected,setSelected]=useState(''),[adult,setAdult]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false);
  const [actor,setActor]=useState({owner_scope:'',account_name:''});
  const mounted=useRef(true),reads=useRef(0);useDocumentTitle(en?'Publication review':'公開作品の審査');
  async function load(){const read=++reads.current,result=await fetchPublicationQueue();if(read===reads.current&&mounted.current&&scope===publicationScope()){setItems(result.publications);setModerator(result.moderator);setActor({owner_scope:result.owner_scope,account_name:result.account_name});setLoaded(true);}}
  useEffect(()=>{mounted.current=true;void load().catch(error=>{if(mounted.current)setError(publicationError(error,en));});void fetchLibrary().then(items=>{if(mounted.current&&scope===publicationScope())setLibrary(items.filter(item=>item.document.kind==='character'));}).catch(()=>{});void publicationAdultConsent().then(value=>{if(mounted.current&&scope===publicationScope())setAdult(value);}).catch(()=>{});return()=>{mounted.current=false;};},[]);
  const item=library.find(item=>item.id===selected);
  return <div className="k-page" style={{maxWidth:900}}><h1 className="k-page-title">{en?'Publication review':'公開作品の審査'}</h1><p>{en?'New versions remain private until reviewed. Your conversations and memories are never part of a public snapshot.':'新しい版は審査が終わるまで非公開です。会話や記憶を公開スナップショットに含めません。'}</p><Link to="/published">{en?'Browse approved works':'承認済み作品を見る'}</Link>
    {actor.owner_scope&&<p>{en?'Publishing account: ':'公開先アカウント: '}{actor.account_name}</p>}
    <p>{en?'Adult publication requires accepted regional policy, verified age and separate enablement.':'成人区分の公開作品には、地域の提供条件・成人確認・別途の有効化が必要です。'}</p>
    <Button variant="secondary" disabled={busy||!actor.owner_scope} onClick={async()=>{if(busy)return;setBusy(true);setError('');try{const value=await publicationAdultConsent(!adult,actor.owner_scope);if(mounted.current&&scope===publicationScope()){setAdult(value);await load();}}catch(error){if(mounted.current)setError(publicationError(error,en));}finally{if(mounted.current)setBusy(false);}}}>{adult?(en?'Disable adult publication access':'成人区分の公開作品を無効化'):(en?'Enable verified adult publication access':'成人確認済みの公開作品を有効化')}</Button>
    {error&&<p role="alert">{error}</p>}<Button variant="ghost" disabled={busy} onClick={()=>{setError('');void load().catch(error=>setError(publicationError(error,en)));}}>{en?'Reload':'再読込'}</Button>
    <section><h2>{en?'Submit a Library version':'ライブラリの固定版を送る'}</h2><label>{en?'Work on the selected execution target':'選択中の実行先にある作品'}<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">{en?'Choose a work':'作品を選択'}</option>{library.map(item=><option value={item.id} key={item.id}>{item.document.name} · {item.revision}</option>)}</select></label>{item&&<PublicationSubmit item={item}/>}</section>
    <h2>{moderator?(en?'Review queue':'審査キュー'):(en?'Your submissions':'送信した作品')}</h2>
    {!loaded&&!error&&<p role="status">{en?'Loading…':'読み込み中…'}</p>}{loaded&&!items.length&&<p>{en?'No eligible submissions.':'表示できる審査対象はありません。'}</p>}
    {items.map(item=><ReviewItem key={`${actor.owner_scope}:${item.id}:${item.revision}`} item={item} moderator={moderator} actor={actor.owner_scope} reload={load}/>)}
  </div>;
}
