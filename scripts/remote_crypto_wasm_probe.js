// Test harness around the unmodified noise-c.wasm public API; not product code.
(async () => {
  const noise = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WASM initialization timeout')), 10000);
    noise_c_wasm({ locateFile: file => '/node_modules/noise-c.wasm/src/' + file }, value => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  const bytes = a => Uint8Array.from(a);
  const fp = async key => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', key)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const identities = new Map();
  const sessions = new Map();
  let counter = 0;
  const close = s => {
    // Handshake errors may already free the native object in this binding.
    if (s.hs?._state !== undefined) s.hs.free();
    for (const c of s.ciphers ?? []) c.free();
    s.hs = null;
    s.ciphers = null;
    s.closed = true;
  };
  globalThis.wasmProbe = {
    async identity() {
      const [secret, publicKey] = noise.CreateKeyPair(noise.constants.NOISE_DH_CURVE25519);
      const id = ++counter;
      identities.set(id, secret);
      return { id, publicKey: Array.from(publicKey), fingerprint: await fp(publicKey) };
    },
    create({ identity, initiator = true, expectedPin = null }) {
      const hs = new noise.HandshakeState('Noise_XX_25519_ChaChaPoly_SHA256',
        initiator ? noise.constants.NOISE_ROLE_INITIATOR : noise.constants.NOISE_ROLE_RESPONDER);
      hs.Initialize(new TextEncoder().encode('kyalulu-remote-v1'), identities.get(identity));
      const id = ++counter;
      sessions.set(id, { hs, expectedPin, closed: false });
      return id;
    },
    async call({ id, method, data = [] }) {
      const s = sessions.get(id);
      try {
        if (s.closed) throw new Error('closed');
        let result;
        if (method === 'write') result = s.hs.WriteMessage(bytes(data));
        else if (method === 'read') {
          result = s.hs.ReadMessage(bytes(data), true);
          const key = s.hs.GetRemotePublicKey();
          if (key) {
            s.peerFingerprint = await fp(key);
            if (s.expectedPin !== null && s.expectedPin !== s.peerFingerprint) throw new Error('pin mismatch');
          }
        } else if (method === 'finalize') {
          result = s.hs.GetHandshakeHash();
          s.ciphers = s.hs.Split();
          s.hs = null;
        } else if (method === 'encrypt') result = s.ciphers[0].EncryptWithAd(new Uint8Array(0), bytes(data));
        else if (method === 'decrypt') result = s.ciphers[1].DecryptWithAd(new Uint8Array(0), bytes(data));
        else if (method === 'rekey') {
          s.ciphers[0].Rekey();
          result = new Uint8Array(0);
        } else if (method === 'close') {
          close(s);
          result = new Uint8Array(0);
        } else throw new Error('unknown method');
        return { ok: true, data: Array.from(result ?? []), peerFingerprint: s.peerFingerprint ?? null };
      } catch (error) {
        close(s);
        return { ok: false, error: String(error) };
      }
    },
    async cleanup() {
      for (const s of sessions.values()) if (!s.closed) close(s);
      for (const secret of identities.values()) secret.fill(0);
      identities.clear();
      sessions.clear();
    },
  };
})().catch(error => { globalThis.wasmProbeError = String(error); });
