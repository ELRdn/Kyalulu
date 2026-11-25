import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatRecovery } from './chatRecovery';
import { stageChatFirstSend, takeChatFirstSend } from './chatFirstSend';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  };
}

const owner = 'cloud:https://app.test:owner';
const session = 'chat_example';

describe('first send across the online navigation', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves a compatible draft and only releases it once for the same account and chat', () => {
    const revision = 'a'.repeat(64);
    expect(stageChatFirstSend(owner, session, 'First message', revision)).toBe(true);
    const draft = new ChatRecovery(localStorage, owner, session).read().draft;
    expect(draft).toBe('First message');
    expect(takeChatFirstSend('cloud:https://app.test:other', session, draft)).toBeNull();
    expect(takeChatFirstSend(owner, 'chat_other', draft)).toBeNull();
    expect(takeChatFirstSend(owner, session, draft)).toEqual({ text: draft, historyRevision: revision });
    expect(takeChatFirstSend(owner, session, draft)).toBeNull();
  });

  it('keeps an edited draft without sending it automatically', () => {
    const recovery = new ChatRecovery(localStorage, owner, session);
    expect(stageChatFirstSend(owner, session, 'First message')).toBe(true);
    recovery.draft('Edited message');
    expect(takeChatFirstSend(owner, session, recovery.read().draft)).toBeNull();
    expect(recovery.read().draft).toBe('Edited message');
    expect(takeChatFirstSend(owner, session, 'First message')).toBeNull();
  });

  it('refuses an automatic send if the draft cannot be saved', () => {
    vi.stubGlobal('localStorage', { ...memoryStorage(), setItem() { throw new Error('Blocked storage'); } });
    expect(stageChatFirstSend(owner, session, 'First message')).toBe(false);
    expect(takeChatFirstSend(owner, session, 'First message')).toBeNull();
  });

  it('makes a document reload recover the draft as an edit instead of dispatching', async () => {
    expect(stageChatFirstSend(owner, session, 'First message')).toBe(true);
    vi.resetModules();
    const reloaded = await import('./chatFirstSend');
    expect(reloaded.takeChatFirstSend(owner, session, 'First message')).toBeNull();
    expect(new ChatRecovery(localStorage, owner, session).read().draft).toBe('First message');
  });
});
