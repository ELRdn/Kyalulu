export type FriendlyError = {
  message: string;
  action?: { label: string; to: string };
  /** チャット欄でそのまま実行できるスラッシュコマンド。 */
  command?: { label: string; input: string };
};

/** API・ネットワーク由来の生エラーを、利用者が次に取れる行動つきの日本語に言い換える。 */
export function friendlyError(raw: unknown): FriendlyError {
  const text = String(raw ?? "").replace(/^(Type)?Error:\s*/, "").trim();
  if (/login_cancelled/.test(text)) return {message:'ログインをキャンセルしました。もう一度Googleまたはメールでログインできます。'};
  if (/authentication_not_configured|legal_publication_pending/.test(text)) return {message:'この環境のログインは準備中です。'};
  if (/profile_conflict/.test(text)) return {message:'別の端末で変更されました。最新の内容を読み込みました。変更内容を確認して、もう一度保存してください。'};
  if (/invalid_display_name/.test(text)) return {message:'表示名は1〜80文字で、改行を含めずに入力してください。'};
  if (/profile_item_limit/.test(text)) return {message:'保存できる項目の上限に達しました。不要な項目を解除してください。'};
  if (/account_not_allowed/.test(text)) return {message:'テストに招待したアカウントでログインしてください。'};
  if (/authentication_flow_expired/.test(text)) return {message:'ログインのリンクが失効しました。同じブラウザでログインをやり直してください。'};
  if (/authentication_failed|authentication_unavailable|verified_email_required/.test(text)) return {message:'ログインを確認できませんでした。確認済みのGoogleアカウントまたはメールでやり直してください。'};
  if (/insufficient_credits/.test(text)) return {message:'送信前の予約に必要なK-Creditsが足りません。残高と会話の長さを確認してください。'};
  if (/operator_budget_exhausted/.test(text)) return {message:'API費用の上限に達したか、予約上限を確保できません。管理者が使用額を確認するまで生成を停止します。'};
  if (/cloud_registration_capacity_reached/.test(text)) return {message:'今回の新規受付枠に達しました。既存のアカウントは引き続きログインできます。無料Coreはローカルで利用できます。'};
  if (/provider_consent_renewal_required/.test(text)) return {message:'接続先の説明が更新されました。再ログインして、データ送信先への同意を確認してください。'};
  if (/opencode_go_hosting_permission_required|opencode_go_cost_attribution_not_accepted|openrouter_not_accepted|openrouter_migration_not_accepted|inference_awaiting_acceptance|safety_not_configured/.test(text)) return {message:'クラウドの生成は準備中です。現在のデータは閲覧・削除・エクスポートできます。'};
  if (/provider_usage_unavailable/.test(text)) return {message:'生成料金を確認できなかったため、保存せず終了しました。K-Creditsの消費は0です。'};
  if (/cloud_sfw_only/.test(text)) return {message:'クラウドではSFWの内容のみ保存・生成できます。送信内容を確認してください。'};
  if (/allow_nsfw|NSFW execution/i.test(text)) {
    return { message: "成人向けの会話は、プロフィールで成人向けコンテンツを有効にすると楽しめます。", action: { label: "設定をひらく", to: "/profile#adult" } };
  }
  const notLoaded = text.match(/model_not_loaded \[(?:le:)?(le\/[^\]\s]+)\]/);
  if (notLoaded) {
    return {
      message: `「${notLoaded[1]}」はまだ読み込まれていません。ロードすると会話できます。`,
      command: { label: "ロードする", input: `/le load ${notLoaded[1]}` }
    };
  }
  if (/le_unavailable|LE unavailable|LE token not found/i.test(text)) {
    return { message: "ローカルエンジン（LE）に接続できませんでした。LE が起動しているか確認してね。", action: { label: "接続を診断", to: "/status" } };
  }
  if (/ConnectError|ConnectTimeout|Connection refused|ECONNREFUSED|All connection attempts failed|provider.*(offline|unavailable)/i.test(text)) {
    return { message: "AIにつながりませんでした。会話エンジンの接続を確認してね。", action: { label: "接続を確認", to: "/studio" } };
  }
  if (/HTTPStatusError|model .*not found|Generation failed/i.test(text)) {
    return { message: "AIがうまく応答できませんでした。別の会話エンジンを選ぶと解決することがあります。", action: { label: "エンジンを選ぶ", to: "/studio" } };
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return { message: "サーバーに接続できませんでした。ネットワークやアプリの起動状態を確認して、もう一度試してね。" };
  }
  if (/timed? ?out|Timeout/i.test(text)) {
    return { message: "応答に時間がかかりすぎたみたい。少し待ってから、もう一度送ってみてね。" };
  }
  if (/cloud_unavailable|HTTP 5\d\d|Internal Server Error/i.test(text)) {
    return { message: "サーバーでエラーが起きました。少し待ってから、もう一度試してね。" };
  }
  if (/HTTP 404|not found/i.test(text)) {
    return { message: "見つかりませんでした。削除されたか、URLが変わった可能性があります。" };
  }
  return { message: text || "うまくいきませんでした。もう一度試してね。" };
}

export function friendlyMessage(raw: unknown): string {
  return friendlyError(raw).message;
}
