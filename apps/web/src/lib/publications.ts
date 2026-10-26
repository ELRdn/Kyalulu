import { PublicationQueueSchema, PublicationResultSchema, PublicationSnapshotSchema, PublicationViewerSchema, PublishedWorkSchema, type PublishedWork } from '../../../../packages/schemas/src/publications';
import type { PortableDocument } from './library';
import { cloudJson } from './cloud';
import { cloudEpoch } from './cloudMode';
import { subscribeCloudIdentity } from './cloudMode';
import { useSyncExternalStore } from 'react';
import { connectionScope } from './remoteStore';
import { deviceOwner, preferences, useDeviceOwner, useExecutionTarget } from './appContext';
export type { Publication, PublishedWork } from '../../../../packages/schemas/src/publications';

export const publicationScope=()=>`${connectionScope()}:${cloudEpoch()}:${deviceOwner()}`;
export function usePublicationScope(){useDeviceOwner();useExecutionTarget();useSyncExternalStore(subscribeCloudIdentity,cloudEpoch,()=>0);return publicationScope();}
async function request(path:string,init:RequestInit={},expectedOwner?:string) {
  const scope=publicationScope(),headers=new Headers(init.headers);
  if(expectedOwner)headers.set('X-Kyalulu-Owner',expectedOwner);
  if(path.startsWith('works')&&(!init.method||init.method==='GET')){
    try{const ticket=localStorage.getItem('kyalulu-eligibility-ticket');if(ticket){headers.set('X-Kyalulu-Eligibility',ticket);headers.set('X-Kyalulu-Country',preferences().country);}}catch{/* Authenticated access can still use server eligibility. */}
  }
  const result=await cloudJson('app/'+path,{...init,headers});
  if(scope!==publicationScope())throw Error('publication_account_changed');
  return result;
}
const body=(value:unknown,method='POST'):RequestInit=>({method,body:JSON.stringify(value)});
export const publicSnapshot=(doc:PortableDocument)=>PublicationSnapshotSchema.parse({schema_version:1,kind:doc.kind,name:doc.name,nsfw:doc.nsfw,speaking_style:doc.speaking_style,data:doc.data});
export const fetchPublicationQueue=async()=>PublicationQueueSchema.parse(await request('publications'));
export const fetchPublicationViewer=async()=>PublicationViewerSchema.parse(await request('publication-viewer'));
export const submitPublication=async(document:ReturnType<typeof publicSnapshot>,source:{item_id:string;revision:number},request_id:string,owner:string)=>PublicationResultSchema.parse(await request('publications',body({document,rating:document.nsfw?'adult':'general',source,request_id}),owner));
export const reviewPublication=(id:string,revision:number,decision:'approved'|'rejected'|'hidden',reason:string,approved:boolean,owner:string)=>request('publications/'+encodeURIComponent(id),body({revision,decision,reason,...(approved?{checks:{content_reviewed:true,prohibited_content_absent:true,rating_correct:true}}:{})},'PUT'),owner);
export const appealPublication=(id:string,revision:number,reason:string,owner:string)=>request(`publications/${encodeURIComponent(id)}/appeals`,body({revision,reason}),owner);
export const withdrawPublication=(id:string,revision:number,owner:string)=>request('publications/'+encodeURIComponent(id),body({revision},'DELETE'),owner);
export const publicationAdultConsent=async(enabled?:boolean,owner?:string)=>{
  if(enabled!==undefined&&!owner)throw Error('publication_account_changed');
  const result=await request('publication-adult-consent',enabled===undefined?undefined:body({enabled},'PUT'),owner);
  if(typeof result.enabled!=='boolean')throw Error('Invalid consent response');return result.enabled as boolean;
};
export async function fetchPublishedWorks(q='',tag='',rating='general',author='',signal?:AbortSignal):Promise<PublishedWork[]>{
  const result=await request('works?'+new URLSearchParams({q,tag,rating,...(author?{author}:{})}),{signal});
  return result.works.map((work:unknown)=>PublishedWorkSchema.parse(work));
}
export const fetchPublishedWork=async(id:string,signal?:AbortSignal)=>PublishedWorkSchema.parse(await request('works/'+encodeURIComponent(id),{signal}));
export const reportPublication=(id:string,revision:number,reason:string,owner:string)=>request(`works/${encodeURIComponent(id)}/reports`,body({revision,reason}),owner);
export const blockPublicationAuthor=(id:string,active:boolean,owner:string)=>request(`authors/${encodeURIComponent(id)}/block`,body({active},'PUT'),owner);
export function publicationError(error:unknown,en:boolean) {
  const value=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:String(error);
  if(/rate_limit/.test(value))return en?'Too many requests. Wait before retrying this fixed version.':'操作が集中しています。時間を置いてから、この固定版を再試行してください。';
  if(/not_found/.test(value))return en?'This public version is unavailable. It may be hidden, withdrawn or outside your access.':'この公開版は表示できません。非表示・取り下げ・利用条件を確認してください。';
  if(/requires_resubmission/.test(value))return en?'Resubmit this legacy version from your Library for a new review. Its existing record is retained.':'この旧形式の版は、ライブラリの原本から新しく審査へ送ってください。既存の審査記録は保持します。';
  if(/conflict|changed/.test(value))return en?'This account or version changed. Reload before trying again.':'アカウントまたは版が変わりました。再読込してから操作してください。';
  if(/adult_|年齢/.test(value))return en?'Verified adult access and separate enablement are required. Unavailable verification remains closed.':'成人確認と別途の有効化が必要です。未提供の確認手段では有効化できません。';
  if(/eligibility|region_/.test(value))return en?'Confirm your region and age from the app entry.':'アプリの入口で地域・年齢の利用条件を確認してください。';
  if(/acceptance|未提供|準備/.test(value))return en?'Publication is awaiting service acceptance. Your private Library is unchanged.':'公開機能は提供条件の確認待ちです。マイライブラリの原本は保持しています。';
  return en?'Could not complete this action. Check your login, access and connection, then reload.':'操作を完了できませんでした。ログイン・利用条件・接続を確認して再読込してください。';
}
