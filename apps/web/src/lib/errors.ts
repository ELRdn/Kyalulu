export type FriendlyError = { message: string; action?: { label: string; to: string } };

/** API・ネットワーク由来の生エラーを、利用者が次に取れる行動つきの日本語に言い換える。 */
export function friendlyError(raw: unknown): FriendlyError {
  const text = String(raw ?? "").replace(/^(Type)?Error:\s*/, "").trim();
  if (/allow_nsfw|NSFW execution/i.test(text)) {
    return { message: "成人向けの会話は、プロフィールで成人向けコンテンツを有効にすると楽しめます。", action: { label: "設定をひらく", to: "/profile#adult" } };
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
  if (/HTTP 5\d\d|Internal Server Error/i.test(text)) {
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
