export type FriendlyError = {
  message: string;
  action?: { label: string; to: string };
  /** チャット欄でそのまま実行できるスラッシュコマンド。 */
  command?: { label: string; input: string };
};

/** API・ネットワーク由来の生エラーを、利用者が次に取れる行動つきの日本語に言い換える。 */
export function friendlyError(raw: unknown): FriendlyError {
  const text = String(raw ?? "").replace(/^(Type)?Error:\s*/, "").trim();
  const status = typeof raw === 'object' && raw !== null && 'status' in raw ? raw.status : undefined;
  if (/history.*revision|summary.*revision|context_conflict|summary_conflict/i.test(text)) return { message: '会話または要約が別の操作で更新されました。再読込して内容を確認してから、もう一度操作してください。' };
  if (/community_awaiting_acceptance/.test(text)) return { message: 'この接続先の公開作品・交流は未提供です。' };
  if (/transfer_source_changed_restart_download/.test(text)) return { message: '会話データが更新・削除されたため、以前の転送を停止しました。転送を取り消し、最新のデータでやり直してください。' };
  if (/generation_context_changed/.test(text)) return { message: '生成の準備中に会話データが削除されました。再読込して、新しい見積りを確認してから送信してください。K-Creditsの消費は0です。' };
  if (/login_cancelled/.test(text)) return {message:'ログインをキャンセルしました。もう一度Googleまたはメールでログインできます。'};
  if (/authentication_not_configured|legal_publication_pending/.test(text)) return {message:'この環境のログインは準備中です。'};
  if (/profile_conflict/.test(text)) return {message:'別の端末で変更されました。最新の内容を読み込みました。変更内容を確認して、もう一度保存してください。'};
  if (/invalid_display_name/.test(text)) return {message:'表示名は1〜80文字で、改行を含めずに入力してください。'};
  if (/profile_item_limit/.test(text)) return {message:'保存できる項目の上限に達しました。不要な項目を解除してください。'};
  if (/account_not_allowed/.test(text)) return {message:'テストに招待したアカウントでログインしてください。'};
  if (/cloud_residence_country_required/.test(text)) return {message:'居住国を選択してください。このベータの提供地域は日本と米国です。'};
  if (/terms_consent_required/.test(text)) return {message:'利用条件を含む規約・プライバシーポリシーとデータ送信先を確認し、同意してください。'};
  if (/authentication_flow_expired/.test(text)) return {message:'ログインのリンクが失効しました。同じブラウザでログインをやり直してください。'};
  if (/authentication_failed|authentication_unavailable|verified_email_required/.test(text)) return {message:'ログインを確認できませんでした。確認済みのGoogleアカウントまたはメールでやり直してください。'};
  if (/insufficient_credits/.test(text)) return {message:'会話の入力料金をまかなうK-Creditsが足りません。残高を確認するか、会話の入力を短くしてください。'};
  if (/operator_budget_exhausted/.test(text)) return {message:'運営側のAPI予算が上限に達したか、料金情報に問題があるため生成を停止しています。K-Credits残高があっても送信できない場合があります。'};
  if (/cloud_registration_capacity_reached/.test(text)) return {message:'今回の新規受付枠に達しました。既存のアカウントは引き続きログインできます。無料Coreはローカルで利用できます。'};
  if (/provider_consent_renewal_required/.test(text)) return {message:'接続先の説明が更新されました。再ログインして、データ送信先への同意を確認してください。'};
  if (/provider_retention_approval_required/.test(text)) return {message:'提供元による入力保存への承認が必要です。確認が終わるまで、この経路には送信できません。'};
  if (/provider_endpoint_unavailable/.test(text)) return {message:'この提供元の接続先は現在利用できません。'};
  if (/provider_privacy_unverified/.test(text)) return {message:'提供元の保存・学習利用条件を確認中です。確認が終わるまで送信できません。'};
  if (/provider_terms_unverified/.test(text)) return {message:'提供元の学習利用・国外移転などの利用条件を確認できていません。確認が終わるまで送信できません。'};
  if (/model_catalog_unverified/.test(text)) return {message:'公開カタログでこのモデルの提供を確認できていません。'};
  if (/cloud_route_not_available/.test(text)) return {message:'この環境ではこの会話モデルを利用できません。'};
  if (/provider_key_not_configured/.test(text)) return {message:'提供元への接続設定が準備されていません。'};
  if (/opencode_go_hosting_permission_required|opencode_go_cost_attribution_not_accepted|openrouter_not_accepted|openrouter_migration_not_accepted|inference_awaiting_acceptance|safety_not_configured/.test(text)) return {message:'クラウドの生成は準備中です。現在のデータは閲覧・削除・エクスポートできます。'};
  if (/provider_usage_unavailable/.test(text)) return {message:'生成料金を確認できなかったため、保存せず終了しました。K-Creditsの消費は0です。'};
  if (/provider_rate_limited|HTTP\s+429\b/.test(text) || status === 429) return {message:'選択した提供元の利用制限で生成できませんでした。少し時間を置いて再試行するか、別の会話モデルを選んでください。失敗した生成のK-Creditsの消費は0です。'};
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
  if (status === 401 || /HTTP 401|authentication_required/.test(text)) return { message: 'ログインの有効期限が切れたか、認証が必要です。もう一度ログインしてください。' };
  if (status === 403 || /HTTP 403/.test(text)) return { message: 'この内容を表示・操作する権限がありません。ログイン先と利用条件を確認してください。' };
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text)) return { message: 'この操作は現在利用できません。接続先の利用条件を確認してください。' };
  return { message: text || "うまくいきませんでした。もう一度試してね。" };
}

export function friendlyMessage(raw: unknown): string {
  return friendlyError(raw).message;
}
