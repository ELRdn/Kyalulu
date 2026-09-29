import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/transport';
import Button from './ui/Button';

type HostStatus = { installed: boolean; connected: boolean; runtime?: boolean; le?: { status?: string };
  pending?: { device_id: string; name: string; code: string }[];
  devices?: { device_id: string; name: string }[] };
export default function RemoteHostSettings() {
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [pairing, setPairing] = useState<{ url: string; qr: string; expires: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<Record<string, string>>({});
  async function refresh(signal?: AbortSignal) {
    const response = await apiFetch('/api/remote/status', { signal });
    if (!response.ok) throw new Error('Remote Hostの状態を取得できません。');
    setStatus(await response.json());
  }
  useEffect(() => {
    const abort = new AbortController();
    const load = () => { if (document.visibilityState !== 'hidden') void refresh(abort.signal).catch(() => {}); };
    load(); const timer = setInterval(load, 5000);
    return () => { abort.abort(); clearInterval(timer); };
  }, []);
  const action = async (path: string, method = 'POST', body?: unknown) => {
    setBusy(true); setError('');
    try {
      const response = await apiFetch(`/api/remote/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('操作を完了できません。接続状態と確認コードを確認してください。');
      const value = await response.json();
      if (path === 'pair') setPairing(value);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : '操作に失敗しました。'); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(0, pairing.expires * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  return <section className="k-connection" aria-label="Remote Host">
    <h2>このPCから、会話を持ち歩く</h2>
    {!status?.installed ? <p>Remote Hostをセットアップすると、スマホからこのPCに接続できます。起動手順は同梱のRemoteガイドを確認してください。</p> : <>
      <p role="status">{status.connected ? '中継に接続中' : '中継に接続できません'} · Runtime {status.runtime ? '稼働中' : '停止中'} · LE {status.le?.status || '未確認'}</p>
      <p>会話はこのPCに保存されます。画面を閉じてもHostは動作しますが、PCのスリープ中は利用できません。</p>
      <Button disabled={busy || !status.connected} onClick={() => void action('pair')}>スマホを登録する</Button>
      {pairing && <div><p>スマホのカメラで読み取ってください。このQRは5分で失効します。第三者に共有しないでください。</p>
        <img src={pairing.qr} alt="スマホ登録用QRコード" width={240} height={240} style={{ maxWidth: '100%', height: 'auto' }} />
        <details><summary>登録リンクを表示</summary><p style={{ overflowWrap: 'anywhere' }}>{pairing.url}</p></details>
        <Button variant="ghost" onClick={() => setPairing(null)}>QRを隠す</Button></div>}
      {status.pending?.map(p => <div key={p.device_id}><strong>{p.name}</strong><p>スマホに表示された6桁の確認コードを入力してください。</p>
        <input aria-label={`${p.name}の確認コード`} inputMode="numeric" maxLength={6} value={codes[p.device_id] || ''} onChange={e => setCodes({ ...codes, [p.device_id]: e.target.value.replace(/\D/g, '') })} />
        <Button disabled={busy || codes[p.device_id]?.length !== 6} onClick={() => void action('approve', 'POST', { device_id: p.device_id, code: codes[p.device_id] })}>この端末を承認</Button></div>)}
      <ul>{status.devices?.map(d => <li key={d.device_id}>{d.name} <Button variant="ghost" disabled={busy} onClick={() => void action(`devices/${d.device_id}`, 'DELETE')}>登録解除</Button></li>)}</ul>
      <Button variant="secondary" disabled={busy} onClick={() => void action('stop')}>Remote接続を停止</Button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
