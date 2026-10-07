import {useEffect,useState} from 'react';
import {cloudJson} from '../lib/cloud';

export type CloudRouteChoice = {route_profile:'auto'|'structured'|'contributor';contributor_training_consent:boolean};
export const defaultCloudRoute: CloudRouteChoice = {route_profile:'auto',contributor_training_consent:false};

export default function CloudRouteControls({value,onChange,disabled}:{value:CloudRouteChoice;onChange:(value:CloudRouteChoice)=>void;disabled:boolean}) {
  const [route,setRoute] = useState<{provider:string;upstream?:string;model?:string;display_name?:string;contributor_available?:boolean}|null>(null);
  useEffect(()=>{
    let active=true;
    void cloudJson('status').then(status=>{if(active)setRoute(status.operator_route || null);}).catch(()=>{if(active)setRoute(null);});
    return ()=>{active=false;};
  },[]);
  return <div className="k-connection__form">
    <label>クラウドの会話モデル<select value={value.route_profile} disabled={disabled || !route}
      onChange={e=>onChange({route_profile:e.target.value as CloudRouteChoice['route_profile'],contributor_training_consent:false})}>
      <option value="auto">{route?.provider==='opencode-go'?'自動（MiMo／長い文脈はDeepSeek）':route?.model || route?.display_name || 'クラウドの標準モデル'}</option>
      {route?.provider==='opencode-go'&&<option value="structured">DeepSeek</option>}
      {route?.provider==='opencode-go'&&<option value="contributor" disabled={!route.contributor_available}>Muse Contributor（学習利用に別同意・対応地域のみ）</option>}
    </select></label>
    {route&&<p>接続先：{route.provider}{route.upstream?` / ${route.upstream}`:''}。安全検査にはDeepSeekを使用します。送信前に実際のモデルと消費上限を確認できます。</p>}
    {value.route_profile==='contributor'&&<label><input type="checkbox" disabled={disabled}
      checked={value.contributor_training_consent}
      onChange={e=>onChange({...value,contributor_training_consent:e.target.checked})}/>
      この1回の生成で送る会話・キャラ設定・記憶・世界と生成結果がMetaのモデル学習に使われる条件に同意します。
    </label>}
  </div>;
}
