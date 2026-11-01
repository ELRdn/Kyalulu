import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/transport';
import { useLanguage } from '../lib/appContext';
import Button from './ui/Button';

type HostStatus = { installed: boolean; connected: boolean; runtime?: boolean; le?: { status?: string };
  pending?: { device_id: string; name: string; code: string }[];
  devices?: { device_id: string; name: string; management?: boolean }[] };
export default function RemoteHostSettings() {
  const en = useLanguage() === 'en';
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [pairing, setPairing] = useState<{ url: string; qr: string; expires: number } | null>(null);
  const [error, setError] = useState<'status' | 'action' | 'timeout' | 'network' | 'unknown' | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  async function refresh(signal?: AbortSignal) {
    const response = await apiFetch('/api/remote/status', { signal });
    if (!response.ok) throw new Error('remote_host_status_failed');
    setStatus(await response.json());
  }
  useEffect(() => {
    const abort = new AbortController();
    const load = () => { if (document.visibilityState !== 'hidden') void refresh(abort.signal).catch(() => {}); };
    load(); const timer = setInterval(load, 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, []);
  const action = async (path: string, method = 'POST', body?: unknown) => {
    setBusy(true); setError(null);
    try {
      const response = await apiFetch(`/api/remote/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('remote_host_action_failed');
      const value = await response.json();
      if (path === 'pair') setPairing(value);
      await refresh();
    } catch (e) {
      setError(e instanceof Error
        ? e.name === 'TimeoutError' ? 'timeout' : e instanceof TypeError ? 'network'
          : e.message === 'remote_host_status_failed' ? 'status' : e.message === 'remote_host_action_failed' ? 'action' : 'unknown'
        : 'unknown');
    }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(0, pairing.expires * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  return <section className="k-connection" aria-label="Remote Host">
    <h2>{en ? 'Take your conversations with you from this PC' : 'このPCから、会話を持ち歩く'}</h2>
    {!status?.installed ? <p>{en ? 'Set up Remote Host to connect to this PC from your phone. See the included Remote guide for startup instructions.' : 'Remote Hostをセットアップすると、スマホからこのPCに接続できます。起動手順は同梱のRemoteガイドを確認してください。'}</p> : <>
      <p role="status">{status.connected ? (en ? 'Connected to relay' : '中継に接続中') : (en ? 'Cannot connect to relay' : '中継に接続できません')} · Runtime {status.runtime ? (en ? 'Running' : '稼働中') : (en ? 'Stopped' : '停止中')} · LE {status.le?.status === 'ok' ? (en ? 'Connected' : '接続中') : status.le?.status === 'offline' ? (en ? 'Offline' : 'オフライン') : status.le?.status === 'unauthorized' ? (en ? 'Authentication failed' : '認証失敗') : (en ? 'Not verified' : '未確認')}</p>
      <p>{en ? 'Conversations are saved on this PC. Host keeps running when you close this screen, but is unavailable while the PC is asleep.' : '会話はこのPCに保存されます。画面を閉じてもHostは動作しますが、PCのスリープ中は利用できません。'}</p>
      <Button disabled={busy || !status.connected} onClick={() => void action('pair')}>{en ? 'Register a phone' : 'スマホを登録する'}</Button>
      {pairing && <div><p>{en ? 'Scan with your phone camera. This QR code expires in 5 minutes. Do not share it with anyone else.' : 'スマホのカメラで読み取ってください。このQRは5分で失効します。第三者に共有しないでください。'}</p>
        <img src={pairing.qr} alt={en ? 'Phone registration QR code' : 'スマホ登録用QRコード'} width={240} height={240} style={{ maxWidth: '100%', height: 'auto' }} />
        <details><summary>{en ? 'Show registration link' : '登録リンクを表示'}</summary><p style={{ overflowWrap: 'anywhere' }}>{pairing.url}</p></details>
        <Button variant="ghost" onClick={() => setPairing(null)}>{en ? 'Hide QR code' : 'QRを隠す'}</Button></div>}
      {status.pending?.map(p => <div key={p.device_id}><strong>{p.name}</strong><p>{en ? 'Enter the 6-digit confirmation code shown on your phone.' : 'スマホに表示された6桁の確認コードを入力してください。'}</p>
        <input aria-label={en ? `Confirmation code for ${p.name}` : `${p.name}の確認コード`} inputMode="numeric" maxLength={6} value={codes[p.device_id] || ''} onChange={e => setCodes({ ...codes, [p.device_id]: e.target.value.replace(/\D/g, '') })} />
        <Button disabled={busy || codes[p.device_id]?.length !== 6} onClick={() => void action('approve', 'POST', { device_id: p.device_id, code: codes[p.device_id] })}>{en ? 'Approve this device' : 'この端末を承認'}</Button></div>)}
      <ul>{status.devices?.map(d => <li key={d.device_id}>{d.name}
        <label><input type="checkbox" checked={d.management===true} disabled={busy} onChange={e=>void action(`devices/${d.device_id}/management`,'PUT',{enabled:e.target.checked})}/>{en ? 'Allow model management, diagnostics and experiments' : 'モデル管理・診断・実験を許可'}</label>
        <Button variant="ghost" disabled={busy} onClick={() => void action(`devices/${d.device_id}`, 'DELETE')}>{en ? 'Revoke registration' : '登録解除'}</Button></li>)}</ul>
      <Button variant="secondary" disabled={busy} onClick={() => void action('stop')}>{en ? 'Stop Remote connection' : 'Remote接続を停止'}</Button>
    </>}
    {error && <p role="alert">{error === 'status' ? (en ? 'Could not retrieve Remote Host status.' : 'Remote Hostの状態を取得できません。') : error === 'timeout' ? (en ? 'The request timed out. Its result is unverified; check the PC before retrying.' : '要求がタイムアウトしました。結果は未確認です。再試行の前にPC側を確認してください。') : error === 'network' ? (en ? 'The connection failed. The result is unverified; check the PC and connection before retrying.' : '通信に失敗しました。結果は未確認です。再試行の前にPC側と接続を確認してください。') : error === 'action' ? (en ? 'Could not complete the action. Check the connection and confirmation code.' : '操作を完了できません。接続状態と確認コードを確認してください。') : (en ? 'The action failed.' : '操作に失敗しました。')}</p>}
  </section>;
}
