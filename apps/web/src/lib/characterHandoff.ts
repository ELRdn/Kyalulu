import type { CharacterInfo } from './api';

export type CharacterOpening = Pick<CharacterInfo, 'id' | 'intro' | 'alternate_greetings' | 'recommended_generation'>;

export function characterSessionOptions(character: CharacterOpening, greetingIndex = 0) {
  const greetings = [character.intro ?? '', ...(character.alternate_greetings ?? [])].filter(greeting => greeting.trim());
  const temperature = character.recommended_generation?.temperature;
  return { characterId: character.id, intro: greetings[greetingIndex] ?? '',
    temperature: typeof temperature === 'number' ? temperature : undefined };
}

// The public Next page and the interactive runtime share a tab, origin and character ID.
// Only an opaque, single-use reference travels in the navigation URL.
const HANDOFF = 'kyalulu-character-handoff-v1';
export const PENDING_START = 'kyalulu-pending-start';
export function readPendingStart(): { character: string; text: string; publicDraft?: boolean } | null {
  try {
    const item = JSON.parse(sessionStorage.getItem(PENDING_START) || 'null');
    return typeof item?.character === 'string' && typeof item.text === 'string' ? item : null;
  } catch { return null; }
}
const draftKey = (character: string, owner: string) =>
  'kyalulu-character-draft-v1:' + JSON.stringify([character, owner]);

export function readCharacterDraft(character: string, owner: string) {
  return sessionStorage.getItem(draftKey(character, owner)) ?? '';
}

export function saveCharacterDraft(character: string, owner: string, text: string) {
  const key = draftKey(character, owner);
  if (text) sessionStorage.setItem(key, text);
  else sessionStorage.removeItem(key);
}

export function prepareCharacterHandoff(character: string, owner: string, text: string) {
  const id = crypto.randomUUID();
  sessionStorage.setItem(HANDOFF, JSON.stringify({ id, character, owner, text }));
  return '/characters/' + encodeURIComponent(character) + '?start=' + id;
}

export function takeCharacterHandoff(id: string, character: string, owner: string): string | null {
  const raw = sessionStorage.getItem(HANDOFF);
  if (!raw) return null;
  const record = JSON.parse(raw);
  if (record?.id !== id) return null;
  sessionStorage.removeItem(HANDOFF);
  return record.character === character && record.owner === owner && typeof record.text === 'string'
    ? record.text : null;
}
