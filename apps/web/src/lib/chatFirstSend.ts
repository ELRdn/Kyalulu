import { ChatRecovery } from './chatRecovery';

export type FirstSend = { text: string; historyRevision?: string };
let firstSend: (FirstSend & { scope: string; sessionId: string }) | null = null;

// Keep the draft readable by older clients during a route rollback. The tab-local
// marker permits one automatic send of that exact draft in the current document.
export function stageChatFirstSend(scope: string, sessionId: string, text: string, historyRevision?: string): boolean {
  try {
    const recovery = new ChatRecovery(localStorage, scope, sessionId);
    const previous = recovery.read();
    if (previous.pending || previous.draft) return false;
    recovery.draft(text);
    firstSend = { scope, sessionId, text, historyRevision };
    return true;
  } catch { return false; }
}

export function takeChatFirstSend(scope: string, sessionId: string, draft: string): FirstSend | null {
  if (firstSend?.scope !== scope || firstSend.sessionId !== sessionId) return null;
  const { text, historyRevision } = firstSend;
  firstSend = null;
  return draft.trim() && text === draft ? { text, historyRevision } : null;
}
