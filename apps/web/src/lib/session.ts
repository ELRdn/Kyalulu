import { saveSettings, injectIntro } from "./api";

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
