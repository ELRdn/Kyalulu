// Isolated library qualification ONLY. Not a production crypto implementation.
import {
  NqHandshake, noiseXx, noiseXxPsk3, chachaPoly, sha256H, x25519Keygen,
  CipherState,
} from '@lukeburns/clatterjs';

const random = n => crypto.getRandomValues(new Uint8Array(n));
const bytes = x => Uint8Array.from(x);
const sessions = new Map();
const identities = new Map();
let nextId = 0;
globalThis.remoteCryptoProbe = {
  identity() {
    const key = x25519Keygen(random);
    const id = ++nextId;
    identities.set(id, key);
    return { id, publicKey: Array.from(key.publicKey) };
  },
  create({ identity, pairing, psk }) {
    const hs = new NqHandshake(pairing ? noiseXxPsk3() : noiseXx(), {
      initiator: true, prologue: new TextEncoder().encode('kyalulu-remote-v1'),
      s: identities.get(identity), cipher: chachaPoly, hash: sha256H, rng: random,
    });
    if (pairing) hs.pushPsk(bytes(psk));
    const id = ++nextId;
    sessions.set(id, { hs });
    return { id, name: hs.getName() };
  },
  call({ id, method, data = [] }) {
    const s = sessions.get(id);
    try {
      let result;
      if (method === 'write') {
        const out = new Uint8Array(65535);
        result = out.slice(0, s.hs.writeMessage(new Uint8Array(0), out));
      } else if (method === 'read') {
        const out = new Uint8Array(65535);
        result = out.slice(0, s.hs.readMessage(bytes(data), out));
      } else if (method === 'finalize') {
        s.transport = s.hs.finalize();
        result = s.hs.getRemoteStatic();
      } else if (method === 'encrypt') {
        result = s.transport.sendVec(bytes(data));
      } else if (method === 'decrypt') {
        result = s.transport.receiveVec(bytes(data));
      } else if (method === 'rekeySend') {
        s.transport.rekeySender();
        result = new Uint8Array(0);
      } else throw new Error('unknown probe method');
      return { ok: true, data: Array.from(result) };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
  // Public library API: compare standard REKEY with an independent implementation.
  rekeyVector(key) { return Array.from(chachaPoly.rekey(bytes(key))); },
  nonceBoundary() {
    const c = new CipherState(chachaPoly, new Uint8Array(32), (1n << 60n) - 1n);
    c.encryptWithAd(new Uint8Array(0), new Uint8Array(0), new Uint8Array(16));
    try {
      c.encryptWithAd(new Uint8Array(0), new Uint8Array(0), new Uint8Array(16));
      return 'accepted';
    } catch (error) { return String(error); }
  },
};
