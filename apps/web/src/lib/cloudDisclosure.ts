// Versions the bundled UI actually knows how to explain. Never authorize a
// freshly fetched opaque version with stale provider disclosure text.
const BASE = '2026-10-03-provider-routing-v2';
const KNOWN: Record<string,string> = {
  'opencode-go': BASE+'-opencode-go-direct-generation',
  'deepseek': BASE+'-deepseek-direct-generation',
  'openrouter': BASE+'-openrouter-model-choices-v6-region',
};
export function understoodDisclosure(provider:unknown,version:unknown,route?:OperatorRoute|null):string|null {
  if(typeof provider!=='string'||typeof version!=='string') return null;
  const expected=Object.hasOwn(KNOWN,provider)?KNOWN[provider]:null;
  if (expected !== version || route?.provider !== provider || route.safety?.enabled !== false) return null;
  if (provider === 'openrouter') {
    if (!Array.isArray(route.models) || !route.models.length) return null;
    try { operatorDisclosure(route); } catch { return null; }
    if (typeof route.model !== 'string' || !route.model || typeof route.upstream !== 'string' || !route.upstream ||
      typeof route.available !== 'boolean' || route.models.some(model =>
        typeof model.available !== 'boolean' || typeof model.training !== 'boolean' ||
        typeof model.retains_prompts !== 'boolean' || typeof model.training_consent_required !== 'boolean' ||
        model.training_consent_required !== model.training || typeof model.privacy_note !== 'string' || !model.privacy_note.trim())) return null;
  }
  return version;
}

export type OperatorRoute = {
  provider: string; upstream?: string; model?: string; available?: boolean;
  safety?: { enabled: false };
  models?: { id: string; display_name?: string; provider?: string; provider_type?: string;
    upstream?: string | null; model?: string; provider_model?: string; available?: boolean;
    privacy_note?: string | null; retains_prompts?: boolean; training?: boolean; training_consent_required?: boolean }[];
};

export function operatorDisclosure(route: OperatorRoute | null) {
  if (route?.provider === 'openrouter' && route.models?.length) {
    if ([route.upstream, route.model].some(value => value !== undefined && typeof value !== 'string') ||
      (route.available !== undefined && typeof route.available !== 'boolean')) {
      throw Error('モデルの送信先を確認できません。');
    }
    for (const model of route.models) {
      if (!model || typeof model.id !== 'string' || !model.id || typeof model.upstream !== 'string' || !model.upstream ||
        typeof (model.model || model.provider_model) !== 'string' || !(model.model || model.provider_model) ||
        [model.display_name, model.provider, model.provider_type].some(value => value !== undefined && typeof value !== 'string') ||
        [model.available, model.retains_prompts, model.training, model.training_consent_required].some(value => value !== undefined && typeof value !== 'boolean') ||
        (model.privacy_note != null && typeof model.privacy_note !== 'string') ||
        ((model.retains_prompts || model.training) && !model.privacy_note?.trim())) {
        throw Error('モデルの送信先を確認できません。');
      }
    }
    const destinations = route.models.filter(model => model.available !== false).map(model =>
      [model.display_name || model.id, model.provider || model.provider_type || route.provider,
        model.upstream, model.model || model.provider_model].filter(Boolean).join(' / ') +
      (model.retains_prompts ? '（提供元が入力を保存します）' : '') +
      (model.training ? '（会話・設定・記憶・生成結果をAIの学習・改善に利用する可能性があります。送信ごとの別の同意が必要です）' : '') +
      (model.privacy_note ? `：${model.privacy_note}` : ''));
    const standard = route.available !== false && route.model ? `標準の会話送信先：${route.provider} / ${route.upstream || ''} / ${route.model}。` : '';
    return { explanation: `${standard}${destinations.length ? `追加で選択できる会話の送信先：${destinations.join('、')}。` : '追加モデルは現在利用できません。'}入力・出力の外部安全検査は行いません。通常の送信は確認画面なしで始まります。会話の送信先と消費上限はチャット内に表示します。クレジットは予約せず、完了後にAPI実費に基づいて上限内で精算します。別のモデルや提供元へは自動転送しません。`,
      destination: '表示された提供元（送信先と消費上限をチャット内に表示）' };
  }
  const provider = route?.provider;
  return { explanation: (provider === 'openrouter'
    ? `生成はOpenRouter経由で${route?.upstream || 'InferenceNet'}が提供する${route?.model || 'DeepSeek V4.1 Flash'}を使用します。別のモデルや提供元へは自動転送しません。`
    : provider === 'opencode-go'
      ? 'OpenCode Go経由のMiMo／DeepSeekを使用します。Muse Contributorは学習利用への別の同意が必要で、自動では使用しません。'
      : '生成にはDeepSeek V4.1 Flashを使用します。') + '入力・出力の外部安全検査は行いません。クレジットは予約せず、完了後にAPI実費に基づいて表示された消費上限内で精算します。',
    destination: provider === 'openrouter' ? `OpenRouter／${route?.upstream || 'InferenceNet'}経由の${route?.model || 'DeepSeek'}` : provider === 'opencode-go' ? 'OpenCode Go経由のDeepSeek／MiMo' : 'DeepSeek' };
}
