import type { ModelInfo } from "../lib/api";
import { useId } from 'react';
import { friendlyMessage } from '../lib/errors';
import './modelSelector.css';
import { useLanguage } from '../lib/appContext';

export default function ModelSelector({
  models,
  value,
  onChange,
  disabled = false,
  loading = false,
  error = '',
}: {
  models: ModelInfo[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
}) {
  const infoId = useId();
  const language = useLanguage(), en = language === 'en';
  const selected = models.find(model => model.id === value);
  return (
    <div className="k-model-selector" aria-busy={loading}>
      <label style={{ fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap" }}>{en ? 'Model' : 'モデル'}</label>
      <select
        className="k-input"
        disabled={disabled || loading || Boolean(error) || models.length === 0}
        aria-label={en ? 'Conversation model' : '会話モデル'}
        aria-describedby={selected ? infoId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {models.length === 0 && <option value={value}>{loading ? (en ? 'Loading models…' : 'モデルを読込中…') : error ? (en ? 'Could not load models' : 'モデルを取得できません') : (en ? 'No models' : 'モデルがありません')}</option>}
        {models.length > 0 && !selected && <option value={value} disabled>{en ? 'Selected model (not in this list)' : '選択中のモデル（一覧にありません）'}</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={m.available === false}>
            {m.display_name}{m.available === false ? (en ? ' (Unavailable)' : '（利用不可）') : ''}
          </option>
        ))}
      </select>
      {loading && <p role="status">{en ? 'Loading models…' : 'モデルを読込中…'}</p>}
      {error && <p role="alert">{en ? 'Could not load models: ' : 'モデルを取得できません：'}{friendlyMessage(error, language)}</p>}
      {!loading && !error && models.length === 0 && <p role="status">{en ? 'No models are registered.' : '登録されたモデルがありません。'}</p>}
      {selected && <div id={infoId} className="k-model-selector__info">
        {selected.provider_type && <p>{en ? 'Destination: ' : '送信先：'}{selected.provider_type}{selected.upstream ? ` / ${selected.upstream}` : ''}</p>}
        {selected.retains_prompts && <p><strong>{en ? 'This provider retains your input.' : 'この提供元は入力を保存します。'}</strong></p>}
        {selected.training && <p><strong>{en ? 'Conversations, settings, memories and generated results may be used to train or improve AI. Explicit consent is required for each send.' : '会話・設定・記憶・生成結果をAIの学習・改善に利用する可能性があります。送信ごとの明示的な同意が必要です。'}</strong></p>}
        {selected.service_tier?.toLowerCase() === 'flex' && <p>{en ? 'Flex responses may take longer or be unavailable.' : 'Flexは応答まで長く待つ場合や、利用できない場合があります。'}</p>}
        {selected.available === false && <p role="status">{en ? 'Unavailable: ' : '利用できません：'}{friendlyMessage(selected.unavailable_reason || 'cloud_route_not_available', language)}</p>}
        <details key={selected.id} className="k-model-selector__details">
          <summary>{en ? 'Technical details, reference prices and retention' : '技術情報・参考価格・保存条件'}</summary>
          <div>{en ? 'Model ID: ' : 'モデルID：'}{selected.provider_model || selected.id}</div>
          {selected.quantization && <div>{en ? 'Quantization: ' : '量子化：'}{selected.quantization}</div>}
          {selected.reasoning_effort && <div>{en ? 'Reasoning: ' : '推論：'}{selected.reasoning_effort === 'low' ? (en ? 'Low' : '低（low）') : ['none', 'disabled'].includes(selected.reasoning_effort) ? (en ? 'Disabled' : '無効') : selected.reasoning_effort}</div>}
          {selected.reasoning_summary_supported !== undefined && <div>{en ? 'Official reasoning summary: ' : '公式推論要約：'}{selected.reasoning_summary_supported ? (en ? 'Supported (may be absent in some responses)' : '取得対応（提供されない応答もあります）') : (en ? 'Not supported' : '取得は未対応')}</div>}
          {selected.pricing && <div>{en ? 'Reference price' : '参考単価'}（{selected.pricing.currency || 'USD'} / {en ? '1 million tokens' : '100万トークン'}）：{en ? 'Input ' : '入力 '}{selected.pricing.input_per_million ?? (en ? 'Unpublished' : '未公表')} / {en ? 'Output ' : '出力 '}{selected.pricing.output_per_million ?? (en ? 'Unpublished' : '未公表')}{selected.pricing.observed_at && (en ? ` (checked ${selected.pricing.observed_at})` : `（${selected.pricing.observed_at}確認）`)}{en ? '. Review the actual limit in the quote before sending.' : '。実際の上限は送信前の見積もりで確認します。'}</div>}
          {selected.privacy_note && <div>{selected.privacy_note}</div>}
        </details>
      </div>}
    </div>
  );
}
