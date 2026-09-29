// Narrow declarations for the pinned, unmodified noise-c.wasm@0.4.0 binding.
declare module 'noise-c.wasm' {
  export interface Cipher {
    EncryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array;
    DecryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array;
    free(): void;
  }
  export interface Handshake {
    // Binding deletes this handle when it automatically frees on native errors.
    readonly _state?: number;
    Initialize(prologue: Uint8Array, privateKey: Uint8Array): void;
    WriteMessage(payload: Uint8Array): Uint8Array;
    ReadMessage(message: Uint8Array, payloadNeeded: boolean): Uint8Array;
    GetRemotePublicKey(): Uint8Array | null;
    GetHandshakeHash(): Uint8Array;
    Split(): [Cipher, Cipher];
    free(): void;
  }
  export interface NoiseLibrary {
    constants: { NOISE_DH_CURVE25519: number; NOISE_ROLE_INITIATOR: number };
    CreateKeyPair(curve: number): [Uint8Array, Uint8Array];
    HandshakeState: new (name: string, role: number) => Handshake;
  }
  export default function load(
    options: { locateFile(file: string): string; onAbort(reason: unknown): void },
    callback: (library: NoiseLibrary) => void,
  ): void;
}
