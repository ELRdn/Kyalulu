import type { SessionSettings } from './api';
import { checkedJson } from './apiJson';

export type SessionRequest = (path: string, init?: RequestInit) => Promise<Response>;
export type SessionStartOptions = {
  characterId?: string | null;
  personaId?: string | null;
  worldId?: string | null;
  intro?: string;
  temperature?: number;
};

const personaKey = (owner: string) => 'kyalulu-default-persona:' + owner;

export function readDefaultPersona(owner: string): string | null {
  try { return localStorage.getItem(personaKey(owner)); } catch { return null; }
}

export function writeDefaultPersona(owner: string, assetId: string | null) {
  try {
    if (assetId) localStorage.setItem(personaKey(owner), assetId);
    else localStorage.removeItem(personaKey(owner));
  } catch { /* The preference can be unavailable in restricted storage. */ }
}

async function resolveDefaultPersona(owner: string, request: SessionRequest) {
  const asset = readDefaultPersona(owner);
  if (!asset) return null;
  try {
    const { items }: { items: { asset_id?: string; id: string }[] } = await checkedJson(await request('/api/creator/persona'));
    const latest = items.find(item => item.asset_id === asset);
    if (!latest) writeDefaultPersona(owner, null);
    return latest?.id ?? null;
  } catch { return null; }
}

export function newSessionId(): string {
  return `chat_${crypto.randomUUID()}`;
}

export async function saveSessionSettings(request: SessionRequest, settings: SessionSettings, atomicOpening = false) {
  const response = await request(atomicOpening ? '/api/chat/settings/opening' : '/api/chat/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  if (atomicOpening && response.status !== 201 && response.status !== 204) throw new Error('Invalid conversation opening response');
  const revision = atomicOpening ? response.headers.get('X-Kyalulu-History-Revision') : null;
  return revision && /^[a-f0-9]{64}$/.test(revision) ? revision : undefined;
}

export async function injectSessionIntro(request: SessionRequest, sessionId: string): Promise<{ injected: boolean; intro?: string }> {
  return checkedJson(await request(`/api/chat/intro/inject?session_id=${encodeURIComponent(sessionId)}`, { method: 'POST' }));
}

export async function prepareSessionSettings(request: SessionRequest, owner: string, sessionId: string, opts: SessionStartOptions) {
  const persona = opts.personaId === undefined ? await resolveDefaultPersona(owner, request) : opts.personaId;
  if (!opts.characterId && !persona && !opts.worldId && !opts.intro) return null;
  return {
    session_id: sessionId,
    system_prompt: '',
    temperature: opts.temperature ?? 0.8,
    character_id: opts.characterId ?? null,
    persona_id: persona,
    world_id: opts.worldId ?? null,
    intro: opts.intro ?? '',
  } satisfies SessionSettings;
}

export async function saveSessionOpening(request: SessionRequest, settings: SessionSettings, atomicOpening = false) {
  const combine = atomicOpening && !!settings.character_id && !!settings.intro?.trim();
  const revision = await saveSessionSettings(request, settings, combine);
  if (!combine && settings.intro?.trim()) await injectSessionIntro(request, settings.session_id);
  return revision;
}

export async function initializeSession(request: SessionRequest, owner: string, sessionId: string, opts: SessionStartOptions = {}) {
  const settings = await prepareSessionSettings(request, owner, sessionId, opts);
  if (settings) await saveSessionOpening(request, settings);
}
