import { deviceOwner } from './appContext';
import { initializeSession, newSessionId, readDefaultPersona, writeDefaultPersona, type SessionStartOptions } from './sessionSetup';
import { apiFetch } from './transport';

export { newSessionId };

export function defaultPersona(): string | null {
  return readDefaultPersona(deviceOwner());
}

export function setDefaultPersona(assetId: string | null) {
  writeDefaultPersona(deviceOwner(), assetId);
}

/** Initialize the selected runtime's conversation before navigating to it. */
export async function startNewSession(opts?: SessionStartOptions): Promise<string> {
  const sessionId = newSessionId();
  await initializeSession(apiFetch, deviceOwner(), sessionId, opts);
  return sessionId;
}
