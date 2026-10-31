import { activeRemote } from './remoteStore';
import { cloudEpoch, cloudOwner, isCloud } from './cloudMode';
import { executionTarget } from './appContext';
/** Direct same-origin or explicitly selected encrypted Relay. Never auto-fallback. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith('/api/')) throw new Error('Runtime API以外には接続できません。');
  const pathname = input.split(/[?#]/, 1)[0];
  if (['/api/local/app-sync', '/api/local/cloud'].some(path => pathname === path || pathname.startsWith(path + '/')) && executionTarget() !== 'local') {
    throw new Error('この設定は対象のPC上で開いてください。');
  }
  if (input.startsWith('/api/cloud/') || input.startsWith('/api/community/')) return cloudFetch(input, init);
  if (executionTarget() === 'device') {
    const { deviceFetch } = await import('./deviceApi');
    return deviceFetch(input, init);
  }
  if (executionTarget() === 'pc') {
    if (!activeRemote()) throw new Error('接続先を選んでください。');
    const { remoteConnection } = await import('./remoteClient');
    return remoteConnection().fetch(input, init);
  }
  return cloudFetch(input, init);
}

export async function cloudFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith('/api/')) throw Error('Invalid API path');
  // RuntimeGate owns status ordering; it must be able to discover the next owner.
  const epoch = isCloud() && input !== '/api/mobile/status' ? cloudEpoch() : null;
  const headers=new Headers(init.headers);
  if(epoch!==null&&cloudOwner()&&!headers.has('X-Kyalulu-Owner'))headers.set('X-Kyalulu-Owner',cloudOwner());
  const response = await globalThis.fetch(input, {
    ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
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
  if (response.status === 401 && typeof window !== 'undefined' && (executionTarget()==='cloud'||!input.startsWith('/api/cloud/'))) {
    window.dispatchEvent(new Event('kyalulu-auth-required'));
  }
  if (response.status === 402 && typeof window !== 'undefined') window.dispatchEvent(new Event('kyalulu-insufficient-credits'));
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
