import { useState } from 'react';
import { serverAddress } from '../lib/transport';
import Button from './ui/Button';
import './connection.css';
import { RemoteConnections } from './RemoteSetup';
import { activeRemote } from '../lib/remoteStore';

type Server = { name: string; url: string };
const KEY = 'kyalulu-server-bookmarks-v1';
function readServers(): Server[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter((s): s is Server => typeof s?.name === 'string' && typeof s?.url === 'string').slice(0, 12) : [];
  } catch { return []; }
}

export default function ConnectionSettings() {
  const [servers, setServers] = useState(readServers);
  const [name, setName] = useState('自分のPC');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [destination, setDestination] = useState<Server | null>(null);
  const save = (next: Server[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setServers(next); setError(''); }
    catch { setError('接続先を保存できませんでした。ブラウザーの保存容量と設定を確認してください。'); }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = serverAddress(address);
      save([...servers.filter(s => s.url !== url), { name: name.trim() || '自分のサーバー', url }].slice(-12));
    } catch (e) { setError(e instanceof Error ? e.message : 'アドレスを確認してください。'); }
  };
  const choose = (server: Server) => {
    try { setDestination({ ...server, url: serverAddress(server.url) }); setError(''); }
    catch { setError('保存された接続先が無効です。削除して登録し直してください。'); }
  };
  return <>{(activeRemote() || import.meta.env.VITE_RELAY_ORIGIN) && <RemoteConnections />}<section className="k-connection" aria-labelledby="connection-title">
    <h2 id="connection-title">会話を持ち歩く</h2>
    <p>接続中：<strong>{activeRemote() ? `${activeRemote()?.hostName || '登録したPC'}（暗号化中継）` : location.protocol === 'file:' ? 'このPC' : location.host}</strong></p>
    <p>キャラ・会話・記憶は接続中のサーバーに保存されます。自分のPCを使うときは、PCと会話サーバーを起動しておいてください。</p>
    <form onSubmit={add} className="k-connection__form">
      <label>接続先の名前<input value={name} maxLength={60} onChange={e => setName(e.target.value)} required /></label>
      <label>サーバーのHTTPSアドレス<input type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://my-pc.example.ts.net" value={address} onChange={e => setAddress(e.target.value)} required /></label>
      <Button type="submit" variant="secondary">接続先を保存</Button>
    </form>
    {error && <p role="alert">{error}</p>}
    <ul className="k-connection__servers">{servers.map(server => <li key={server.url}>
      <div><strong>{server.name}</strong><small>{server.url}</small></div>
      <Button type="button" variant="secondary" onClick={() => choose(server)}>開く</Button>
      <Button type="button" variant="ghost" aria-label={`${server.name}を接続先から削除`} onClick={() => save(servers.filter(s => s.url !== server.url))}>削除</Button>
    </li>)}</ul>
    {destination && <div className="k-connection__confirm" role="group" aria-label="接続先の確認">
      <strong>{destination.name}を開きます</strong><p>{destination.url}</p>
      <p>この端末の登録が必要な場合があります。会話や記憶は自動で移りません。生成中の場合は、今の会話で結果を確認してから切り替えてください。</p>
      <a className="k-btn k-btn--primary k-btn--md" href={`${destination.url}/#/chats`} referrerPolicy="no-referrer">このサーバーに切り替える</a>
      <Button type="button" variant="ghost" onClick={() => setDestination(null)}>キャンセル</Button>
    </div>}
    <p className="k-connection__note">自分のクラウドサーバーにも接続できます。Kyaluluのクラウド運営サービスとサーバー間の自動同期は未提供です。</p>
  </section></>;
}
