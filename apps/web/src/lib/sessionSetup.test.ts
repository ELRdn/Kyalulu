import { describe, expect, it, vi } from 'vitest';
import { initializeSession, saveSessionOpening } from './sessionSetup';

const opening = { characterId: 'mocha_sfw', personaId: null, intro: 'Fixture greeting' };
const settings = { session_id: 'chat-fixture', system_prompt: '', temperature: 0.8, character_id: opening.characterId, intro: opening.intro };

describe('conversation opening', () => {
  it.each([201, 204])('accepts a committed opening (%s) without a separate intro request', async status => {
    const revision = 'b'.repeat(64);
    const request = vi.fn().mockResolvedValue(new Response(null, { status, headers: { 'X-Kyalulu-History-Revision': revision } }));
    await expect(saveSessionOpening(request, settings, true)).resolves.toBe(revision);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/api/chat/settings/opening', expect.objectContaining({ method: 'PUT' }));
  });

  it('accepts older opening responses without a revision for the existing send path', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    await expect(saveSessionOpening(request, settings, true)).resolves.toBeUndefined();
  });

  it('keeps the existing settings and intro sequence for older runtimes', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ injected: true }));
    await initializeSession(request, 'owner', 'chat-fixture', opening);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/chat/settings', '/api/chat/intro/inject?session_id=chat-fixture',
    ]);
  });

  it('propagates an uncertain opening response without falling back to another write', async () => {
    const request = vi.fn().mockRejectedValue(new Error('connection dropped'));
    await expect(saveSessionOpening(request, settings, true)).rejects.toThrow('connection dropped');
    expect(request).toHaveBeenCalledOnce();
  });
});
