'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { characterSessionOptions, prepareCharacterHandoff, readCharacterDraft, readPendingStart, saveCharacterDraft, type CharacterOpening } from '../../../../web/src/lib/characterHandoff';
import { stageChatFirstSend } from '../../../../web/src/lib/chatFirstSend';
import { cloudConnectionScope } from '../../../../web/src/lib/cloudMode';
import { selectedExecutionTarget } from '../../../../web/src/lib/executionPreference';
import type { SessionSettings } from '../../../../web/src/lib/api';
import { prepareSessionSettings, saveSessionOpening, newSessionId, type SessionRequest } from '../../../../web/src/lib/sessionSetup';
import { preloadChatRoute } from '../../_runtime/chatRouteModules';

type StartAttempt = { owner: string; session: string; prepared: boolean; atomicOpening: boolean;
  settings?: SessionSettings; historyRevision?: string; nextOpening?: boolean };
const DRAFT_PRELOAD_DELAY_MS = 400;
const OPENING_DELIVERY = 'X-Kyalulu-Next-Opening';

async function currentAccess() {
  if (selectedExecutionTarget('cloud') !== 'cloud') return null;
  const response = await fetch('/api/mobile/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const status = await response.json();
  if (selectedExecutionTarget('cloud') !== 'cloud' || status.cloud_mode !== true) return null;
  const owner = status.authenticated === false ? 'guest'
    : status.authenticated === true && typeof status.owner_scope === 'string' && status.owner_scope
    ? String(status.owner_scope) : null;
  return owner ? { owner, nextBrowse: response.headers.get('X-Kyalulu-Next-Browse') === '1',
    nextChats: response.headers.get('X-Kyalulu-Next-Chats') === '1',
    openingDelivery: response.headers.get(OPENING_DELIVERY) === '1',
    atomicOpening: status.atomic_chat_opening === true } : null;
}

export default function CharacterComposer({ character, opening, initialLanguage, runtimeScripts }: {
  character: string; opening?: CharacterOpening; initialLanguage: 'ja' | 'en'; runtimeScripts: string[];
}) {
  const router = useRouter();
  const [access, setAccess] = useState<Awaited<ReturnType<typeof currentAccess>>>(null);
  const owner = access?.owner ?? null;
  const [draft, setDraft] = useState('');
  const [draftEdited, setDraftEdited] = useState(false);
  const [en, setEnglish] = useState(initialLanguage === 'en');
  const [phase, setPhase] = useState<'preparing' | 'opening' | null>(null);
  const busy = phase !== null;
  const [error, setError] = useState<'draft' | 'start' | null>(null);
  const revision = useRef(0);
  const submitting = useRef(false);
  const draftPreload = useRef<AbortController | null>(null);
  const attempt = useRef<StartAttempt | null>(null);
  const fullProfile = '/characters/' + encodeURIComponent(character) + '?view=profile';

  useEffect(() => {
    async function refresh() {
      const epoch = ++revision.current;
      submitting.current = false;
      setPhase(null);
      setAccess(null);
      setDraft('');
      setDraftEdited(false);
      try {
        if (selectedExecutionTarget('cloud') !== 'cloud') {
          location.replace(fullProfile);
          return;
        }
        const prefs = JSON.parse(localStorage.getItem('kyalulu-app-preferences-v1') || '{}');
        setEnglish((prefs?.language || navigator.language).startsWith('en'));
        const next = await currentAccess();
        if (epoch !== revision.current || !next) return;
        if (next.owner !== 'guest' && readPendingStart()?.character === character) {
          location.replace(fullProfile);
          return;
        }
        setDraft(readCharacterDraft(character, next.owner));
        setAccess(next);
      } catch { /* Full-document navigation remains available without storage or Cloud. */ }
    }
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener('pageshow', refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ++revision.current;
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('storage', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [character, fullProfile]);

  const canPrepare = !!access?.nextBrowse && access.nextChats && owner !== 'guest'
    && opening?.id === character && draftEdited && !!draft.trim();
  useEffect(() => {
    if (!canPrepare || busy || !runtimeScripts.length) return;
    const epoch = revision.current;
    const controller = new AbortController();
    draftPreload.current = controller;
    const timer = window.setTimeout(() => {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      if (revision.current !== epoch || submitting.current || document.hidden
          || connection?.saveData || selectedExecutionTarget('cloud') !== 'cloud') return;
      for (const script of runtimeScripts) {
        // Fill the HTTP cache without evaluating scripts or applying chat styles.
        void fetch(script, { cache: 'force-cache', mode: 'same-origin', redirect: 'error',
          priority: 'low', signal: controller.signal }).then(res => res.ok ? res.arrayBuffer() : undefined).catch(() => {});
      }
    }, DRAFT_PRELOAD_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (draftPreload.current === controller) draftPreload.current = null;
    };
  }, [canPrepare, busy, runtimeScripts]);

  async function start() {
    if (!access || !owner || submitting.current) return;
    submitting.current = true;
    draftPreload.current?.abort();
    const epoch = revision.current;
    setPhase('preparing');
    setError(null);
    const current = () => revision.current === epoch && selectedExecutionTarget('cloud') === 'cloud';
    const text = draft.trim();
    const openingOptions = opening?.id === character ? characterSessionOptions(opening) : null;
    // The atomic write authenticates the exact owner. The proxy reports current
    // route delivery on its response, so supported starts can skip a separate GET.
    const verifyOnOpening = owner !== 'guest' && access.atomicOpening && access.openingDelivery &&
      access.nextBrowse && access.nextChats && !!openingOptions?.intro.trim() && !!text;
    let accessLost = false;
    try {
      const confirmed = verifyOnOpening ? access : await currentAccess();
      if (revision.current !== epoch) return;
      if (confirmed?.owner !== owner || !current()) {
        setAccess(null);
        setDraft('');
        setPhase(null);
        submitting.current = false;
        return;
      }
      if (owner !== 'guest' && confirmed.nextBrowse && confirmed.nextChats && openingOptions && text) {
        // A timeout can follow a committed write. Keep the same session ID when retrying.
        const pending: StartAttempt = attempt.current?.owner === owner ? attempt.current :
          { owner, session: newSessionId(), prepared: false, atomicOpening: confirmed.atomicOpening };
        attempt.current = pending;
        const request: SessionRequest = async (path, init) => {
          if (!current()) throw Error('Conversation start changed');
          const headers = new Headers(init?.headers);
          headers.set('X-Kyalulu-Owner', owner);
          const response = await fetch(path, { ...init, headers, credentials: 'same-origin',
            cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
          if (!current()) throw Error('Conversation start changed');
          if (path === '/api/chat/settings/opening') {
            pending.nextOpening = response.headers.get(OPENING_DELIVERY) === '1';
            accessLost = response.status === 401 || (response.status === 403 &&
              (await response.clone().json().catch(() => null))?.code === 'sync_account_changed');
          }
          return response;
        };
        if (!pending.prepared) {
          pending.atomicOpening &&= confirmed.atomicOpening;
          if (!pending.settings) {
            const settings = await prepareSessionSettings(request, owner, pending.session, openingOptions);
            if (!settings) throw Error('Conversation opening is missing');
            pending.settings = settings;
          }
          pending.historyRevision = await saveSessionOpening(request, pending.settings, pending.atomicOpening);
          pending.prepared = true;
        }
        if (!current()) return;
        if (!stageChatFirstSend(cloudConnectionScope(location.origin, owner), pending.session, text, pending.historyRevision)) {
          throw Error('Draft could not be handed off');
        }
        try {
          if (readCharacterDraft(character, owner).trim() === text) saveCharacterDraft(character, owner, '');
        } catch { /* The conversation draft is already durable. */ }
        const chat = '/chats/' + encodeURIComponent(pending.session);
        setPhase('opening');
        if (verifyOnOpening && !pending.nextOpening) {
          // A rollout change can follow a committed write. Reopen the same
          // session by document navigation and leave its durable draft for review.
          location.assign(chat);
        } else {
          preloadChatRoute();
          router.push(chat);
        }
        return;
      }
      const handoff = prepareCharacterHandoff(character, owner, text);
      setPhase('opening');
      // The full browse group delivers the handoff URL through this same Next route.
      // The character-only switch delivers that URL to the predecessor for sign-in.
      if (owner !== 'guest' && confirmed.nextBrowse) router.push(handoff);
      else location.assign(handoff);
    } catch {
      if (revision.current !== epoch) return;
      if (accessLost) {
        setAccess(null);
        setDraft('');
      } else setError('start');
      submitting.current = false;
      setPhase(null);
    }
  }

  return <section lang={en ? 'en' : 'ja'}>
    {owner && <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void start(); }}>
      <label>{en ? 'First message' : '最初のメッセージ'}
        <input aria-label={en ? 'First message' : '最初のメッセージ'} value={draft} disabled={busy} onChange={event => {
          const value = event.target.value;
          setDraft(value);
          setDraftEdited(true);
          try { saveCharacterDraft(character, owner, value); } catch { setError('draft'); }
        }} />
      </label>
      <button type="submit" disabled={busy}>{en ? 'Start conversation' : '会話をはじめる'}</button>
    </form>}
    <div role="status">{phase === 'preparing' ? (en ? 'Preparing conversation…' : '会話を準備中…')
      : phase === 'opening' ? (en ? 'Opening conversation…' : '会話を開いています…') : null}</div>
    {error === 'draft' && <p role="alert">{en ? 'Your browser could not save this draft.' : 'ブラウザに下書きを保存できませんでした。'}</p>}
    {error === 'start' && <p role="alert">{en ? 'Could not start the conversation. Try again.' : '会話を開始できませんでした。もう一度お試しください。'}</p>}
    <a href={fullProfile}>{en ? 'Open full character profile' : 'キャラの詳細を開く'}</a>
  </section>;
}
