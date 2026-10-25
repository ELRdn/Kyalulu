import { preferences, type Language } from './appContext';

export type FriendlyError = {
  message: string;
  action?: { label: string; to: string };
  /** チャット欄でそのまま実行できるスラッシュコマンド。 */
  command?: { label: string; input: string };
};

const knownEnglish: Record<string, string> = {
  '未対応のブラウザー取得先です。': 'This browser download source is not supported.',
  '配布元がこの形式・利用条件での取得を許可していません。': 'The source does not allow downloads with this format or these usage terms.',
  '公開コンテンツが見つかりません。': 'Public content was not found.',
  '配布元の取得制限です。時間を置いて再試行してください。': 'The source has limited downloads. Wait before trying again.',
  'ファイルが32 MiBを超えています。': 'The file exceeds 32 MiB.',
  '取得データがありません。': 'No download data was received.',
  '下書きの保存データを読み込めません。送信を停止しています。': 'The saved draft could not be read. Sending is blocked.',
  '下書きを端末に保存できませんでした。': 'The draft could not be saved on this device.',
  '前の送信結果を確認しています。': 'The previous send result is being checked.',
  '送信IDが変わったため確認を中断しました。': 'The send ID changed, so reconciliation stopped.',
  '送信結果のIDが一致しません。': 'The send-result IDs do not match.',
  '送信結果をまだ確認できません。': 'The send result cannot be verified yet.',
  '履歴への保存結果を確認できません。': 'Saving to history could not be verified.',
  '保存された返信を履歴で確認できません。': 'The saved reply could not be verified in history.',
  '端末の送信下書きを消去できません。': 'The send draft on this device could not be erased.',
};
const erasedCleanupPrefix = 'サーバーの会話データは消去しましたが、この端末の下書き・返信履歴の消去を確認できません。';

/** API・ネットワーク由来のエラーを、表示言語と次の操作に合わせて説明する。 */
export function friendlyError(raw: unknown, language: Language = typeof window === 'undefined' ? 'ja' : preferences().language): FriendlyError {
  const en = language === 'en';
  const text = String(raw ?? "").replace(/^(Type)?Error:\s*/, "").trim();
  if (text.startsWith(erasedCleanupPrefix)) {
    const detail = text.slice(erasedCleanupPrefix.length).replace(/^(Type)?Error:\s*/, '');
    return { message: en ? 'Server conversation data was erased, but cleanup of the draft and reply history on this device could not be verified. ' + (knownEnglish[detail] ?? detail) : text };
  }
  if (en && knownEnglish[text]) return { message: knownEnglish[text] };
  const generationCheck = text.match(/^送信結果の確認に失敗しました \(HTTP (\d{3})\)$/);
  if (generationCheck) return { message: en ? `Could not check the send result (HTTP ${generationCheck[1]}).` : text };
  const hubStatus = text.match(/^配布元のエラー（HTTP (\d{3})）$/);
  if (hubStatus) return { message: en ? `Source error (HTTP ${hubStatus[1]})` : text };
  const status = typeof raw === 'object' && raw !== null && 'status' in raw ? raw.status : undefined;
  if (/history.*revision|summary.*revision|context_conflict|summary_conflict/i.test(text)) return { message: (en ? "The conversation or summary changed in another operation. Reload and review the latest version before trying again." : '会話または要約が別の操作で更新されました。再読込して内容を確認してから、もう一度操作してください。') };
  if (/community_awaiting_acceptance/.test(text)) return { message: (en ? "Public works and community features are not available on this connection yet." : 'この接続先の公開作品・交流は未提供です。') };
  if (/transfer_source_changed_restart_download/.test(text)) return { message: (en ? "The conversation was updated or deleted, so the previous transfer stopped. Cancel that transfer and start again with the latest data." : '会話データが更新・削除されたため、以前の転送を停止しました。転送を取り消し、最新のデータでやり直してください。') };
  if (/generation_context_changed/.test(text)) return { message: (en ? "The conversation was deleted while preparing generation. Reload and review a new quote before sending. No K-Credits were charged." : '生成の準備中に会話データが削除されました。再読込して、新しい見積りを確認してから送信してください。K-Creditsの消費は0です。') };
  if (/login_cancelled/.test(text)) return {message:(en ? "Login was canceled. You can try again with Google or email." : 'ログインをキャンセルしました。もう一度Googleまたはメールでログインできます。')};
  if (/authentication_not_configured|legal_publication_pending/.test(text)) return {message:(en ? "Login is not available in this environment yet." : 'この環境のログインは準備中です。')};
  if (/profile_conflict/.test(text)) return {message:(en ? "Changes were made on another device. The latest version has been loaded. Review the changes before saving again." : '別の端末で変更されました。最新の内容を読み込みました。変更内容を確認して、もう一度保存してください。')};
  if (/invalid_display_name/.test(text)) return {message:(en ? "Enter a display name of 1–80 characters without line breaks." : '表示名は1〜80文字で、改行を含めずに入力してください。')};
  if (/profile_item_limit/.test(text)) return {message:(en ? "You have reached the saved-item limit. Remove items you no longer need." : '保存できる項目の上限に達しました。不要な項目を解除してください。')};
  if (/account_not_allowed/.test(text)) return {message:(en ? "Sign in with an account invited to this test." : 'テストに招待したアカウントでログインしてください。')};
  if (/cloud_residence_country_required/.test(text)) return {message:(en ? "Choose your country of residence. This beta is available in Japan and the United States." : '居住国を選択してください。このベータの提供地域は日本と米国です。')};
  if (/terms_consent_required/.test(text)) return {message:(en ? "Review and accept the terms, privacy policy, eligibility conditions and data destinations." : '利用条件を含む規約・プライバシーポリシーとデータ送信先を確認し、同意してください。')};
  if (/authentication_flow_expired/.test(text)) return {message:(en ? "The login link expired. Start login again in the same browser." : 'ログインのリンクが失効しました。同じブラウザでログインをやり直してください。')};
  if (/authentication_failed|authentication_unavailable|verified_email_required/.test(text)) return {message:(en ? "Login could not be verified. Try again with a verified Google account or email." : 'ログインを確認できませんでした。確認済みのGoogleアカウントまたはメールでやり直してください。')};
  if (/insufficient_credits/.test(text)) return {message:(en ? "You do not have enough K-Credits to cover the conversation input cost. Check your balance or shorten the input." : '会話の入力料金をまかなうK-Creditsが足りません。残高を確認するか、会話の入力を短くしてください。')};
  if (/operator_budget_exhausted/.test(text)) return {message:(en ? "Generation is stopped because the operator API budget is exhausted or cost information is invalid. Sending may be unavailable even with K-Credits remaining." : '運営側のAPI予算が上限に達したか、料金情報に問題があるため生成を停止しています。K-Credits残高があっても送信できない場合があります。')};
  if (/cloud_registration_capacity_reached/.test(text)) return {message:(en ? "Registration capacity has been reached. Existing accounts can still sign in. Free Core is available locally." : '今回の新規受付枠に達しました。既存のアカウントは引き続きログインできます。無料Coreはローカルで利用できます。')};
  if (/provider_consent_renewal_required/.test(text)) return {message:(en ? "The provider disclosure changed. Sign in again and review consent for data destinations." : '接続先の説明が更新されました。再ログインして、データ送信先への同意を確認してください。')};
  if (/provider_retention_approval_required/.test(text)) return {message:(en ? "Approval of provider input retention is required. This route stays closed until review is complete." : '提供元による入力保存への承認が必要です。確認が終わるまで、この経路には送信できません。')};
  if (/provider_endpoint_unavailable/.test(text)) return {message:(en ? "This provider endpoint is currently unavailable." : 'この提供元の接続先は現在利用できません。')};
  if (/provider_privacy_unverified/.test(text)) return {message:(en ? "The provider retention and training-use terms are under review. Sending stays unavailable until review is complete." : '提供元の保存・学習利用条件を確認中です。確認が終わるまで送信できません。')};
  if (/provider_terms_unverified/.test(text)) return {message:(en ? "The provider terms, including training use and international transfers, have not been verified. Sending stays unavailable until review is complete." : '提供元の学習利用・国外移転などの利用条件を確認できていません。確認が終わるまで送信できません。')};
  if (/model_catalog_unverified/.test(text)) return {message:(en ? "This model has not been verified in the public provider catalog." : '公開カタログでこのモデルの提供を確認できていません。')};
  if (/cloud_route_not_available/.test(text)) return {message:(en ? "This conversation model is unavailable in this environment." : 'この環境ではこの会話モデルを利用できません。')};
  if (/provider_key_not_configured/.test(text)) return {message:(en ? "The provider connection has not been configured." : '提供元への接続設定が準備されていません。')};
  if (/opencode_go_hosting_permission_required|opencode_go_cost_attribution_not_accepted|openrouter_not_accepted|openrouter_migration_not_accepted|inference_awaiting_acceptance|safety_not_configured/.test(text)) return {message:(en ? "Cloud generation is not available yet. You can view, delete and export existing data." : 'クラウドの生成は準備中です。現在のデータは閲覧・削除・エクスポートできます。')};
  if (/provider_usage_unavailable/.test(text)) return {message:(en ? "The generation cost could not be verified, so the result was not saved. No K-Credits were charged." : '生成料金を確認できなかったため、保存せず終了しました。K-Creditsの消費は0です。')};
  if (/provider_rate_limited|HTTP\s+429\b/.test(text) || status === 429) return {message:(en ? "The selected provider rate limit prevented generation. Wait before retrying, or choose another conversation model. Failed generation charged no K-Credits." : '選択した提供元の利用制限で生成できませんでした。少し時間を置いて再試行するか、別の会話モデルを選んでください。失敗した生成のK-Creditsの消費は0です。')};
  if (/cloud_sfw_only/.test(text)) return {message:(en ? "Cloud storage and generation currently support general-audience content only. Review what you are sending." : 'クラウドではSFWの内容のみ保存・生成できます。送信内容を確認してください。')};
  if (/allow_nsfw|NSFW execution/i.test(text)) {
    return { message: (en ? "Adult conversations require enabling adult content in your profile." : "成人向けの会話は、プロフィールで成人向けコンテンツを有効にすると楽しめます。"), action: { label: (en ? "Open settings" : "設定をひらく"), to: "/profile#adult" } };
  }
  const notLoaded = text.match(/model_not_loaded \[(?:le:)?(le\/[^\]\s]+)\]/);
  if (notLoaded) {
    return {
      message: (en ? `“${notLoaded[1]}” is not loaded yet. Load it to start a conversation.` : `「${notLoaded[1]}」はまだ読み込まれていません。ロードすると会話できます。`),
      command: { label: (en ? "Load model" : "ロードする"), input: `/le load ${notLoaded[1]}` }
    };
  }
  if (/le_unavailable|LE unavailable|LE token not found/i.test(text)) {
    return { message: (en ? "Could not connect to the local engine (LE). Check that LE is running." : "ローカルエンジン（LE）に接続できませんでした。LE が起動しているか確認してね。"), action: { label: (en ? "Diagnose connection" : "接続を診断"), to: "/status" } };
  }
  if (/ConnectError|ConnectTimeout|Connection refused|ECONNREFUSED|All connection attempts failed|provider.*(offline|unavailable)/i.test(text)) {
    return { message: (en ? "Could not connect to the AI. Check the conversation engine connection." : "AIにつながりませんでした。会話エンジンの接続を確認してね。"), action: { label: (en ? "Check connection" : "接続を確認"), to: "/studio" } };
  }
  if (/HTTPStatusError|model .*not found|Generation failed/i.test(text)) {
    return { message: (en ? "The AI could not respond. Choosing another conversation engine may help." : "AIがうまく応答できませんでした。別の会話エンジンを選ぶと解決することがあります。"), action: { label: (en ? "Choose an engine" : "エンジンを選ぶ"), to: "/studio" } };
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return { message: (en ? "Could not connect to the server. Check your network and that the app is running, then try again." : "サーバーに接続できませんでした。ネットワークやアプリの起動状態を確認して、もう一度試してね。") };
  }
  if (/timed? ?out|Timeout/i.test(text)) {
    return { message: (en ? "The response timed out. Wait a little before sending again." : "応答に時間がかかりすぎたみたい。少し待ってから、もう一度送ってみてね。") };
  }
  if (/cloud_unavailable|HTTP 5\d\d|Internal Server Error/i.test(text)) {
    return { message: (en ? "A server error occurred. Wait a little before trying again." : "サーバーでエラーが起きました。少し待ってから、もう一度試してね。") };
  }
  if (/HTTP 404|not found/i.test(text)) {
    return { message: (en ? "This could not be found. It may have been deleted or moved to another URL." : "見つかりませんでした。削除されたか、URLが変わった可能性があります。") };
  }
  if (status === 401 || /HTTP 401|authentication_required/.test(text)) return { message: (en ? "Your login expired or authentication is required. Sign in again." : 'ログインの有効期限が切れたか、認証が必要です。もう一度ログインしてください。') };
  if (status === 403 || /HTTP 403/.test(text)) return { message: (en ? "You do not have permission to view or change this content. Check the account and eligibility conditions." : 'この内容を表示・操作する権限がありません。ログイン先と利用条件を確認してください。') };
  if (/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(text)) return { message: (en ? "This action is currently unavailable. Check the eligibility conditions for this connection." : 'この操作は現在利用できません。接続先の利用条件を確認してください。') };
  return { message: text || (en ? "The action could not be completed. Please try again." : "うまくいきませんでした。もう一度試してね。") };
}

export function friendlyMessage(raw: unknown, language?: Language): string {
  return friendlyError(raw, language).message;
}
