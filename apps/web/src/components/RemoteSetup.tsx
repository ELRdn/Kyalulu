import { useEffect, useState, type ReactNode } from 'react';
import { activeRemote, deleteRemote, remoteDevices, restoreRemote, selectRemote, type RemoteDevice } from '../lib/remoteStore';
import { type PairingLink } from '../lib/remotePairing';
import Button from './ui/Button';

export function RemoteConnections() {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [destination, setDestination] = useState<RemoteDevice | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void remoteDevices().then(setDevices).catch(() => setError('登録した接続先を読み込めません。')); }, []);
  return <section className="k-connection" aria-label="Remoteの接続先"><h2>登録したPC</h2>
    <p>会話・キャラ・記憶は、それぞれのPCに保存されています。</p>
    {!devices.length && <p>PCで「スマホを登録する」を開き、QRを読み取ってください。</p>}
    <ul className="k-connection__servers">{devices.map(d => <li key={d.id}><div><strong>{d.hostName || '登録したPC'}</strong><small>{d.hostId.slice(0, 8)} · {d.name} · {d.relay}</small></div>
      <Button onClick={() => setDestination(d)}>接続する</Button>
      <Button variant="ghost" onClick={async () => { try { await deleteRemote(d.id); if (activeRemote()?.id === d.id) selectRemote(null); else setDevices(await remoteDevices()); } catch { setError('端末鍵を削除できません。'); } }}>端末内の鍵を削除</Button>
    </li>)}</ul>
    <p>鍵を削除すると再登録が必要です。PC側の登録解除は、PCのRemote設定から行えます。</p>
    {destination && <div className="k-connection__confirm"><strong>このPCの会話を開きます</strong><p>現在の会話は自動で移りません。未送信の下書きは接続先ごとに保存されます。</p>
      <Button onClick={() => selectRemote(destination)}>切り替える</Button><Button variant="ghost" onClick={() => setDestination(null)}>キャンセル</Button></div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function RemoteSetup({ entry, children }: { entry: { invitation?: PairingLink; error?: string }; children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(entry.error || '');
  const [name, setName] = useState('Android');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [paired, setPaired] = useState<RemoteDevice | null>(null);
  useEffect(() => {
    let alive = true;
    void restoreRemote().catch(e => { if (alive) setError(String(e)); }).finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);
  const pairing = entry.invitation;
  const managed = !!import.meta.env.VITE_RELAY_ORIGIN;
  if (!loaded) return <main className="k-connect-screen" aria-busy="true"><p>接続先を確認しています…</p></main>;
  if (!pairing && !error && (!managed || activeRemote())) return <>{children}</>;
  return <main className="k-connect-screen"><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div><h1>いつものPCと、つながる。</h1>
    <p>会話はPCに保存。通信は、この端末とPCだけで復号します。</p>
    {pairing && !paired && <form className="k-connection__form" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('');
      try { const { enrollRemote } = await import('../lib/remoteClient'); setPaired(await enrollRemote(pairing, name.trim(), setCode)); }
      catch (e) { setError(e instanceof Error ? e.message : '登録に失敗しました。'); }
      finally { setBusy(false); }
    }}><label>このスマホの名前<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required disabled={busy} /></label>
      <Button disabled={busy || !name.trim()} type="submit">{busy ? 'PCの承認を待っています…' : 'このPCに登録する'}</Button>
      {code && <div role="status"><p>PC側に、この確認コードを入力してください。</p><strong style={{ fontSize: '2rem', letterSpacing: '.2em' }}>{code}</strong></div>}
    </form>}
    {paired && <section className="k-connection"><h2>登録できました</h2><Button onClick={() => selectRemote(paired)}>会話を開く</Button></section>}
    {error && <p role="alert">{error}</p>}
    {!busy && <RemoteConnections />}
  </div></main>;
}

export function RemoteBanner() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setConnected((event as CustomEvent).detail.connected === true);
    window.addEventListener('kyalulu-remote-status', update);
    return () => window.removeEventListener('kyalulu-remote-status', update);
  }, []);
  if (!activeRemote()) return null;
  return <div className="k-remote-banner" role="status"><a href="#/profile">{activeRemote()?.hostName || '自宅PC'} · {connected ? '暗号化接続中' : '接続できません'}</a><span>会話はPCに保存</span></div>;
}
