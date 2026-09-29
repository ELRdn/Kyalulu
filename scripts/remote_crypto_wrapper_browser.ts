// Browser entry for the isolated acceptance build, using the real product module.
import { createNoise, generateKeypair, type NoiseSession } from '../apps/web/src/lib/remoteCrypto';
const sessions = new Map<number, NoiseSession>();
const identities = new Map<number, Awaited<ReturnType<typeof generateKeypair>>>();
let nextId = 0;
function encode64(data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += 8192) text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
function decode64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}
const api = {
  async identity() {
    const identity = await generateKeypair();
    const id = ++nextId;
    identities.set(id, identity);
    return { id, publicKey: Array.from(identity.publicKey) };
  },
  async create({ identity, expectedPeer, prologue }: { identity: number; expectedPeer: number[]; prologue: number[] }) {
    const keys = identities.get(identity)!;
    const id = ++nextId;
    const s = await createNoise({ privateKey: keys.privateKey, expectedPeer: Uint8Array.from(expectedPeer),
      prologue: Uint8Array.from(prologue) });
    sessions.set(id, s);
    return id;
  },
  call({ id, method, data = [] }: { id: number; method: string; data: number[] }) {
    const s = sessions.get(id)!;
    try {
      let result = new Uint8Array(0) as Uint8Array;
      const input = Uint8Array.from(data);
      if (method === 'write') result = s.write(input);
      else if (method === 'read') result = s.read(input);
      else if (method === 'encrypt') result = s.encrypt(input);
      else if (method === 'decrypt') result = s.decrypt(input);
      else if (method === 'close') s.close();
      else if (method !== 'status') throw new Error('unknown method');
      return { ok: true, data: Array.from(result), finished: s.finished,
        peerKey: Array.from(s.peerKey), hash: Array.from(s.handshakeHash) };
    } catch (error) {
      return { ok: false, error: String(error), finished: s.finished,
        peerKey: Array.from(s.peerKey), hash: Array.from(s.handshakeHash) };
    }
  },
  encryptBatch({ id, count, first }: { id: number; count: number; first: number }) {
    const s = sessions.get(id)!;
    const output: string[] = [];
    for (let index = 0; index < count; index++) {
      const payload = new Uint8Array(65519).fill((first + index) % 251);
      output.push(encode64(s.encrypt(payload)));
    }
    return output;
  },
  decryptBatch({ id, messages, first }: { id: number; messages: string[]; first: number }) {
    const s = sessions.get(id)!;
    messages.forEach((packet, index) => {
      const payload = s.decrypt(decode64(packet));
      if (payload.length !== 65519 || payload.some(value => value !== (first + index) % 251)) {
        throw new Error('bulk payload mismatch');
      }
    });
  },
};
(globalThis as unknown as { remoteWrapper: typeof api }).remoteWrapper = api;
