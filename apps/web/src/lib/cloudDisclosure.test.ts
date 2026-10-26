import {expect,it} from 'vitest';
import {operatorDisclosure,understoodDisclosure} from './cloudDisclosure';
const safety = { enabled: false as const };
const base = '2026-10-03-provider-routing-v2';
const version = base + '-openrouter-model-choices-v6-region';
const baidu = { id: 'cloud-deepseek-baidu', model: 'deepseek', upstream: 'Baidu', available: true,
  training: true, training_consent_required: true, retains_prompts: true, privacy_note: '保存期間は未確認。地域外への保存もあります。' };
const flex = { id: 'cloud-gpt-luna-flex', model: 'GPT', upstream: 'OpenAI', available: true,
  training: false, training_consent_required: false, retains_prompts: true, privacy_note: '通常最大30日保存。学習には利用しません。' };
const route = { provider: 'openrouter', model: 'standard', upstream: 'InferenceNet', available: true, safety, models: [baidu, flex] };

it('accepts only exact v5 direct-generation consent with complete routing and privacy metadata', () => {
  expect(understoodDisclosure('openrouter', version, route)).toBe(version);
  expect(understoodDisclosure('openrouter', version)).toBeNull();
  for (const invalidVersion of [base + '-openrouter-inferencenet-deepseek-v2',
    base + '-openrouter-model-choices-v3', base + '-openrouter-model-choices-v3-retention',
    base + '-openrouter-model-choices-v4-retention-training', version + '-future']) {
    expect(understoodDisclosure('openrouter', invalidVersion, route)).toBeNull();
  }
  for (const invalidModel of [{ ...baidu, training: undefined }, { ...baidu, training: 'true' },
    { ...baidu, training_consent_required: false }, { ...baidu, retains_prompts: undefined },
    { ...baidu, privacy_note: '' }, { ...baidu, available: undefined }, { id: 'missing-destination' }]) {
    expect(understoodDisclosure('openrouter', version, { ...route, models: [invalidModel] } as never)).toBeNull();
  }
  for (const invalidRoute of [{ ...route, safety: undefined }, { ...route, safety: { enabled: true } },
    { ...route, safety: { provider: 'openrouter', model: 'old-safety' } },
    { ...route, upstream: undefined }, { ...route, models: [] }]) {
    expect(understoodDisclosure('openrouter', version, invalidRoute as never)).toBeNull();
  }
});

it.each([
  ['opencode-go', base + '-opencode-go-direct-generation', base],
  ['deepseek', base + '-deepseek-direct-generation', base + '-direct-deepseek'],
])('requires updated direct-generation disclosure for %s too', (provider, current, old) => {
  const route = { provider, safety };
  expect(understoodDisclosure(provider, current, route)).toBe(current);
  expect(understoodDisclosure(provider, old, route)).toBeNull();
  expect(understoodDisclosure(provider, current, { provider })).toBeNull();
  expect(operatorDisclosure(route).explanation).toContain('入力・出力の外部安全検査は行いません');
});

it('rejects unknown providers, missing versions and mismatched routes', () => {
  expect(understoodDisclosure('future-provider', 'new')).toBeNull();
  expect(understoodDisclosure('constructor', 'toString')).toBeNull();
  expect(understoodDisclosure(null, null)).toBeNull();
  expect(understoodDisclosure('opencode-go', version, route)).toBeNull();
});

it('explains actual destinations, per-send Baidu consent and settlement without screening or holds', () => {
  const text = operatorDisclosure(route).explanation;
  expect(text).toContain('標準の会話送信先：openrouter / InferenceNet / standard');
  expect(text).toContain('Baidu');
  expect(text).toContain('AIの学習・改善に利用する可能性');
  expect(text).toContain('送信ごとの別の同意');
  expect(text).toContain(baidu.privacy_note);
  expect(text).toContain(flex.privacy_note);
  expect(operatorDisclosure(route).destination).toBe('表示された提供元（送信先と消費上限をチャット内に表示）');
  expect(text).toContain('通常の送信は確認画面なしで始まります。会話の送信先と消費上限はチャット内に表示します。');
  expect(text).toContain('入力・出力の外部安全検査は行いません');
  expect(text).toContain('クレジットは予約せず');
  expect(text).toContain('API実費に基づいて上限内で精算');
  expect(text).not.toContain('安全検査の固定送信先');
  const hidden = operatorDisclosure({ ...route, models: [{ ...baidu, available: false }] }).explanation;
  expect(hidden).not.toContain('Baidu');
  expect(hidden).toContain('追加モデルは現在利用できません');
  expect(operatorDisclosure({ provider: 'openrouter', safety, models: [
    { id: 'haiku', upstream: 'google-vertex/global', provider_model: 'anthropic/haiku' },
  ] }).explanation).toContain('haiku / openrouter / google-vertex/global / anthropic/haiku');
});

it('translates routing explanations while retaining original identifiers, privacy notes and version gates',()=>{
  const original=structuredClone(route),text=operatorDisclosure(route,'en').explanation;
  for(const value of ['openrouter / InferenceNet / standard','Baidu','OpenAI',baidu.privacy_note,flex.privacy_note,
    'Separate consent is required for every send','provider stores inputs','Credits are not reserved','actual API costs',
    'not sent for external safety screening','Nothing is automatically forwarded'])expect(text).toContain(value);
  expect(operatorDisclosure({...route,models:[{...baidu,available:false}]},'en').explanation).toContain('Additional models are currently unavailable');
  expect(operatorDisclosure({provider:'opencode-go',safety},'en').explanation).toContain('Muse Contributor requires separate consent');
  expect(operatorDisclosure({provider:'deepseek',safety},'en').destination).toBe('DeepSeek');
  expect(route).toEqual(original);expect(understoodDisclosure('openrouter',version,route)).toBe(version);
});
