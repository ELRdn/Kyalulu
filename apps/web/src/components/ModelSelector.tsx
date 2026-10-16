import type { ModelInfo } from "../lib/api";
import { useId } from 'react';
import { friendlyMessage } from '../lib/errors';
import './modelSelector.css';

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
  const selected = models.find(model => model.id === value);
  return (
    <div className="k-model-selector" aria-busy={loading}>
      <label style={{ fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap" }}>モデル</label>
      <select
        className="k-input"
        disabled={disabled || loading || Boolean(error) || models.length === 0}
        aria-label="会話モデル"
        aria-describedby={selected ? infoId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {models.length === 0 && <option value={value}>{loading ? 'モデルを読込中…' : error ? 'モデルを取得できません' : 'モデルがありません'}</option>}
        {models.length > 0 && !selected && <option value={value} disabled>選択中のモデル（一覧にありません）</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id} disabled={m.available === false}>
            {m.display_name}{m.available === false ? '（利用不可）' : ''}
          </option>
        ))}
      </select>
      {loading && <p role="status">モデルを読込中…</p>}
      {error && <p role="alert">モデルを取得できません：{friendlyMessage(error)}</p>}
      {!loading && !error && models.length === 0 && <p role="status">登録されたモデルがありません。</p>}
      {selected && <div id={infoId} className="k-model-selector__info">
        {selected.provider_type && <p>送信先：{selected.provider_type}{selected.upstream ? ` / ${selected.upstream}` : ''}</p>}
        {selected.retains_prompts && <p><strong>この提供元は入力を保存します。</strong></p>}
        {selected.training && <p><strong>会話・設定・記憶・生成結果をAIの学習・改善に利用する可能性があります。送信ごとの明示的な同意が必要です。</strong></p>}
        {selected.service_tier?.toLowerCase() === 'flex' && <p>Flexは応答まで長く待つ場合や、利用できない場合があります。</p>}
        {selected.available === false && <p role="status">利用できません：{friendlyMessage(selected.unavailable_reason || 'cloud_route_not_available')}</p>}
        <details key={selected.id} className="k-model-selector__details">
          <summary>技術情報・参考価格・保存条件</summary>
          <div>モデルID：{selected.provider_model || selected.id}</div>
          {selected.quantization && <div>量子化：{selected.quantization}</div>}
          {selected.reasoning_effort && <div>推論：{selected.reasoning_effort === 'low' ? '低（low）' : ['none', 'disabled'].includes(selected.reasoning_effort) ? '無効' : selected.reasoning_effort}</div>}
          {selected.reasoning_summary_supported !== undefined && <div>公式推論要約：{selected.reasoning_summary_supported ? '取得対応（提供されない応答もあります）' : '取得は未対応'}</div>}
          {selected.pricing && <div>参考単価（{selected.pricing.currency || 'USD'} / 100万トークン）：入力 {selected.pricing.input_per_million ?? '未公表'} / 出力 {selected.pricing.output_per_million ?? '未公表'}{selected.pricing.observed_at && `（${selected.pricing.observed_at}確認）`}。実際の上限は送信前の見積もりで確認します。</div>}
          {selected.privacy_note && <div>{selected.privacy_note}</div>}
        </details>
      </div>}
    </div>
  );
}
