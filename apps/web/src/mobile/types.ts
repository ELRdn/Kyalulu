export type ModelFile = { path: string; url: string; bytes: number; sha256: string };
export type MobileModel = {
  id: string; name: string; runtime: 'gguf' | 'onnx'; repo: string; revision: string;
  distributionRevision?: string; source: string; license: string; files: ModelFile[];
  temperature: number; topK: number; topP: number; note: string;
};
export type Message = { id: string; role: 'user' | 'assistant'; content: string; state?: 'complete' | 'stopped' | 'interrupted' };
export type Character = { id: string; name: string; prompt: string; intro: string };
export type Conversation = { id: string; characterId: string; character: Character; modelId: string; title: string; updatedAt: string; messages: Message[]; draft: string };
export type MobileData = { version: 1; characters: Character[]; conversations: Conversation[]; selectedModel: string };
export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelStatus = { id: string; fingerprint: string; verifiedAt: string };
export type Measurement = {
  modelId: string; revision: string; backend: string; runtimeVariant: string; userAgent: string; contextTokens: number;
  loadMs: number; firstTokenMs: number | null; generationMs: number; outputTokens: number | null;
  tokensPerSecond: number | null;
  wasmBytes: number | null; gpuBytes: number | null; kvBytes: number | null;
  physicalBytes: number | null; residentWeightBytes: number | null; pleLazy: boolean | null;
  weightBufferBytes?: number | null; pleBytesRead?: number | null;
};
export const CONTEXT_TOKENS = 2048;
export const OUTPUT_TOKENS = 256;
export const DEFAULT_MODEL = 'kyalulu-iq3m';
