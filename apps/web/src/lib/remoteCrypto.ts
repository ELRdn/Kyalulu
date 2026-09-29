/// <reference path="./remoteCryptoVendor.d.ts" />
/// <reference types="vite/client" />
/** Standard Noise XX via unmodified noise-c.wasm@0.4.0. No crypto fallback.
 * Host approval and 64-MiB / Client 9-minute, Host 10-minute renewal belong to
 * the protocol layer.
 * REKEY is intentionally not exposed: renew with a fresh XX handshake.
 */
import loadNoise, { type Cipher, type Handshake, type NoiseLibrary } from 'noise-c.wasm';
import wasmUrl from 'noise-c.wasm/src/noise-c.wasm?url';

export const NOISE_PROTOCOL = 'Noise_XX_25519_ChaChaPoly_SHA256';
export const MAX_NOISE_MESSAGE = 65535;
export const MAX_NOISE_PLAINTEXT = MAX_NOISE_MESSAGE - 16;
export const MAX_HANDSHAKE_PAYLOAD = 1024;
export const MAX_TRANSPORT_FRAMES = 1 << 20;

export class RemoteCryptoError extends Error {
  constructor(message: string) { super(message); this.name = 'RemoteCryptoError'; }
}

let libraryPromise: Promise<NoiseLibrary> | undefined;
function library(): Promise<NoiseLibrary> {
  if (!globalThis.crypto?.getRandomValues || !globalThis.isSecureContext) {
    return Promise.reject(new RemoteCryptoError('Noise requires a secure browser context'));
  }
  if (!libraryPromise) {
    libraryPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new RemoteCryptoError('Noise initialization timeout')), 15000);
      const fail = () => {
        clearTimeout(timer);
        reject(new RemoteCryptoError('Noise WASM initialization failed'));
      };
      try {
        loadNoise({ locateFile: () => wasmUrl, onAbort: fail }, value => {
          clearTimeout(timer);
          resolve(value);
        });
      } catch { fail(); }
    });
  }
  // A failed module stays failed. Reload instead of reusing an uncertain runtime.
  return libraryPromise;
}

function checkedBytes(value: Uint8Array, name: string, length?: number): Uint8Array {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new RemoteCryptoError(`Invalid ${name}`);
  }
  return value;
}

function equalKey(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function generateKeypair(): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const noise = await library();
  const [privateKey, publicKey] = noise.CreateKeyPair(noise.constants.NOISE_DH_CURVE25519);
  return { privateKey, publicKey };
}

export interface NoiseOptions {
  privateKey: Uint8Array;
  expectedPeer: Uint8Array;
  prologue: Uint8Array;
}

export interface NoiseSession {
  readonly finished: boolean;
  /** Empty until authenticated/available, and after close; always returns a copy. */
  readonly peerKey: Uint8Array;
  readonly handshakeHash: Uint8Array;
  write(payload?: Uint8Array): Uint8Array;
  read(message: Uint8Array): Uint8Array;
  encrypt(plaintext: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array): Uint8Array;
  close(): void;
}

class BrowserNoiseSession implements NoiseSession {
  #handshake: Handshake | null;
  #ciphers: [Cipher, Cipher] | null = null;
  #expected: Uint8Array;
  #peer = new Uint8Array(0);
  #hash = new Uint8Array(0);
  #step = 0;
  #closed = false;
  #sent = 0;
  #received = 0;

  constructor(handshake: Handshake, expectedPeer: Uint8Array) {
    this.#handshake = handshake;
    this.#expected = expectedPeer;
  }

  get finished(): boolean { return !this.#closed && this.#ciphers !== null; }
  get peerKey(): Uint8Array { return this.#peer.slice(); }
  get handshakeHash(): Uint8Array { return this.#hash.slice(); }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    // The pinned binding auto-frees handshake objects on native error. Checking
    // ownership avoids a second free; no native state or algorithm is modified.
    try {
      if (this.#handshake?._state !== undefined) this.#handshake.free();
    } finally {
      this.#handshake = null;
      for (const cipher of this.#ciphers ?? []) {
        try { cipher.free(); } catch { /* Keep the session closed on cleanup errors. */ }
      }
      this.#ciphers = null;
      this.#expected.fill(0);
      this.#peer = new Uint8Array(0);
      this.#hash = new Uint8Array(0);
    }
    // Native/JS transient copies are runtime-managed; no guaranteed-erasure claim.
  }

  #fail(message: string): never {
    try { this.close(); } catch { /* Preserve a bounded, non-secret error. */ }
    throw new RemoteCryptoError(message);
  }

  write(payload: Uint8Array = new Uint8Array(0)): Uint8Array {
    try {
      if (this.#closed || !this.#handshake || (this.#step !== 0 && this.#step !== 2)) {
        throw new RemoteCryptoError('Invalid handshake order');
      }
      checkedBytes(payload, 'handshake payload');
      if ((this.#step !== 2 && payload.length !== 0) || payload.length > MAX_HANDSHAKE_PAYLOAD) {
        throw new RemoteCryptoError('Only m3 may contain a bounded payload');
      }
      const message = this.#handshake.WriteMessage(payload);
      if (message.length > MAX_NOISE_MESSAGE) throw new RemoteCryptoError('Frame too large');
      this.#step++;
      if (this.#step === 3) {
        if (this.#peer.length !== 32) throw new RemoteCryptoError('Missing authenticated peer');
        this.#hash = new Uint8Array(this.#handshake.GetHandshakeHash());
        this.#ciphers = this.#handshake.Split();
        this.#handshake = null; // Split consumes/frees its handshake object.
      }
      return message;
    } catch { return this.#fail('Noise handshake write failed'); }
  }

  read(message: Uint8Array): Uint8Array {
    try {
      if (this.#closed || !this.#handshake || this.#step !== 1) throw new RemoteCryptoError('Invalid handshake order');
      checkedBytes(message, 'handshake frame');
      if (message.length > MAX_NOISE_MESSAGE) throw new RemoteCryptoError('Frame too large');
      const payload = this.#handshake.ReadMessage(message, true);
      const peer = this.#handshake.GetRemotePublicKey();
      if (payload.length !== 0 || !peer || !equalKey(peer, this.#expected)) {
        throw new RemoteCryptoError('Unexpected payload or peer key');
      }
      this.#peer = new Uint8Array(peer);
      this.#step++;
      return payload;
    } catch { return this.#fail('Noise handshake read failed'); }
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    try {
      if (!this.finished || !this.#ciphers) throw new RemoteCryptoError('Handshake incomplete');
      checkedBytes(plaintext, 'plaintext');
      if (plaintext.length > MAX_NOISE_PLAINTEXT || this.#sent >= MAX_TRANSPORT_FRAMES) {
        throw new RemoteCryptoError('Transport limit; reconnect');
      }
      const message = this.#ciphers[0].EncryptWithAd(new Uint8Array(0), plaintext);
      this.#sent++;
      return message;
    } catch { return this.#fail('Noise encrypt failed'); }
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    try {
      if (!this.finished || !this.#ciphers) throw new RemoteCryptoError('Handshake incomplete');
      checkedBytes(ciphertext, 'ciphertext');
      if (ciphertext.length < 16 || ciphertext.length > MAX_NOISE_MESSAGE || this.#received >= MAX_TRANSPORT_FRAMES) {
        throw new RemoteCryptoError('Transport limit; reconnect');
      }
      const plaintext = this.#ciphers[1].DecryptWithAd(new Uint8Array(0), ciphertext);
      this.#received++;
      return plaintext;
    } catch { return this.#fail('Noise decrypt failed'); }
  }
}

/** Browser initiator only; raw Host pin is mandatory. Methods are synchronous. */
export async function createNoise(options: NoiseOptions): Promise<NoiseSession> {
  // Copy inputs before awaiting WASM: caller mutation cannot change this session.
  const privateKey = checkedBytes(options.privateKey, 'private key', 32).slice();
  let handshake: Handshake | null = null;
  try {
    const expectedPeer = checkedBytes(options.expectedPeer, 'Host key', 32).slice();
    const prologue = checkedBytes(options.prologue, 'prologue').slice();
    if (prologue.length > MAX_NOISE_MESSAGE) throw new RemoteCryptoError('Prologue too large');
    const noise = await library();
    handshake = new noise.HandshakeState(NOISE_PROTOCOL, noise.constants.NOISE_ROLE_INITIATOR);
    handshake.Initialize(prologue, privateKey);
    return new BrowserNoiseSession(handshake, expectedPeer);
  } catch {
    if (handshake?._state !== undefined) handshake.free();
    throw new RemoteCryptoError('Noise initialization failed');
  } finally { privateKey.fill(0); }
}
