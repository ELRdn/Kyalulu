import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

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
