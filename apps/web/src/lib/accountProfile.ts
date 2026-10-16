import { useEffect, useState } from 'react';
import { cloudJson } from './cloud';
import { cloudEpoch, cloudOwner, isCloud } from './cloudMode';

export type AccountProfile = {revision:number;display_name:string;saved_characters:string[];pinned_sessions:string[]};
type State = {owner:string;epoch:number;profile:AccountProfile|null;pending:number;error:string};
let state: State = {owner:'',epoch:0,profile:null,pending:0,error:''};
let queue: Promise<unknown> = Promise.resolve();
const EVENT = 'kyalulu-account-profile-change';
function emit() {
  for (const event of [EVENT,'kyalulu-profile-change','kyalulu-saved-change','kyalulu-pins-change'])
    window.dispatchEvent(new Event(event));
}
export function accountProfileState(): State {
  return isCloud() && state.owner===cloudOwner() && state.epoch===cloudEpoch() ? state : {owner:cloudOwner(),epoch:cloudEpoch(),profile:null,pending:0,error:''};
}
export const accountProfile = () => accountProfileState().profile;
function checkProfile(value: AccountProfile): AccountProfile {
  if (!Number.isSafeInteger(value.revision) || typeof value.display_name!=='string' ||
      !Array.isArray(value.saved_characters) || !Array.isArray(value.pinned_sessions))
    throw Error('アカウントの保存内容を確認できませんでした。');
  return value;
}
async function read(owner: string, epoch: number) {
  const profile = checkProfile(await cloudJson('profile'));
  if (!isCloud() || cloudEpoch()!==epoch) throw Error('アカウントが切り替わりました。');
  state={...state,owner,epoch,profile}; emit();
}
export function refreshAccountProfile(): Promise<void> {
  const owner=cloudOwner();
  const epoch=cloudEpoch();
  if (!isCloud() || !owner) return Promise.resolve();
  if (state.owner!==owner || state.epoch!==epoch) {state={owner,epoch,profile:null,pending:0,error:''};emit();}
  const run=queue.catch(()=>{}).then(async()=>{
    if (cloudEpoch()!==epoch || !isCloud()) return;
    try {await read(owner,epoch);state={...state,error:''};emit();}
    catch {if(cloudEpoch()===epoch){state={...state,error:'アカウントを同期できませんでした。接続を確認して再試行してください。'};emit();}}
  });
  queue=run;return run;
}
export function changeAccountProfile(change: Record<string,string>): Promise<void> {
  const owner=cloudOwner();
  const epoch=cloudEpoch();
  if (!isCloud() || !owner) return Promise.reject(Error('ログインしてください。'));
  if (state.owner!==owner || state.epoch!==epoch) state={owner,epoch,profile:null,pending:0,error:''};
  state={...state,pending:state.pending+1,error:''};emit();
  const run=queue.catch(()=>{}).then(async()=>{
    if (!isCloud() || cloudEpoch()!==epoch) throw Error('アカウントが切り替わりました。');
    try {
      if (!state.profile) await read(owner,epoch);
      if (!isCloud() || cloudEpoch()!==epoch) throw Error('アカウントが切り替わりました。');
      const profile=checkProfile(await cloudJson('profile',{method:'PUT',body:JSON.stringify({revision:state.profile!.revision,change})}));
      if (isCloud() && cloudEpoch()===epoch) state={...state,profile,error:''};
    } catch (error) {
      // A stale edit is rejected; refresh before the user deliberately retries.
      if (cloudEpoch()===epoch) {
        try {await read(owner,epoch);} catch {/* Preserve the last confirmed profile. */}
        if (isCloud() && cloudEpoch()===epoch)
          state={...state,error:error instanceof Error?error.message:'アカウントを保存できませんでした。'};
      }
      throw error;
    } finally {
      if(cloudEpoch()===epoch){state={...state,pending:Math.max(0,state.pending-1)};emit();}
    }
  });
  queue=run;return run;
}
export function useAccountProfile() {
  const [value,setValue]=useState(accountProfileState);
  useEffect(()=>{
    const update=()=>setValue({...accountProfileState()});
    window.addEventListener(EVENT,update);update();
    return ()=>window.removeEventListener(EVENT,update);
  },[]);
  return value;
}
