import { useEffect, useState, useSyncExternalStore } from 'react';

export type ExecutionTarget = 'cloud' | 'device' | 'pc' | 'local';
export type StoragePolicy = 'sync' | 'local';
export type Language = 'ja' | 'en';
export type AppPreferences = { version: 1; language: Language; country: string; age: number;
  accepted: boolean; genres: string[]; moods: string[]; activities: string[]; favorites: string[]; dismissed: string[] };
const EVENT = 'kyalulu-app-context';
const MODE = 'kyalulu-execution-target';
const PREFS = 'kyalulu-app-preferences-v1';
const OWNER = 'kyalulu-app-owner';
export const isDesktop = () => typeof window !== 'undefined' && ('electronAPI' in window || /Electron\//.test(navigator.userAgent));
export const isUnifiedEntry = () => typeof location !== 'undefined' &&
  (import.meta.env.MODE === 'unified' || import.meta.env.VITE_UNIFIED_APP === '1' || /^(app|mobile)\.kyalulu\.com$/.test(location.hostname) || location.pathname.startsWith('/device/'));
function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
export function executionTarget(): ExecutionTarget {
  if (typeof location !== 'undefined' && location.pathname.startsWith('/device/')) return 'device';
  const value = read(MODE);
  return value === 'cloud' || value === 'device' || value === 'pc' || value === 'local' ? value
    : read('kyalulu-active-remote') ? 'pc' : isUnifiedEntry() && !isDesktop() ? 'cloud' : 'local';
}
export function deviceOwner() { return read(OWNER) || 'guest'; }
export function rememberOwner(owner: string) {
  if (!owner || owner.length > 200) throw Error('Invalid account scope');
  localStorage.setItem(OWNER, owner);
  window.dispatchEvent(new Event(EVENT));
}
export function clearDeviceOwner() {
  try { localStorage?.removeItem(OWNER); } catch { /* Unavailable storage also cannot restore an account scope. */ }
  if(typeof window!=='undefined')window.dispatchEvent(new Event(EVENT));
}
export function preferences(): AppPreferences {
  const initial: AppPreferences = { version: 1, language: typeof navigator !== 'undefined' && navigator.language.startsWith('ja') ? 'ja' : 'en',
    country: '', age: 0, accepted: false, genres: [], moods: [], activities: [], favorites: [], dismissed: [] };
  try {
    const general = JSON.parse(read(PREFS) || 'null');
    const scoped = JSON.parse(read(PREFS+':'+deviceOwner()) || 'null');
    const value = general && {...general, genres:[],moods:[],activities:[],favorites:[],dismissed:[],...scoped};
    if (!value || value.version !== 1 || !['ja','en'].includes(value.language)) return initial;
    for (const key of ['genres','moods','activities','favorites','dismissed']) {
      if (!Array.isArray(value[key]) || value[key].length > 500 || value[key].some((v: unknown) => typeof v !== 'string' || v.length > 200)) return initial;
    }
    return { ...initial, ...value, accepted: value.accepted === true && Number.isInteger(value.age) && value.age >= 13 };
  } catch { return initial; }
}
export function savePreferences(value: AppPreferences) {
  localStorage.setItem(PREFS, JSON.stringify({...value,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
  localStorage.setItem(PREFS+':'+deviceOwner(),JSON.stringify({genres:value.genres,moods:value.moods,activities:value.activities,favorites:value.favorites,dismissed:value.dismissed}));
  window.dispatchEvent(new Event(EVENT));
}
export function switchTarget(target: ExecutionTarget) {
  if (generationBusy()) throw Error('Stop generation and confirm its saved result before switching.');
  localStorage.setItem(MODE, target);
  const destination = target === 'device' ? '/device/' : '/';
  if (isDesktop() || location.protocol === 'file:') { location.reload(); return; }
  location.assign(destination + '#/');
}
let busy = 0;
export function generationBusy() { return busy > 0; }
export function setGenerationBusy(value: boolean) {
  busy = Math.max(0, busy + (value ? 1 : -1));
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener); window.addEventListener('storage', listener);
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', listener); };
}
export function useExecutionTarget() { return useSyncExternalStore(subscribe, executionTarget, () => 'cloud' as const); }
export function useDeviceOwner() { return useSyncExternalStore(subscribe, deviceOwner, () => 'guest'); }
export function usePreferences() {
  const [value,setValue]=useState(preferences);
  useEffect(()=>{const refresh=()=>setValue(preferences());const stop=subscribe(refresh);refresh();return stop;},[]);
  return value;
}
export function useLanguage() { return useSyncExternalStore(subscribe, () => preferences().language, () => 'ja' as const); }
export function useGenerationBusy() { return useSyncExternalStore(subscribe, generationBusy, () => false); }
export const labels = {
  ja: { cloud:'Cloud', device:'この端末', pc:'自分のPC', local:'このPC', target:'実行先', model:'モデル',
    home:'ホーム', discover:'さがす', chats:'トーク', create:'つくる', profile:'設定', localOnly:'端末限定', sync:'アカウントに同期',
    next:'次へ', back:'戻る', skip:'スキップ', done:'はじめる', settings:'好みの設定', resume:'会話の続き',
    recommended:'あなたへのおすすめ', language:'表示言語', prepare:'モデルを準備', offline:'オフライン用に保存',
    balance:'クレジットを補充', buy:'追加購入', watch:'動画を見て補充', close:'閉じる', pending:'確認中',
    ad:'広告', private:'Cloudへ送信しません', unavailable:'準備中', migration:'以前のMobileから移行',
  },
  en: { cloud:'Cloud', device:'This device', pc:'My PC', local:'This PC', target:'Run on', model:'Model',
    home:'Home', discover:'Explore', chats:'Chats', create:'Create', profile:'Settings', localOnly:'Device only', sync:'Sync to account',
    next:'Next', back:'Back', skip:'Skip', done:'Start', settings:'Your interests', resume:'Continue a conversation',
    recommended:'Recommended for you', language:'Language', prepare:'Prepare a model', offline:'Keep offline',
    balance:'Add credits', buy:'Buy credits', watch:'Watch to earn credits', close:'Close', pending:'Checking',
    ad:'Advertisement', private:'Never sent to Cloud', unavailable:'Not available yet', migration:'Import from Mobile',
  },
};
export const translate = (key: keyof typeof labels.ja, language = preferences().language) => labels[language][key];
