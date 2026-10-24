import { useState, type ReactNode } from 'react';
import { preferences, savePreferences, useLanguage, labels, isUnifiedEntry, isDesktop, useExecutionTarget,
  useGenerationBusy, switchTarget, type AppPreferences, type ExecutionTarget } from '../lib/appContext';
import { cloudFetch } from '../lib/transport';
import Button from './ui/Button';
import { useConfirm } from './ui/Dialog';
import './unified.css';

const choices: {key:'genres'|'moods'|'activities';ja:string;en:string;options:[string,string,string][]}[] = [
  {key:'genres',ja:'好きなジャンル',en:'Your genres',options:[['school','学園','School'],['fantasy','異世界','Fantasy'],['night','夜のひととき','Night']]},
  {key:'moods',ja:'キャラの雰囲気',en:'Character style',options:[['cool','クール','Cool'],['sweet','甘々','Sweet'],['tsundere','ツンデレ','Tsundere'],['polite','礼儀正しい','Polite'],['mysterious','ミステリアス','Mysterious']]},
  {key:'activities',ja:'楽しみ方',en:'Your moments',options:[['healing','癒し','Comfort'],['smart','知的な会話','Thoughtful chats'],['fantasy','冒険','Adventure']]},
];

export function Interests({onDone}:{onDone:()=>void}) {
  const [step,setStep]=useState(0),[draft,setDraft]=useState(preferences);
  const en=draft.language==='en',t=labels[draft.language],group=choices[step];
  const finish=()=>{savePreferences(draft);onDone();};
  return <section className="k-interests" aria-labelledby="interests-title">
    <p>{step+1} / 3</p><h2 id="interests-title">{en?group.en:group.ja}</h2>
    <div className="k-interest-options">{group.options.map(([key,ja,english])=><label key={key}>
      <input type="checkbox" checked={draft[group.key].includes(key)} onChange={e=>setDraft({...draft,[group.key]:e.target.checked?[...draft[group.key],key]:draft[group.key].filter(v=>v!==key)})}/>{en?english:ja}
    </label>)}</div>
    <div className="k-unified-actions"><Button variant="ghost" disabled={step===0} onClick={()=>setStep(step-1)}>{t.back}</Button>
      <Button variant="ghost" onClick={()=>{if(step===2)finish();else setStep(step+1);}}>{t.skip}</Button>
      <Button onClick={()=>{if(step===2)finish();else setStep(step+1);}}>{step===2?t.done:t.next}</Button></div>
  </section>;
}

export function ExecutionPicker() {
  const language=useLanguage(),target=useExecutionTarget(),busy=useGenerationBusy(),t=labels[language];
  const [dialog,confirm]=useConfirm();
  if (!isUnifiedEntry() && !isDesktop()) return null;
  return <div className="k-execution-picker">{dialog}<label>{t.target}
    <select aria-label={t.target} value={target} disabled={busy} onChange={async e=>{
      const next=e.target.value as ExecutionTarget;
      if(await confirm({title:language==='ja'?'実行先を切り替えますか？':'Switch execution target?',
        description:language==='ja'?'保存済みの会話と下書きは元の場所に残ります。会話を自動転送しません。':'Saved conversations and drafts stay in their original location. Nothing is transferred automatically.',confirmLabel:t.next})) switchTarget(next);
    }}>
      {(['cloud','device','pc',...(isDesktop()?['local']:[])] as ExecutionTarget[]).map(v=><option key={v} value={v}>{t[v]}</option>)}
    </select></label></div>;
}

export default function UnifiedEntry({children}:{children:ReactNode}) {
  const language=useLanguage(),[draft,setDraft]=useState(preferences),[stage,setStage]=useState<'legal'|'interests'|'ready'>(()=>preferences().accepted?'ready':'legal');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(!isUnifiedEntry()||stage==='ready')return <>{children}</>;
  const en=draft.language==='en',t=labels[draft.language];
  return <main className="k-unified-entry"><header><img src="/mascot/v1.2/face-default.png" alt="" width={56} height={56}/><h1>Kyalulu</h1></header>
    {stage==='interests'?<Interests onDone={()=>setStage('ready')}/>:<form onSubmit={async e=>{
      e.preventDefault();if(busy)return;setBusy(true);setError('');
      try {
        const response=await cloudFetch('/api/cloud/app/eligibility',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({country:draft.country,age:draft.age})});
        const result=await response.json();if(!response.ok)throw Error(result.error);
        if(typeof result.ticket==='string')localStorage.setItem('kyalulu-eligibility-ticket',result.ticket);
        savePreferences({...draft,accepted:true});setStage('interests');
      }catch(e){setError(en?'This region or age group is not enabled. Please try again after its requirements are verified.':'この地域・年齢区分の提供条件を確認できません。条件の確認後に再試行してください。');}
      finally{setBusy(false);}
    }}>
      <h2>{en?'Before you begin':'はじめに'}</h2>
      <label>{t.language}<select value={draft.language} onChange={e=>{const value={...draft,language:e.target.value as AppPreferences['language']};setDraft(value);savePreferences({...preferences(),language:value.language});}}><option value="ja">日本語</option><option value="en">English</option></select></label>
      <label>{en?'Country / region (ISO code)':'居住国・地域（ISOコード）'}<input value={draft.country} onChange={e=>setDraft({...draft,country:e.target.value.toUpperCase()})} pattern="[A-Z]{2}" minLength={2} maxLength={2} placeholder="JP" required autoComplete="country"/></label>
      <label>{en?'Age':'年齢'}<input type="number" min={13} max={120} value={draft.age||''} onChange={e=>setDraft({...draft,age:e.target.valueAsNumber})} required/></label>
      <label className="k-unified-check"><input type="checkbox" required/>{en?'I agree to the terms and privacy policy.':'利用規約・プライバシーポリシーに同意します。'}</label>
      <p><a href="https://kyalulu.com/terms" target="_blank" rel="noreferrer">{en?'Terms':'利用規約'}</a> · <a href="https://kyalulu.com/privacy" target="_blank" rel="noreferrer">{en?'Privacy':'プライバシー'}</a></p>
      {error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy}>{busy?(language==='ja'?'確認中':'Checking'):t.next}</Button>
    </form>}
  </main>;
}
