import { useEffect, useState, type ReactNode } from 'react';
import { activeRemote, deleteRemote, remoteDevices, restoreRemote, selectRemote, type RemoteDevice } from '../lib/remoteStore';
import { type PairingLink } from '../lib/remotePairing';
import Button from './ui/Button';
import { executionTarget, useLanguage } from '../lib/appContext';
import { friendlyMessage } from '../lib/errors';

export function RemoteConnections() {
  const language=useLanguage(),en=language==='en';
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [destination, setDestination] = useState<RemoteDevice | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void remoteDevices().then(setDevices).catch(() => setError('登録した接続先を読み込めません。')); }, []);
  return <section className="k-connection" aria-label={en?'Remote destinations':'Remoteの接続先'}><h2>{en?'Registered PCs':'登録したPC'}</h2>
    <p>{en?'Conversations, characters and memories are stored on each PC.':'会話・キャラ・記憶は、それぞれのPCに保存されています。'}</p>
    {!devices.length && <p>{en?'Open device registration on your PC and scan its QR code.':'PCで「スマホを登録する」を開き、QRを読み取ってください。'}</p>}
    <ul className="k-connection__servers">{devices.map(d => <li key={d.id}><div><strong>{d.hostName || (en?'Registered PC':'登録したPC')}</strong><small>{d.hostId.slice(0, 8)} · {d.name} · {d.relay}</small></div>
      <Button onClick={() => setDestination(d)}>{en?'Connect':'接続する'}</Button>
      <Button variant="ghost" onClick={async () => { try { await deleteRemote(d.id); if (activeRemote()?.id === d.id) selectRemote(null); else setDevices(await remoteDevices()); } catch (error) { setError(String(error)); } }}>{en?'Remove key from this device':'端末内の鍵を削除'}</Button>
    </li>)}</ul>
    <p>{en?'Removing a key requires registering again. Revoke access on the PC through its Remote settings.':'鍵を削除すると再登録が必要です。PC側の登録解除は、PCのRemote設定から行えます。'}</p>
    {destination && <div className="k-connection__confirm" role="group" aria-label={en?'Confirm PC destination':'PCの接続先を確認'}><strong>{en?'Open conversations on this PC':'このPCの会話を開きます'}</strong><p>{en?'The current conversation does not move automatically. Unsent drafts are saved separately for each destination. Stop generation and confirm its saved result before switching.':'現在の会話は自動で移りません。未送信の下書きは接続先ごとに保存されます。生成を停止して保存結果を確認してから切り替えてください。'}</p>
      <Button onClick={() => { try { selectRemote(destination); } catch (error) { setError(String(error)); } }}>{en?'Switch':'切り替える'}</Button><Button variant="ghost" onClick={() => setDestination(null)}>{en?'Cancel':'キャンセル'}</Button></div>}
    {error && <p role="alert">{friendlyMessage(error,language)}</p>}
  </section>;
}

export default function RemoteSetup({ entry, children }: { entry: { invitation?: PairingLink; error?: string }; children: ReactNode }) {
  const language=useLanguage(),en=language==='en';
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
  if (!loaded) return <main className="k-connect-screen" aria-busy="true"><p>{en?'Checking the destination…':'接続先を確認しています…'}</p></main>;
  if (!pairing && (!error || executionTarget() !== 'pc') && (executionTarget() !== 'pc' || !managed || activeRemote())) return <>{children}</>;
  return <main className="k-connect-screen"><div className="k-connect-screen__body">
    <div className="k-connect-screen__brand">Kyalulu ✦</div><h1>{en?'Connect to your PC.':'いつものPCと、つながる。'}</h1>
    <p>{en?'Conversations are saved on the PC. Only this device and the PC decrypt the connection.':'会話はPCに保存。通信は、この端末とPCだけで復号します。'}</p>
    {pairing && !paired && <form className="k-connection__form" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setError('');
      try { const { enrollRemote } = await import('../lib/remoteClient'); setPaired(await enrollRemote(pairing, name.trim(), setCode)); }
      catch (e) { setError(e instanceof Error ? e.message : '登録に失敗しました。'); }
      finally { setBusy(false); }
    }}><label>{en?'This device’s name':'この端末の名前'}<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required disabled={busy} /></label>
      <Button disabled={busy || !name.trim()} type="submit">{busy ? (en?'Waiting for PC approval…':'PCの承認を待っています…') : (en?'Register with this PC':'このPCに登録する')}</Button>
      {code && <div role="status"><p>{en?'Enter this confirmation code on the PC.':'PC側に、この確認コードを入力してください。'}</p><strong style={{ fontSize: '2rem', letterSpacing: '.2em' }}>{code}</strong></div>}
    </form>}
    {paired && <section className="k-connection"><h2>{en?'Registered successfully':'登録できました'}</h2><Button onClick={() => { try { selectRemote(paired); } catch (error) { setError(String(error)); } }}>{en?'Open conversations':'会話を開く'}</Button></section>}
    {error && <p role="alert">{friendlyMessage(error,language)}</p>}
    {!busy && <RemoteConnections />}
  </div></main>;
}

export function RemoteBanner() {
  const en=useLanguage()==='en';
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const update = (event: Event) => setConnected((event as CustomEvent).detail.connected === true);
    window.addEventListener('kyalulu-remote-status', update);
    return () => window.removeEventListener('kyalulu-remote-status', update);
  }, []);
  if (!activeRemote() || executionTarget() !== 'pc') return null;
  return <div className="k-remote-banner" role="status"><a href="#/profile">{activeRemote()?.hostName || (en?'Home PC':'自宅PC')} · {connected ? (en?'Encrypted connection':'暗号化接続中') : (en?'Unable to connect':'接続できません')}</a><span>{en?'Conversations saved on PC':'会話はPCに保存'}</span></div>;
}
