import { saveSettings, injectIntro } from "./api";
import { deviceOwner } from "./appContext";
import { labRequest, type CreatorItem } from "./lab";

// "いつもの人物像" (31b) is remembered per owner on this device.
const DEFAULT_PERSONA = "kyalulu-default-persona:";
export function defaultPersona(): string | null {
  try { return localStorage.getItem(DEFAULT_PERSONA + deviceOwner()); } catch { return null; }
}
export function setDefaultPersona(assetId: string | null) {
  try {
    if (assetId) localStorage.setItem(DEFAULT_PERSONA + deviceOwner(), assetId);
    else localStorage.removeItem(DEFAULT_PERSONA + deviceOwner());
  } catch { /* storage blocked: new chats simply start without a persona */ }
}
async function defaultPersonaRef(): Promise<string | null> {
  const asset = defaultPersona();
  if (!asset) return null;
  try {
    const { items } = await labRequest<{ items: CreatorItem[] }>("creator/persona");
    const latest = items.find((item) => item.asset_id === asset);
    if (!latest) setDefaultPersona(null);
    return latest?.id ?? null;
  } catch { return null; }
}

/** 新規チャットセッションIDを発行する（Chat.tsx / CharacterEntry.tsx で共通利用） */
export function newSessionId(): string {
  return `chat_${crypto.randomUUID()}`;
}

/**
 * 新規セッションを初期化し、必要なら character/persona/world を紐付けて保存する。
 * Chat.tsx の handleNewSession と CharacterEntry.tsx の Start Chat の両方が
 * これを唯一の入口として使う（二重実装を避ける）。
 */
export async function startNewSession(opts?: {
  characterId?: string | null;
  personaId?: string | null;
  worldId?: string | null;
  intro?: string;
  temperature?: number;
}): Promise<string> {
  const sessionId = newSessionId();
  // An explicit persona (even "none") wins; otherwise new chats start with the default persona.
  if (opts?.personaId === undefined) opts = { ...opts, personaId: await defaultPersonaRef() };
  if (opts && (opts.characterId || opts.personaId || opts.worldId || opts.intro)) {
    await saveSettings({
      session_id: sessionId,
      system_prompt: "",
      temperature: opts.temperature ?? 0.8,
      character_id: opts.characterId ?? null,
      persona_id: opts.personaId ?? null,
      world_id: opts.worldId ?? null,
      intro: opts.intro ?? "",
    });
    if (opts.intro?.trim()) await injectIntro(sessionId);
  }
  return sessionId;
}
