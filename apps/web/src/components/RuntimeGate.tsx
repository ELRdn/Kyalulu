import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiFetch } from '../lib/transport';
import ConnectionSettings from './ConnectionSettings';
import Button from './ui/Button';
import './connection.css';
import { activeRemote, connectionScope } from '../lib/remoteStore';
import CloudLogin from './CloudLogin';
import { setCloud, setCloudOwner } from '../lib/cloud';
import { refreshAccountProfile } from '../lib/accountProfile';

type Access = { remote_mode: boolean; authenticated: boolean; administrative?: boolean; device_name?: string; cloud_mode?: boolean };
const AccessContext = createContext<Access>({ remote_mode: false, authenticated: true });
export const useRuntimeAccess = () => useContext(AccessContext);
export function useAdministrative() { const access = useRuntimeAccess(); return access.administrative ?? !access.remote_mode; }

async function readResponse(response: Response) {
  if (response.status === 204) return {};
  const body = await response.json();
  const errors: Record<string, string> = {
    invalid_pair_code: '登録コードが違うか、有効期限が切れています。サーバーで新しいコードを発行してください。',
    pair_code_locked: '登録コードが無効になりました。サーバーで新しいコードを発行してください。',
    device_limit: '登録できる端末数の上限に達しました。サーバーで不要な端末を解除してください。',
    invalid_pairing_code: '登録コードが違うか、有効期限が切れています。サーバーで新しいコードを発行してください。',
    pair_invalid: '登録コードが違うか、有効期限が切れています。サーバーで新しいコードを発行してください。',
    pair_rate_limited: '試行回数が多すぎます。1分ほど待ってから再試行してください。',
    pair_locked: '登録コードが無効になりました。サーバーで新しいコードを発行してください。',
    invalid_device_name: '端末の名前を確認してください。',
    authentication_required: '端末を登録してください。',
  };
  if (!response.ok) throw new Error(errors[body.code] || (response.status === 422 ? '8桁の登録コードと端末の名前を確認してください。' : `接続を確認して再試行してください（HTTP ${response.status}）。`));
  return body;
}

export default function RuntimeGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('Android');
  const mounted = useRef(false);
  const epoch = useRef(0);
  const check = useCallback(async () => {
    const attempt = ++epoch.current;
    setBusy(true);
    try {
      const result = await readResponse(await apiFetch('/api/mobile/status', { signal: AbortSignal.timeout(10000) }));
      if (typeof result.remote_mode !== 'boolean' || typeof result.authenticated !== 'boolean') throw new Error('サーバーの応答を確認できません。Kyaluluのバージョンを確認してください。');
      if (!mounted.current || attempt!==epoch.current) return;
      if (result.cloud_mode && result.authenticated && (typeof result.owner_scope !== 'string' || !result.owner_scope.trim())) {
        setCloudOwner(''); setAccess(null);
        throw new Error('アカウントを確認できません。もう一度接続してください。');
      }
      setCloud(result.cloud_mode === true);
      setCloudOwner(result.authenticated && typeof result.owner_scope === 'string' ? result.owner_scope : '');
      if (result.cloud_mode && result.authenticated) void refreshAccountProfile();
      if (mounted.current && attempt === epoch.current) { setAccess(result); setError(''); }
    } catch {
      if (mounted.current && attempt === epoch.current) setError('サーバーに接続できません。PC・サーバーの起動とネットワークを確認してください。');
    } finally { if (mounted.current && attempt === epoch.current) setBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void check();
    const required = () => { ++epoch.current; setCloudOwner(''); setBusy(false); setAccess(previous=>({...previous, remote_mode: previous?.remote_mode ?? true, authenticated: false})); setError('認証の有効期限が切れました。もう一度ログインしてください。'); };
    const online = () => { void check(); };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    window.addEventListener('kyalulu-auth-required', required);
    window.addEventListener('online', online);
    window.addEventListener('focus', online);
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; ++epoch.current; window.removeEventListener('kyalulu-auth-required', required); window.removeEventListener('online', online); window.removeEventListener('focus', online); document.removeEventListener('visibilitychange', visible); };
  }, [check]);
  const pair = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await readResponse(await apiFetch('/api/mobile/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name: name.trim() }), signal: AbortSignal.timeout(15000) }));
      setCode(''); await check();
    } catch (error) { setError(error instanceof Error ? error.message : '端末を登録できませんでした。'); }
    finally { setBusy(false); }
  };
  if (access?.authenticated) return <AccessContext.Provider key={connectionScope()} value={access}>{children}</AccessContext.Provider>;
  if (access?.cloud_mode) return <CloudLogin />;
  return <main className="k-connect-screen"><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div>
    <h1>{access ? 'いつもの会話を、このスマホで。' : '会話のサーバーに接続'}</h1>
    <p className="k-connect-screen__intro">{access ? 'サーバーで発行した登録コードを入力して、この端末をつなぎます。' : 'キャラ・会話・記憶を保管しているサーバーを確認しています。'}</p>
    <section className="k-connection" aria-label="端末登録">
      <p>接続先：{location.host || 'このPC'}</p>
      {error && <p role="alert">{error}</p>}
      {access && <form onSubmit={pair} className="k-connection__form">
        <label>端末の名前<input value={name} maxLength={80} onChange={e => setName(e.target.value)} required autoComplete="off" /></label>
        <label>登録コード<input value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))} required minLength={8} maxLength={8} pattern="[0-9]{8}" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <Button type="submit" disabled={busy}>{busy ? '確認中…' : 'この端末を登録'}</Button>
      </form>}
      {!access && <Button type="button" onClick={() => void check()} disabled={busy}>{busy ? '接続を確認中…' : 'もう一度接続する'}</Button>}
    </section>
    {!busy && <ConnectionSettings />}
  </div></main>;
}

export function DeviceRegistration() {
  const access = useRuntimeAccess();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!access.remote_mode || activeRemote()) return null;
  const logout = async () => {
    setBusy(true);
    try {
      await readResponse(await apiFetch('/api/mobile/logout', { method: 'POST', signal: AbortSignal.timeout(10000) }));
      window.dispatchEvent(new Event('kyalulu-auth-required'));
    } catch { setError('登録を解除できませんでした。接続を確認して再試行してください。'); }
    finally { setBusy(false); }
  };
  return <section className="k-connection"><h2>この端末の登録</h2><p>{access.device_name || '登録済みの端末'}から接続しています。登録を解除すると、この端末からサーバーの会話にアクセスできなくなります。端末に保存した下書きは残ります。</p>
    <Button type="button" variant="secondary" disabled={busy} onClick={() => void logout()}>この端末の登録を解除</Button>{error && <p role="alert">{error}</p>}
  </section>;
}
