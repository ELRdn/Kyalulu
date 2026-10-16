import { activeRemote } from './remoteStore';
import { cloudEpoch, isCloud } from './cloudMode';
/** Direct same-origin or explicitly selected encrypted Relay. Never auto-fallback. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith('/api/')) throw new Error('Runtime API以外には接続できません。');
  if (activeRemote()) {
    const { remoteConnection } = await import('./remoteClient');
    return remoteConnection().fetch(input, init);
  }
  // RuntimeGate owns status ordering; it must be able to discover the next owner.
  const epoch = isCloud() && input !== '/api/mobile/status' ? cloudEpoch() : null;
  const response = await globalThis.fetch(input, {
    ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  });
  // A delayed response (including 401) must never affect the next account.
  if (epoch !== null && cloudEpoch() !== epoch) throw new Error('アカウントが切り替わりました。');
  if (epoch !== null) {
    const json = response.json.bind(response);
    response.json = async () => {
      const value = await json();
      if (cloudEpoch() !== epoch) throw new Error('アカウントが切り替わりました。');
      return value;
    };
  }
  if (response.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('kyalulu-auth-required'));
  }
  return response;
}

export function serverAddress(value: string): string {
  const url = new URL(value.trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('スマホから接続するサーバーにはHTTPSのアドレスを指定してください。');
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('認証情報やパスを含まないアドレスを指定してください（例：https://my-pc.example.ts.net）。');
  }
  return url.origin;
}
