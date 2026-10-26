import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LibraryItem } from '../lib/library';
import { publicSnapshot, fetchPublicationViewer, publicationError, publicationScope, submitPublication, usePublicationScope } from '../lib/publications';
import { useLanguage } from '../lib/appContext';
import { useConfirm } from './ui/Dialog';
import Button from './ui/Button';

export default function PublicationSubmit({item}:{item:LibraryItem}) {
  const scope=usePublicationScope();return <Submission key={`${scope}:${item.id}:${item.revision}`} item={item}/>;
}
function Submission({item}:{item:LibraryItem}) {
  const en=useLanguage()==='en';
  const scope=publicationScope(),source=`${scope}:${item.id}:${item.revision}`;
  const [dialog,confirm]=useConfirm(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState('');
  const flight=useRef(false),key=useRef({source:'',id:''}),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;setError('');setSent('');setBusy(false);return()=>{mounted.current=false;};},[source]);
  if(item.document.kind!=='character')return null;
  return <div>{dialog}<Button size="sm" variant="secondary" disabled={busy} onClick={async()=>{
    if(flight.current)return;flight.current=true;setBusy(true);setError('');
    try{
      const document=publicSnapshot(item.document);
      const viewer=await fetchPublicationViewer();if(!viewer.authenticated)throw Error('Cloud login required');
      if(!mounted.current||scope!==publicationScope())return;
      const accepted=await confirm({title:en?'Submit this fixed version for review?':'この固定版を審査に送りますか？',description:<><p>{en?'Publishing account: ':'公開先アカウント: '}{viewer.account_name}</p><p>{en?'Only the fields below will be sent. Private presets, histories, memories, source files and media are excluded. Publication waits for review.':'以下の公開用項目だけを送信します。私的なプリセット・履歴・記憶・原本ファイル・媒体は除外します。審査が終わるまで公開しません。'}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:280,overflow:'auto'}}>{JSON.stringify(document,null,2)}</pre></>,confirmLabel:en?'Send for review':'審査へ送る'});
      if(!accepted||!mounted.current||scope!==publicationScope())return;
      if(key.current.source!==source)key.current={source,id:crypto.randomUUID()};
      const result=await submitPublication(document,{item_id:item.id,revision:item.revision},key.current.id,viewer.owner_scope);
      if(mounted.current&&scope===publicationScope())setSent(result.id);
    }catch(error){if(mounted.current&&scope===publicationScope())setError(publicationError(error,en));}
    finally{flight.current=false;if(mounted.current&&scope===publicationScope())setBusy(false);}
  }}>{busy?(en?'Submitting…':'送信中…'):(en?'Submit this version':'この版を審査へ')}</Button>
    {sent&&<p role="status">{en?'Submitted. ':'審査を受け付けました。'}<Link to="/publications">{en?'View review status':'審査状況を確認'}</Link></p>}{error&&<p role="alert">{error}</p>}
  </div>;
}
