/// <reference types="vite/client" />
export type PairingLink = {
  version: 1; relay: string; ownerId: string; hostId: string;
  pairingId: string; token: string; secret: string; hostKey: string; expires: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function relayOrigin(value: string) {
  const url = new URL(value);
  const development = import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(development && url.protocol === 'http:')) || url.origin !== value || url.username || url.password) throw new Error('中継サーバーのアドレスが無効です。');
  const configured = import.meta.env.VITE_RELAY_ORIGIN;
  if (configured && configured !== url.origin) throw new Error('このアプリに対応しない中継サーバーです。');
  if (!configured && !development) throw new Error('Remote用の中継サーバーが設定されていません。');
  return url.origin;
}
export function parsePairing(encoded: string, now = Date.now()): PairingLink {
  if (encoded.length > 8192) throw new Error('登録用QRが無効です。');
  const value = JSON.parse(decodeURIComponent(encoded)) as PairingLink;
  if (value.version !== 1 || !uuid.test(value.ownerId) || !uuid.test(value.hostId) || !uuid.test(value.pairingId)
      || !/^[A-Za-z0-9_-]{40,128}$/.test(value.token) || !/^[A-Za-z0-9_-]{43}$/.test(value.secret)
      || !/^[0-9a-f]{64}$/.test(value.hostKey) || typeof value.expires !== 'number'
      || !Number.isFinite(value.expires) || value.expires * 1000 <= now || value.expires * 1000 > now + 310000) {
    throw new Error('登録用QRの期限が切れているか、内容が無効です。PCで発行し直してください。');
  }
  relayOrigin(value.relay);
  return value;
}
/** Call before mounting the router. Even malformed fragments are immediately erased. */
export function takePairing(): { invitation?: PairingLink; error?: string } {
  if (!location.hash.startsWith('#remote=')) return {};
  const encoded = location.hash.slice(8);
  history.replaceState(null, '', `${location.pathname}${location.search}#/chats`);
  try { return { invitation: parsePairing(encoded) }; }
  catch (error) { return { error: error instanceof Error ? error.message : '登録用QRが無効です。' }; }
}
