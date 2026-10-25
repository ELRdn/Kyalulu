import {useEffect,useState} from 'react';
import {cloudJson} from '../lib/cloud';
import type { ModelInfo } from '../lib/api';
import { useLanguage } from '../lib/appContext';

export type CloudRouteChoice = {route_profile:'auto'|'structured'|'contributor';contributor_training_consent:boolean};
export const defaultCloudRoute: CloudRouteChoice = {route_profile:'auto',contributor_training_consent:false};

export default function CloudRouteControls({value,onChange,disabled,currentModel}:{value:CloudRouteChoice;onChange:(value:CloudRouteChoice)=>void;disabled:boolean;currentModel?:ModelInfo}) {
  const en = useLanguage() === 'en';
  const [route,setRoute] = useState<{provider:string;upstream?:string;model?:string;display_name?:string;contributor_available?:boolean}|null>(null);
  useEffect(()=>{
    let active=true;
    void cloudJson('status').then(status=>{if(active)setRoute(status.operator_route || null);}).catch(()=>{if(active)setRoute(null);});
    return ()=>{active=false;};
  },[]);
  const go = route?.provider === 'opencode-go' && (!currentModel || currentModel.id === 'cloud-standard');
  return <div className="k-connection__form">
    {go && <label>{en ? 'Cloud conversation model' : 'クラウドの会話モデル'}<select value={value.route_profile} disabled={disabled}
      onChange={e=>onChange({route_profile:e.target.value as CloudRouteChoice['route_profile'],contributor_training_consent:false})}>
      <option value="auto">{en ? 'Auto (MiMo / DeepSeek for long context)' : '自動（MiMo／長い文脈はDeepSeek）'}</option>
      <option value="structured">DeepSeek</option>
      <option value="contributor" disabled={!route.contributor_available}>{en ? 'Muse Contributor (separate training consent; supported regions only)' : 'Muse Contributor（学習利用に別同意・対応地域のみ）'}</option>
    </select></label>}
    <p style={{fontSize:12,lineHeight:1.6,color:'var(--text-secondary)',margin:0}}>{en ? 'Use Send to start the conversation. The destination and credit limit appear in the chat. Credits are not reserved; actual API costs are charged after completion. Input and output are not sent for external safety screening. Models and providers do not switch automatically.' : '送信ボタンで会話が始まります。送信先と消費上限はチャット内に表示します。クレジットは予約せず、完了後にAPI実費で精算します。入力・出力の外部安全検査は行いません。モデル・提供元は自動で切り替わりません。'}</p>
    {go && value.route_profile==='contributor'&&<label><input type="checkbox" disabled={disabled}
      checked={value.contributor_training_consent}
      onChange={e=>onChange({...value,contributor_training_consent:e.target.checked})}/>
      {en ? 'I agree to the terms under which the conversation, character settings, memories, world and results sent for this generation are used to train Meta models.' : 'この1回の生成で送る会話・キャラ設定・記憶・世界と生成結果がMetaのモデル学習に使われる条件に同意します。'}
    </label>}
  </div>;
}
