import { apiFetch } from './transport';
import { friendlyMessage } from './errors';
import { cloudEpoch, isCloud } from './cloudMode';
export {isCloud,setCloud,setCloudOwner,cloudOwner} from './cloudMode';
export async function cloudJson(path: string, init: RequestInit = {}) {
  const epoch = isCloud() ? cloudEpoch() : null;
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const timeout = !init.method || init.method.toUpperCase() === 'GET' ? AbortSignal.timeout(30000) : null;
  const signal = timeout ? init.signal ? AbortSignal.any([init.signal, timeout]) : timeout : init.signal;
  const response = await apiFetch('/api/cloud/'+path, { ...init, headers,
    signal });
  const result = response.status === 204 ? {} : response.ok ? await response.json() : await response.json().catch(() => null);
  if (epoch !== null && cloudEpoch() !== epoch) throw Error('アカウントが切り替わりました。');
  if (!response.ok) throw Error(friendlyMessage(result?.error || result?.detail || `HTTP ${response.status}`));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('サーバーの応答を確認できません。再試行してください。');
  return result;
}
