import { createNoise, generateKeypair } from './remoteCrypto';
import { RemoteRpc, type RemoteFrame } from './remoteRpc';
import { activeRemote, saveRemote, type RemoteDevice } from './remoteStore';
import { relayOrigin, type PairingLink } from './remotePairing';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const toHex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export function fromHex(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('端末鍵が無効です。再登録してください。');
  return Uint8Array.from(value.match(/../g)!, byte => parseInt(byte, 16));
}
type Noise = Awaited<ReturnType<typeof createNoise>>;
function status(connected: boolean) { window.dispatchEvent(new CustomEvent('kyalulu-remote-status', { detail: { connected } })); }

export class RemoteConnection {
  readonly rpc = new RemoteRpc(frame => this.send(frame));
  private socket?: WebSocket;
  private noise?: Noise;
  private flight?: Promise<void>;
  private ready = false;
  private disposed = false;
  private reconnecting = false;
  private expiry?: ReturnType<typeof setTimeout>;
  private bytes = 0;
  private outgoing: Promise<void> = Promise.resolve();
  private sendAt = 0;
  constructor(readonly device: RemoteDevice, private secret: string | null = null,
    private approval?: (code: string) => void) {}

  connect(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (!this.flight) this.flight = this.open().finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async open() {
    if (this.disposed) throw new Error('接続は終了しています。');
    relayOrigin(this.device.relay);
    const prologue = encoder.encode(`kyalulu-remote-v1|${this.device.ownerId}|${this.device.hostId}|${this.device.deviceId}`);
    const noise = await createNoise({ privateKey: fromHex(this.device.privateKey), expectedPeer: fromHex(this.device.hostKey), prologue });
    if (this.disposed) { noise.close(); throw new Error('接続は終了しています。'); }
    this.noise = noise; this.bytes = 0;
    const socket = new WebSocket(`${this.device.relay.replace(/^http/, 'ws')}/v1/socket`);
    socket.binaryType = 'arraybuffer'; this.socket = socket;
    return new Promise<void>((resolve, reject) => {
      let authenticated = false, complete = false;
      let incoming = Promise.resolve();
      const timeout = setTimeout(() => { reject(new Error('PCへの接続・承認がタイムアウトしました。')); socket.close(); }, this.secret ? 300000 : 15000);
      const fail = () => { reject(new Error('PCに接続できません。起動状態と端末登録を確認してください。')); socket.close(); };
      socket.onopen = () => socket.send(JSON.stringify({ role: 'client', token: this.device.token }));
      socket.onerror = fail;
      socket.onmessage = event => {
        incoming = incoming.then(async () => {
          if (this.disposed) return;
          if (!authenticated) {
            if (typeof event.data !== 'string' || JSON.parse(event.data).type !== 'ready') throw new Error('relay_protocol');
            authenticated = true; socket.send(noise.write()); return;
          }
          if (!(event.data instanceof ArrayBuffer)) throw new Error('invalid_frame');
          const bytes = new Uint8Array(event.data);
          this.bytes += bytes.length;
          if (bytes.length > 65536 || this.bytes > 64 * 1024 * 1024) throw new Error('session_limit');
          if (!noise.finished) {
            noise.read(bytes); // The adapter verifies the QR-pinned Host before message 3.
            socket.send(noise.write(encoder.encode(JSON.stringify({ version: 1, secret: this.secret, name: this.device.name }))));
            return;
          }
          const frame = JSON.parse(decoder.decode(noise.decrypt(bytes)));
          if (frame.type === 'approval_required' && this.secret) {
            if (!/^[0-9]{6}$/.test(frame.code)) throw new Error('invalid_confirmation');
            this.approval?.(frame.code); return;
          }
          if (frame.type === 'ready') {
            if (complete || frame.version !== 1) throw new Error('protocol_version');
            complete = true; clearTimeout(timeout); this.ready = true; this.secret = null;
            this.expiry = setTimeout(() => socket.close(), 9 * 60 * 1000);
            status(true); resolve(); return;
          }
          if (!this.ready) throw new Error('approval_required');
          this.rpc.receive(frame);
        }).catch(fail);
      };
      socket.onclose = () => {
        clearTimeout(timeout); clearTimeout(this.expiry); noise.close();
        const wasReady = this.ready; this.ready = false; status(false);
        if (!complete) reject(new Error('PCへの接続を確認できません。PC側の登録解除も確認してください。'));
        if (wasReady && !this.disposed) void this.reconnect();
      };
    });
  }
  private async reconnect() {
    if (this.reconnecting || this.disposed) return;
    this.reconnecting = true;
    try {
      for (const delay of [500, 1000, 2000, 4000, 8000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (this.disposed) return;
        try { await this.connect(); await this.rpc.resume(); return; } catch { /* Retry connection, never requests. */ }
      }
      this.rpc.close();
    } finally { this.reconnecting = false; }
  }
  private send(frame: RemoteFrame): Promise<void> {
    const task = this.outgoing.then(() => this.sendOrdered(frame));
    this.outgoing = task.catch(() => {});
    return task;
  }
  private async sendOrdered(frame: RemoteFrame) {
    if (!this.ready || !this.socket || !this.noise) throw new Error('PCとの接続を確認してください。');
    const socket = this.socket;
    const plaintext = encoder.encode(JSON.stringify(frame));
    const delay = this.sendAt - performance.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    this.sendAt = performance.now() + Math.max(5, (plaintext.length + 16) / (2 * 1024 * 1024) * 1000);
    const until = Date.now() + 5000;
    while (socket.bufferedAmount > 128 * 1024) {
      if (Date.now() > until || socket.readyState !== WebSocket.OPEN) throw new Error('通信が混雑しています。');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (socket !== this.socket || !this.ready || socket.readyState !== WebSocket.OPEN) throw new Error('接続が変わりました。');
    const bytes = this.noise.encrypt(plaintext);
    this.bytes += bytes.length;
    if (this.bytes > 64 * 1024 * 1024) { socket.close(); throw new Error('接続を更新しています。'); }
    socket.send(bytes);
  }
  async fetch(path: string, init?: RequestInit) { await this.connect(); return this.rpc.fetch(path, init); }
  close() { this.disposed = true; clearTimeout(this.expiry); this.socket?.close(); this.noise?.close(); this.rpc.close(); }
}

let connection: RemoteConnection | undefined;
export function remoteConnection(device = activeRemote()) {
  if (!device) throw new Error('接続先を選んでください。');
  if (!connection || connection.device.id !== device.id) { connection?.close(); connection = new RemoteConnection(device); }
  return connection;
}
export async function enrollRemote(link: PairingLink, name: string, onApproval: (code: string) => void): Promise<RemoteDevice> {
  const relay = relayOrigin(link.relay);
  if (link.expires * 1000 <= Date.now()) throw new Error('登録用QRの期限が切れました。');
  const keys = await generateKeypair();
  const response = await fetch(`${relay}/v1/pairings/${link.pairingId}/redeem`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: link.token, name }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('登録用QRを使用できません。PCで発行し直してください。');
  const result = await response.json();
  if (result.host_id !== link.hostId || result.owner_id !== link.ownerId || typeof result.device_id !== 'string' || typeof result.device_token !== 'string') throw new Error('接続先が登録用QRと一致しません。');
  const device: RemoteDevice = { id: `${relay}:${result.device_id}`, ownerId: link.ownerId, hostId: link.hostId,
    deviceId: result.device_id, relay, token: result.device_token, name, privateKey: toHex(keys.privateKey), hostKey: link.hostKey };
  try {
    const directory = await fetch(`${relay}/v1/hosts`, { headers: { Authorization: `Bearer ${device.token}` }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (directory.ok) {
      const data = await directory.json();
      const listed = Array.isArray(data.hosts) ? data.hosts.find((item: { host_id?: string }) => item.host_id === device.hostId) : undefined;
      if (typeof listed?.name === 'string') device.hostName = listed.name.slice(0, 80);
    }
  } catch { /* A display name lookup cannot authorize or prevent pinned pairing. */ }
  const pending = new RemoteConnection(device, link.secret, onApproval);
  try { await pending.connect(); await saveRemote(device); }
  finally { pending.close(); }
  return device;
}
