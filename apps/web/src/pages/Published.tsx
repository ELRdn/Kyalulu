import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { blockPublicationAuthor, fetchPublicationViewer, fetchPublishedWork, fetchPublishedWorks, publicationError, publicationScope, reportPublication, usePublicationScope, type PublishedWork } from '../lib/publications';
import { executionTarget, useLanguage } from '../lib/appContext';
import { saveLibraryItem } from '../lib/library';
import Button from '../components/ui/Button';
import { Input, Textarea } from '../components/ui/Input';
import { useConfirm } from '../components/ui/Dialog';
import { useDocumentTitle } from '../lib/title';
import { preferences, savePreferences, usePreferences } from '../lib/appContext';
import PublishedCards from '../components/PublishedCards';
import { recommend } from '../lib/recommendations';
import './pages.css';
import { loginPath } from '../lib/cloudGuest';

export default function Published(){const scope=usePublicationScope();return <Catalog key={scope}/>;}
function Catalog(){
  const en=useLanguage()==='en',scope=publicationScope(),prefs=usePreferences(),[params,setParams]=useSearchParams(),rating=params.get('rating')==='adult'?'adult':'general';
  const [q,setQ]=useState(params.get('q')??''),[tag,setTag]=useState(''),[works,setWorks]=useState<PublishedWork[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  const author=params.get('author')??'';useDocumentTitle(en?'Approved works':'承認済みの作品');
  useEffect(()=>{const abort=new AbortController();setLoading(true);setWorks([]);setError('');const timer=setTimeout(()=>void fetchPublishedWorks(q,tag,rating,author,abort.signal).then(value=>{if(!abort.signal.aborted&&scope===publicationScope())setWorks(value);}).catch(error=>{if(!abort.signal.aborted)setError(publicationError(error,en));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);}),250);return()=>{clearTimeout(timer);abort.abort();};},[q,tag,rating,author,retry,en]);
  const featured=recommend(works,prefs,rating==='adult');
  return <div className="k-page"><h1>{en?'Approved works':'承認済みの作品'}</h1><p>{en?'Public versions are fixed snapshots. Your private Library remains separate.':'公開版は固定したスナップショットです。マイライブラリの原本とは別に保持します。'}</p><Link to="/publications">{en?'Your submissions and review':'送信した作品・審査'}</Link>
    <p><label>{en?'Audience':'表示区分'}<select value={rating} onChange={event=>{const next=new URLSearchParams(params);next.set('rating',event.target.value);setParams(next);}}><option value="general">{en?'General':'一般'}</option><option value="adult">{en?'Verified adult section':'成人確認済みの区分'}</option></select></label></p>
    {rating==='adult'&&<p>{en?'This section requires login, verified age and separate enablement. It is separated from general recommendations and advertisements.':'ログイン・成人確認・別途の有効化が必要な区分です。一般向けのおすすめや広告とは分けて表示します。'}</p>}
    <label>{en?'Search':'検索'}<Input value={q} maxLength={200} onChange={event=>setQ(event.target.value)}/></label><label>{en?'Tag':'タグ'}<Input value={tag} maxLength={80} onChange={event=>setTag(event.target.value)}/></label>
    {error?<p role="alert">{error}<Button onClick={()=>setRetry(value=>value+1)}>{en?'Reload':'再読込'}</Button></p>:loading?<p role="status">{en?'Loading…':'読み込み中…'}</p>:featured.length?<PublishedCards works={featured}/>:<p>{en?'No approved works match these filters.':'この条件に一致する承認済み作品はありません。'}</p>}
  </div>;
}
export function PublishedDetail(){const scope=usePublicationScope(),{publicationId=''}=useParams();return <Detail key={`${scope}:${publicationId}`} id={publicationId}/>;}
function Detail({id}:{id:string}){
  const en=useLanguage()==='en',scope=publicationScope(),navigate=useNavigate();
  const [work,setWork]=useState<PublishedWork|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[dialog,confirm]=useConfirm();
  const [actor,setActor]=useState('');
  const unsupportedAdultCopy=work?.rating==='adult'&&['cloud','device'].includes(executionTarget());
  const mounted=useRef(true),flight=useRef(false);useDocumentTitle(work?.name??(en?'Public version':'公開版'));
  useEffect(()=>{const abort=new AbortController();mounted.current=true;setWork(null);setError('');setActor('');void fetchPublishedWork(id,abort.signal).then(value=>{if(!abort.signal.aborted&&scope===publicationScope())setWork(value);}).catch(error=>{if(!abort.signal.aborted)setError(publicationError(error,en));});void fetchPublicationViewer().then(viewer=>{if(!abort.signal.aborted&&scope===publicationScope())setActor(viewer.owner_scope);}).catch(()=>{});return()=>{mounted.current=false;abort.abort();};},[id,retry]);
  async function act(action:()=>Promise<void>){if(flight.current||!work)return;flight.current=true;setBusy(true);setError('');setNotice('');try{await action();}catch(error){if(mounted.current&&scope===publicationScope())setError(publicationError(error,en));}finally{flight.current=false;if(mounted.current)setBusy(false);}}
  return <div className="k-page" style={{maxWidth:850}}>{dialog}<Link to="/published">{en?'Approved works':'承認済み作品'}</Link>{error&&<p role="alert">{error}<Button onClick={()=>setRetry(value=>value+1)}>{en?'Reload':'再読込'}</Button></p>}
    {!work&&!error&&<p role="status">{en?'Loading…':'読み込み中…'}</p>}{work&&<><h1>{work.name}</h1><p>{work.rating==='adult'?(en?'Adult section':'成人区分'):(en?'General':'一般')} · {en?'Fixed version':'固定版'} {work.revision} · <Link to={`/published?${new URLSearchParams({author:work.author_id,rating:work.rating})}`}>{work.author_name}</Link></p>
      <p style={{whiteSpace:'pre-wrap'}}>{work.description}</p><p>{work.tags.join(' · ')}</p>
      {typeof work.document.data.first_mes==='string'&&<section><h2>{en?'Opening':'物語のはじまり'}</h2><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{work.document.data.first_mes}</p></section>}
      <details><summary>{en?'Public settings':'公開されている設定'}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify({data:work.document.data,speaking_style:work.document.speaking_style},null,2)}</pre></details>
      <Button disabled={busy||unsupportedAdultCopy} onClick={()=>void act(async()=>{if(!await confirm({title:en?'Save this public version to your Library?':'この公開版をライブラリに保存しますか？',description:en?'This creates a separate copy on the selected execution target. It does not start generation.':'選択中の実行先に別のコピーを保存します。生成は開始しません。',confirmLabel:en?'Save copy':'コピーを保存'})||scope!==publicationScope())return;await saveLibraryItem(work.document);if(mounted.current&&scope===publicationScope())setNotice(en?'Saved to your Library.':'ライブラリに保存しました。');})}>{en?'Save a Library copy':'ライブラリにコピー'}</Button>
      {unsupportedAdultCopy&&<p>{en?'This execution target does not yet support storing adult works. Check availability on your own PC.':'この実行先では成人区分の作品保存をまだ提供していません。自分のPC側の対応状況を確認してください。'}</p>}
      {work.rating==='general'&&<Button variant="secondary" disabled={busy} onClick={()=>{const value=preferences();savePreferences({...value,dismissed:[...new Set([...value.dismissed,work.id])].slice(-500)});navigate('/published');}}>{en?'Not interested':'興味なし'}</Button>}
      <Button variant="secondary" disabled={busy} onClick={()=>{const value=preferences();savePreferences({...value,favorites:[...new Set([...value.favorites,work.id])].slice(-500)});setNotice(en?'Added to favorites.':'お気に入りに追加しました。');}}>{en?'Favorite':'お気に入りに追加'}</Button>
      {!actor?<p><Link to={loginPath('/published/'+encodeURIComponent(id))}>{en?'Log in to report or block an author':'通報・作者ブロックはログイン後に利用できます'}</Link></p>:<section><h2>{en?'Report this public version':'この公開版を通報'}</h2><label>{en?'Reason':'理由'}<Textarea value={reason} maxLength={1000} disabled={busy} onChange={event=>setReason(event.target.value)}/></label><Button disabled={busy||!reason.trim()} onClick={()=>void act(async()=>{await reportPublication(work.id,work.moderation_revision,reason.trim(),actor);if(mounted.current&&scope===publicationScope())setNotice(en?'Report received.':'通報を受け付けました。');})}>{en?'Send report':'通報を送る'}</Button></section>}
      {actor&&!work.owned&&<Button variant="danger" disabled={busy} onClick={()=>void act(async()=>{if(!await confirm({title:en?'Block this author?':'この作者をブロックしますか？',description:en?'Their public works will be hidden in both directions.':'双方の公開作品を表示しなくなります。',confirmLabel:en?'Block':'ブロック',danger:true})||scope!==publicationScope())return;await blockPublicationAuthor(work.author_id,true,actor);if(mounted.current&&scope===publicationScope())navigate('/published');})}>{en?'Block author':'作者をブロック'}</Button>}
      {work.owned&&<Link to="/publications">{en?'Manage publication':'公開状態を管理'}</Link>}
    </>}{notice&&<p role="status">{notice}</p>}
  </div>;
}
