import { describe, expect, it, vi } from "vitest";
import { friendlyError, friendlyMessage, localTransferMessage } from "./errors";

it.each(['Web Locks are required for on-device generation','A generation is already running in another tab',
  'Generation is running in another tab; stop it there','Reconcile the pending generation before sending again',
  'Pending generation changed; reload before recovery',
  'Close the original app tabs and confirm the saved result before recovering this older generation'])('localizes device generation recovery instructions: %s',text=>{
  expect(friendlyMessage(text,'ja')).toMatch(/[\u3040-\u9fff]/u);
  expect(friendlyMessage(text,'en')).toBe(text);
});

describe("friendlyError", () => {
  it.each(['provider_rate_limited', 'HTTP 429', Object.assign(Error('Too Many Requests'), { status: 429 })])('explains upstream rate limiting with manual retry or model selection: %s', raw => {
    const result = friendlyError(raw);
    expect(result.message).toContain('提供元の利用制限');
    expect(result.message).toContain('時間を置いて再試行');
    expect(result.message).toContain('別の会話モデル');
    expect(result.message).toContain('K-Creditsの消費は0');
    expect(result.message).not.toContain('停止');
    expect(result.message).not.toContain('請求情報');
    expect(result.command).toBeUndefined();
  });
  it('explains a genuine operator budget or invalid-cost stop even with credits remaining', () => {
    const result = friendlyError('operator_budget_exhausted');
    expect(result.message).toContain('運営側のAPI予算');
    expect(result.message).toContain('料金情報に問題');
    expect(result.message).toContain('K-Credits残高があっても');
    expect(result.command).toBeUndefined();
  });
  it.each(['provider_endpoint_unavailable', 'provider_retention_approval_required', 'provider_privacy_unverified', 'provider_terms_unverified',
    'model_catalog_unverified', 'cloud_route_not_available', 'provider_key_not_configured', 'future_provider_gate'])('explains %s in Japanese without exposing codes', code => {
    const message = friendlyError(code).message;
    expect(message).not.toContain(code);
    expect(message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
  });
  it('explains insufficient input funds without promising a credit hold', () => {
    const message = friendlyError('insufficient_credits').message;
    expect(message).toContain('入力料金');
    expect(message).toContain('入力を短く');
    expect(message).not.toContain('予約');
  });
  it.each(['safety_unavailable', 'safety_route_unavailable', 'safety_rate_limited', 'safety_provider_configuration_error'])("does not promise retired screening for a legacy error: %s", code => {
    const result = friendlyError(code);
    expect(result.message).not.toContain('安全検査');
    expect(result.message).not.toContain(code);
    expect(result.command).toBeUndefined();
  });
  it("explains a stale download without suggesting an automatic retry", () => {
    const f = friendlyError("transfer_source_changed_restart_download");
    expect(f.message).toContain("以前の転送を停止");
    expect(f.message).toContain("転送を取り消し");
    expect(f.command).toBeUndefined();
  });
  it("turns an unloaded LE model into a load command", () => {
    const f = friendlyError("HTTPStatusError: model_not_loaded [le/qwen3-8b-q4]");
    expect(f.command).toEqual({ label: "ロードする", input: "/le load le/qwen3-8b-q4" });
    expect(f.message).toContain("le/qwen3-8b-q4");
  });

  it("points LE connection failures at the diagnostics page", () => {
    expect(friendlyError("le_unavailable").action?.to).toBe("/status");
  });

  it("keeps the generic HTTP mapping for other provider errors", () => {
    const f = friendlyError("HTTPStatusError: model_not_found [le:ollama/x]");
    expect(f.command).toBeUndefined();
    expect(f.action?.to).toBe("/studio");
  });
});
it('説明する: 準備中の会話消去では再見積りが必要', () => {
  expect(friendlyError('generation_context_changed').message).toContain('新しい見積り');
  expect(friendlyError('generation_context_changed').message).toContain('消費は0');
});

it.each([
  'context_conflict', 'community_awaiting_acceptance', 'transfer_source_changed_restart_download', 'generation_context_changed',
  'login_cancelled', 'authentication_not_configured', 'profile_conflict', 'invalid_display_name', 'profile_item_limit',
  'account_not_allowed', 'cloud_residence_country_required', 'terms_consent_required', 'authentication_flow_expired', 'authentication_failed',
  'insufficient_credits', 'operator_budget_exhausted', 'cloud_registration_capacity_reached', 'provider_consent_renewal_required',
  'provider_retention_approval_required', 'provider_endpoint_unavailable', 'provider_privacy_unverified', 'provider_terms_unverified',
  'model_catalog_unverified', 'cloud_route_not_available', 'provider_key_not_configured', 'inference_awaiting_acceptance',
  'provider_usage_unavailable', 'provider_rate_limited', 'cloud_sfw_only', 'allow_nsfw', 'le_unavailable', 'ECONNREFUSED',
  'Generation failed', 'Failed to fetch', 'Timeout', 'Internal Server Error', 'HTTP 404', 'HTTP 401', 'HTTP 403', 'future_provider_gate', '',
])('explains %s in English without exposing a machine code', raw => {
  const result = friendlyError(raw, 'en');
  expect(result.message.length).toBeGreaterThan(10);
  expect(JSON.stringify(result)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  if (raw) expect(result.message).not.toBe(raw);
});

it('localizes guidance while preserving manual actions and accounting distinctions', () => {
  const unloaded = friendlyError('HTTPStatusError: model_not_loaded [le/qwen3-8b-q4]', 'en');
  expect(unloaded.command).toEqual({ label: 'Load model', input: '/le load le/qwen3-8b-q4' });
  expect(friendlyError('le_unavailable', 'en').action).toEqual({ label: 'Diagnose connection', to: '/status' });
  expect(friendlyError('allow_nsfw', 'en').action?.to).toBe('/profile#adult');
  expect(friendlyError('generation_context_changed', 'en').message).toContain('new quote before sending');
  expect(friendlyError('provider_rate_limited', 'en').message).toContain('Failed generation charged no K-Credits');
  expect(friendlyError('provider_usage_unavailable', 'en').message).toContain('No K-Credits were charged');
  expect(friendlyError('operator_budget_exhausted', 'en').message).toContain('even with K-Credits remaining');
  expect(friendlyError('insufficient_credits', 'en').message).not.toContain('No K-Credits');
  expect(friendlyError('transfer_source_changed_restart_download', 'en').command).toBeUndefined();
});

it('uses the current browser preference, preserves unknown details and accepts explicit language', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'kyalulu-app-preferences-v1' ? JSON.stringify({ version: 1, language: 'en' }) : null });
  try {
    expect(friendlyMessage('insufficient_credits')).toContain('input cost');
    expect(friendlyMessage('insufficient_credits', 'ja')).toContain('入力料金');
    expect(friendlyMessage('Specific provider detail')).toBe('Specific provider detail');
  } finally { vi.unstubAllGlobals(); }
});

it.each([400, 401, 500])('localizes the exact capabilities failure and retains HTTP %s', status => {
  const raw = `機能情報の取得に失敗しました (HTTP ${status})`;
  expect(friendlyMessage(Error(raw), 'en')).toBe(`Could not retrieve feature information (HTTP ${status})`);
  expect(friendlyMessage(Error(raw), 'ja')).toBe(raw);
});
it('preserves an unknown diagnostic containing the capabilities template', () => {
  const raw = 'CUSTOM: 機能情報の取得に失敗しました (HTTP 400) upstream detail';
  expect(friendlyMessage(raw, 'en')).toBe(raw);
});

it.each([
  ['Saved memory history is invalid','保存された記憶の履歴が不正です。'],
  ['Memory identity is ambiguous; use a separate conversation copy','記憶の識別情報が曖昧です。会話を別のコピーにして利用してください。'],
  ['Memory must have 1-200 characters','記憶は1〜200文字で入力してください。'],
  ['Invalid memory type','記憶の種類が不正です。'],
  ['Invalid memory source','記憶の出典が不正です。'],
  ['Choose whether memory is enabled','記憶を有効にするか選んでください。'],
  ['Stop generation before editing','編集する前に生成を停止してください。'],
  ['On-device memories remain isolated to their conversation','端末内の記憶は、その会話内だけで保持されます。'],
])('localizes only the exact memory API message through the core renderer: %s',(raw,ja)=>{
  for(const [language,expected] of [['ja',ja],['en',raw]] as const){
    for(const cause of [raw,Error(raw),`Error: ${raw}`]){
      expect(friendlyError(cause,language)).toEqual({message:expected});
      expect(friendlyMessage(cause,language)).toBe(expected);
    }
    for(const unknown of [`CUSTOM: ${raw}`,`${raw} / 原文の提供元診断`]){
      expect(friendlyError(unknown,language)).toEqual({message:unknown});
      expect(friendlyMessage(Error(unknown),language)).toBe(unknown);
    }
  }
});

it('shares the exact storage failure translation across core and local-transfer renderers',()=>{
  const raw='Device save/read failed; original data retained / 保存・読込に失敗しました。原本は保持されています';
  for(const [language,expected] of [['ja','保存・読込に失敗しました。原本は保持されています。'],['en','Device save/read failed. Original data is retained.']] as const){
    for(const cause of [raw,Error(raw),`Error: ${raw}`]){
      expect(friendlyError(cause,language)).toEqual({message:expected});
      expect(friendlyMessage(cause,language)).toBe(localTransferMessage(raw,language));
    }
    for(const unknown of [`CUSTOM: ${raw}`,`${raw} / 原文の提供元診断`])expect(friendlyMessage(Error(unknown),language)).toBe(unknown);
  }
});

it.each([
  'Account changed','Account changed / アカウントが切り替わりました','Allow popups or use a file below.',
  'Reconnect to transfer models / モデル転送には再接続してください','40 MiB limit','Migration exceeds 40 MiB',
  'Close other app tabs and reload to upgrade device storage / 他のタブを閉じて再読み込みしてください',
  'Cannot open device storage; use a v3-compatible client / v3対応のアプリで保存領域を開いてください',
  'Device save/read failed; original data retained / 保存・読込に失敗しました。原本は保持されています',
  '下書きの保存データを読み込めません。送信を停止しています。','下書きを端末に保存できませんでした。',
  'Unsupported migration format','Migration size or SHA-256 mismatch','Invalid migration manifest / 移行情報が不正です',
  'Migration reply out of order','Invalid migration reply','Migration cancelled / 移行を中止しました',
  'Migration connection closed / 再接続してください','Migration connection closed','Concurrent migration request',
  'Migration timed out / 移行元を開いて再接続してください','Migration timed out / 移行元で転送を許可してください',
  'Migration send failed','Migration chunk size mismatch','Migration SHA-256 mismatch',
  'Migration read failed / 元データを読み取れません。書き出し方式を利用してください。',
  'バックアップは32MiB以下にしてください。','Kyalulu Mobileのバックアップではありません。','キャラIDが重複しています。',
  '会話データが不正です。','メッセージが不正です。','不正なモデル登録','不正なモデルファイル','GGUFは2GiB未満の分割が必要です。',
  'このブラウザはモデルを保存するOPFSに対応していません。最新版のChromeまたはSafariで開いてください。',
  'Model files unavailable','Storage full / 端末の保存容量が不足しています','Web Locks required / 対応ブラウザで開いてください',
  'このモデルの分割配布はまだ準備中です。','端末の保存容量が不足しています。不要なモデルを削除してください。',
  'モデルのサイズが登録内容と異なります。','モデルのサイズまたはSHA-256が一致しません。再試行してください。',
])('localizes the exact first-party transfer failure in both languages: %s',raw=>{
  expect(localTransferMessage(raw,'en')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  expect(localTransferMessage(raw,'ja')).toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  for(const language of ['ja','en'] as const)expect(localTransferMessage('Error: '+raw,language)).toBe(localTransferMessage(raw,language));
});

it('keeps transfer recovery instructions, byte limits, integrity checks and HTTP status distinct',()=>{
  expect(localTransferMessage('Migration timed out / 移行元を開いて再接続してください','en')).toContain('Open the source and reconnect');
  expect(localTransferMessage('Migration timed out / 移行元で転送を許可してください','en')).toContain('Allow transfer in the source window');
  expect(localTransferMessage('40 MiB limit','en')).toContain('40 MiB');
  expect(localTransferMessage('Migration size or SHA-256 mismatch','en')).toContain('size or SHA-256');
  for(const status of [403,429,503]){
    const raw=`モデルの取得に失敗しました（HTTP ${status}）。`;
    expect(localTransferMessage('Error: '+raw,'en')).toBe(`Could not download the model (HTTP ${status}).`);
    expect(localTransferMessage(raw,'ja')).toBe(raw);
  }
});

it.each(['Error: CUSTOM Migration cancelled / 移行を中止しました','CUSTOM モデルの取得に失敗しました（HTTP 503）。 upstream detail',
  'Error: HTTP 503 Timeout Failed to fetch: 原文の診断  ','  authored text 原文  ','constructor','__proto__'])('preserves unknown transfer evidence verbatim: %s',raw=>{
  for(const language of ['ja','en'] as const)expect(localTransferMessage(raw,language)).toBe(raw);
});
