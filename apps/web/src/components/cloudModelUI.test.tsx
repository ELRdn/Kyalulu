import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ModelSelector from './ModelSelector';
import ReasoningSummary from './ReasoningSummary';
import CloudQuoteConfirmation from './CloudQuoteConfirmation';
import CloudRouteControls, { defaultCloudRoute } from './CloudRouteControls';
import VisualNovelScene from './VisualNovelScene';
import type { ModelInfo } from '../lib/api';
import { QuoteConsent, type PendingQuote } from '../lib/quoteConsent';

const ids = ['cloud-deepseek-baidu', 'cloud-deepseek-decart', 'cloud-deepseek-inferencenet',
  'cloud-glm-inferencenet', 'cloud-gpt-luna-flex', 'cloud-claude-haiku'];
const models: ModelInfo[] = ids.map(id => ({ id, display_name: id, provider_type: 'openrouter',
  provider_model: id, quantization: '', upstream: id === 'cloud-claude-haiku' ? 'google-vertex/global' : 'published-endpoint',
  available: true, unavailable_reason: null }));

describe('Cloud model information', () => {
  it('shows all six published choices and disables unavailable routes without changing the selection', () => {
    const change = vi.fn();
    const unavailable = models.map(model => model.id === ids[1]
      ? { ...model, available: false, unavailable_reason: 'provider_endpoint_unavailable' } : model);
    const html = renderToStaticMarkup(<ModelSelector models={unavailable} value={ids[1]} onChange={change} />);
    for (const id of ids) expect(html).toContain(`value="${id}"`);
    expect(html).toMatch(/<option[^>]*value="cloud-deepseek-decart"[^>]*disabled=""[^>]*selected=""/);
    expect(html).toContain('この提供元の接続先は現在利用できません');
    expect(html).not.toContain('provider_endpoint_unavailable');
    expect(html).toContain('送信先：openrouter / published-endpoint');
    expect(html).toContain('aria-describedby=');
    expect(change).not.toHaveBeenCalled();
  });

  it('allows all six choices when the API publishes them as available', () => {
    const html = renderToStaticMarkup(<ModelSelector models={models} value={ids[0]} onChange={vi.fn()} />);
    for (const id of ids) expect(html).toContain(`value="${id}"`);
    expect(html).not.toContain('disabled=""');
  });

  it('renders actual upstream, reasoning capability and reference pricing generically', () => {
    const model = { ...models[5], reasoning_effort: 'disabled', reasoning_summary_supported: false,
      pricing: { input_per_million: '0.05', output_per_million: '0.25', currency: 'USD' },
      service_tier: 'flex', privacy_note: 'Published privacy policy', retains_prompts: true };
    const html = renderToStaticMarkup(<ModelSelector models={[model]} value={model.id} onChange={vi.fn()} />);
    expect(html).toContain('google-vertex/global');
    expect(html).toContain('推論：無効');
    expect(html).toContain('公式推論要約：取得は未対応');
    expect(html).toContain('入力 0.05 / 出力 0.25');
    expect(html).toContain('長く待つ場合');
    expect(html).toContain('Published privacy policy');
    expect(html).toContain('この提供元は入力を保存します');
  });

  it('keeps non-Go route controls informational with no duplicate selector or training checkbox', () => {
    const html = renderToStaticMarkup(<CloudRouteControls currentModel={models[0]} value={defaultCloudRoute} onChange={vi.fn()} disabled={false} />);
    expect(html).toContain('送信ボタンで会話が始まります。送信先と消費上限はチャット内に表示します。');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('type="checkbox"');
  });

  it('explains enabled provider training and storage from model metadata', () => {
    const model = { ...models[0], available: true, training: true, retains_prompts: true,
      privacy_note: 'Baiduの保存期間は未確認です。' };
    const html = renderToStaticMarkup(<ModelSelector models={[model]} value={model.id} onChange={vi.fn()} />);
    expect(html).toContain('AIの学習・改善に利用する可能性');
    expect(html).toContain('送信ごとの明示的な同意');
    expect(html).toContain('Baiduの保存期間は未確認');
    expect(html).not.toContain('disabled=""');
  });

  it('keeps Baidu storage/training warnings visible while collapsing technical details and pricing', () => {
    const model = { ...models[0], display_name: 'DeepSeek V4.1 Flash · Baidu', upstream: 'Baidu',
      provider_model: 'deepseek/deepseek-v4.1-flash', training: true, retains_prompts: true,
      reasoning_effort: 'low', pricing: { input_per_million: '0.0348' }, privacy_note: '保存期間は未確認です。' };
    const html = renderToStaticMarkup(<ModelSelector models={[model]} value={model.id} onChange={vi.fn()} disabled />);
    const primary = html.split('<details')[0];
    expect(primary).toContain('DeepSeek V4.1 Flash · Baidu');
    expect(primary).toContain('送信先：openrouter / Baidu');
    expect(primary).toContain('この提供元は入力を保存します');
    expect(primary).toContain('会話・設定・記憶・生成結果をAIの学習・改善');
    expect(primary).toContain('送信ごとの明示的な同意');
    expect(primary).not.toContain('deepseek/deepseek-v4.1-flash');
    expect(primary).not.toContain('0.0348');
    expect(primary).not.toContain('推論：');
    expect(html).toContain('保存期間は未確認');
    expect(html).not.toMatch(/<details[^>]*\bopen=/);
    expect(html).toMatch(/<select[^>]*class="k-input"[^>]*disabled=""/);
    expect(html).toMatch(/<option[^>]*>DeepSeek V4.1 Flash · Baidu<\/option>/);
  });

  it.each([
    { loading: true, error: '', message: 'モデルを読込中…', role: 'status' },
    { loading: false, error: '', message: '登録されたモデルがありません。', role: 'status' },
    { loading: false, error: 'Failed to fetch', message: 'モデルを取得できません', role: 'alert' },
  ])('distinguishes model loading, empty and error states: $message', ({ loading, error, message, role }) => {
    const change = vi.fn();
    const html = renderToStaticMarkup(<ModelSelector models={[]} value="saved-model" onChange={change} loading={loading} error={error} />);
    expect(html).toContain(message);
    expect(html).toContain(`role="${role}"`);
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toContain('value="saved-model" selected=""');
    expect(change).not.toHaveBeenCalled();
  });
});

it('blocks unchecked Baidu consent, supports revocation and resets it for the next quote', async () => {
  let pending: PendingQuote | null = null;
  const consent = new QuoteConsent(quote => { pending = quote; });
  const quote = { quote_id: 'baidu-1', max_credits: 12, route: { display_name: 'Baidu', provider: 'openrouter',
    upstream: 'Baidu', model: 'deepseek', training: true, retains_prompts: true, training_consent_required: true } };
  const markup = () => renderToStaticMarkup(<CloudQuoteConfirmation quote={pending!} onAccept={() => consent.accept()}
    onCancel={() => consent.cancel()} onProviderTrainingConsentChange={checked => consent.acknowledgeProviderTraining(pending!.quote_id, checked)} />);
  const first = consent.request(quote, new AbortController().signal, false);
  expect(markup()).toContain('Baiduが会話・設定・記憶・生成結果を保存し、AIの学習・改善に利用する可能性に同意します');
  expect(markup()).toMatch(/<input[^>]*type="checkbox"(?![^>]*checked=)/);
  expect(markup()).toMatch(/<button[^>]*disabled=""[^>]*>送信する/);
  consent.accept(); expect(pending).not.toBeNull();
  consent.acknowledgeProviderTraining('baidu-1', true);
  expect(markup()).toMatch(/<input[^>]*checked=""/);
  expect(markup()).not.toMatch(/<button[^>]*disabled=""[^>]*>送信する/);
  consent.acknowledgeProviderTraining('baidu-1', false);
  consent.accept(); expect(pending).not.toBeNull();
  consent.acknowledgeProviderTraining('baidu-1', true);
  consent.accept(); expect(await first).toBe(true);
  const second = consent.request({ ...quote, quote_id: 'baidu-2' }, new AbortController().signal, false);
  consent.acknowledgeProviderTraining('baidu-1', true); // A stale checkbox event cannot acknowledge a new quote.
  expect(markup()).not.toMatch(/<input[^>]*checked=""/);
  expect(markup()).toMatch(/<button[^>]*disabled=""[^>]*>送信する/);
  consent.accept(); expect(pending).not.toBeNull();
  consent.cancel(); expect(await second).toBe(false);
});

describe('official reasoning summary', () => {
  it('places the normal chat summary before the message while retaining editing and streaming guards', () => {
    const source = readFileSync(new URL('../pages/ActiveChat.tsx', import.meta.url), 'utf8');
    const summary = source.indexOf('{isAssistant && !isEditing && !isStreaming && <ReasoningSummary');
    const message = source.indexOf('<MessageContent content={m.content}');
    expect(summary).toBeGreaterThan(-1);
    expect(message).toBeGreaterThan(summary);
  });
  it.each(['unsupported', 'not_provided', 'available'] as const)('hides a local reply without a summary even with %s status', status => {
    expect(renderToStaticMarkup(<ReasoningSummary cloud={false} message={{ role: 'assistant', content: 'local reply',
      reasoning_summary: null, reasoning_summary_status: status }} />)).toBe('');
  });
  it('preserves an actual official summary supplied by a local route', () => {
    const html = renderToStaticMarkup(<ReasoningSummary cloud={false} message={{ role: 'assistant', content: 'local reply',
      reasoning_summary: 'Official local summary', reasoning_summary_status: 'available' }} />);
    expect(html).toContain('Official local summary');
    expect(html).not.toMatch(/<details[^>]*\bopen=/);
  });
  it('shows the same persisted summary in visual novel mode only after completion', () => {
    const messages = [{ role: 'assistant', content: 'Scene dialogue', reasoning_summary: 'Official scene summary' }];
    const props = { messages, name: 'Character', assets: [], cloud: true };
    const html = renderToStaticMarkup(<VisualNovelScene {...props} streaming={false} />);
    expect(html).toContain('Official scene summary');
    expect(html).not.toMatch(/<details[^>]*\bopen=/);
    expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('class="k-msg__stack"'));
    expect(renderToStaticMarkup(<VisualNovelScene {...props} streaming />)).not.toContain('Official scene summary');
  });
  it('renders the official field as escaped text in a closed native accessible disclosure', () => {
    const message = { role: 'assistant', content: 'answer <think>hidden body</think>', model_id: ids[4],
      reasoning_summary: 'Official summary\n<script>alert(1)</script>', reasoning_summary_status: 'available' as const,
      reasoning: 'raw hidden chain', reasoning_content: 'another hidden chain' };
    const html = renderToStaticMarkup(<ReasoningSummary message={message} cloud />);
    expect(html).toContain('<details');
    expect(html).toContain('<summary>公式推論要約</summary>');
    expect(html).not.toMatch(/<details[^>]*\bopen=/);
    expect(html).toContain('Official summary');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('hidden body');
    expect(html).not.toContain('hidden chain');
  });

  it.each(['unsupported', 'not_provided'] as const)('explains %s and ignores contradictory summary text', status => {
    const html = renderToStaticMarkup(<ReasoningSummary cloud message={{ role: 'assistant', content: 'answer',
      reasoning_summary: 'must not show', reasoning_summary_status: status }} />);
    expect(html).toContain(status === 'unsupported' ? '取得が未実装' : '提供されていません');
    expect(html).not.toContain('このモデル・提供元は');
    expect(html).not.toContain('must not show');
  });

  it.each([{ role: 'user', content: 'hi', reasoning_summary: 'wrong role' },
    { role: 'assistant', content: '' }, { role: 'assistant', content: 'intro', model_id: 'intro' },
    { role: 'assistant', content: 'local answer' }])('omits ungenerated and local messages without metadata', message => {
    expect(renderToStaticMarkup(<ReasoningSummary message={message} />)).toBe('');
  });
});

it('renders Baidu consent inline with destination, cap and privacy visible', () => {
  const html = renderToStaticMarkup(<CloudQuoteConfirmation quote={{ quote_id: 'q', max_credits: 12,
    expiresAt: Date.now() + 10000, trainingConsent: false, providerTrainingConsent: false,
    route: { display_name: 'DeepSeek · Baidu', provider: 'openrouter', upstream: 'Baidu', model: 'deepseek',
      training_consent_required: true, retains_prompts: true, privacy_note: 'Published privacy note' } }}
    onAccept={vi.fn()} onCancel={vi.fn()} />);
  expect(html).toContain('<section class="k-quote" aria-label="送信前の見積確認">');
  expect(html).not.toContain('<dialog');
  expect(html).not.toContain('aria-modal=');
  expect(html).not.toContain('autofocus');
  expect(html).not.toContain('role="status"');
  expect(html).toContain('<h2>この送信の保存・学習利用</h2>');
  expect(html).toContain('DeepSeek · Baidu');
  expect(html).toContain('Baidu（openrouter経由）');
  expect(html).toContain('上限 12 K-Credits');
  expect(html).toContain('Published privacy note');
  expect(html).toContain('クレジットは予約せず、完了後に実費精算');
  expect(html).toContain('失敗時の消費は0');
  expect(html).toContain('キャンセル');
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>送信する/);
});

it('keeps an expired Baidu quote unsendable even after checking consent', () => {
  const accept = vi.fn();
  const html = renderToStaticMarkup(<CloudQuoteConfirmation quote={{ quote_id: 'expired', max_credits: 12,
    expiresAt: Date.now() - 1000, trainingConsent: false, providerTrainingConsent: true,
    route: { display_name: 'Baidu', provider: 'openrouter', model: 'fixture', training_consent_required: true } }}
    onAccept={accept} onCancel={vi.fn()} />);
  expect(html).toContain('見積もりの期限が切れました');
  expect(html).toContain('role="status"');
  expect(html).toMatch(/<input[^>]*checked=""/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>送信する/);
  expect(html).toContain('Baiduは会話・設定・記憶・生成結果を保存し、AIの学習・改善');
  expect(accept).not.toHaveBeenCalled();
});
