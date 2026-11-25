'use client';

import { lazy, Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Router, Routes, Route, createPath, type Navigator, type To } from 'react-router-dom';
import AppShell from '../../../web/src/layout/AppShell';
import RuntimeGate from '../../../web/src/components/RuntimeGate';
import UnifiedEntry from '../../../web/src/components/UnifiedEntry';
import MobileAppStatus from '../../../web/src/components/MobileAppStatus';
import { executionTarget, useExecutionTarget } from '../../../web/src/lib/appContext';
import { cloudOwner } from '../../../web/src/lib/cloudMode';
import { stageChatFirstSend } from '../../../web/src/lib/chatFirstSend';
import type { CharacterOpening } from '../../../web/src/lib/characterHandoff';
import { connectionScope } from '../../../web/src/lib/remoteStore';
import { onlineRouteGroup } from '../../../web/src/lib/onlineRoutes';
import { legacyPath } from '../../../web/src/lib/legacyPath';
import { ScreenView, type ScreenPath } from './views';
import '../../../web/src/index.css';

const RemoteRuntime = lazy(async () => {
  const { default: RemoteSetup, RemoteBanner } = await import('../../../web/src/components/RemoteSetup');
  return {
    default: ({ children }: { children: ReactNode }) =>
      <UnifiedEntry><RemoteSetup entry={{}}><RemoteBanner />{children}</RemoteSetup></UnifiedEntry>,
  };
});

const href = (to: To) => typeof to === 'string' ? to : createPath(to);
function onFragmentChange(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}

export default function Runtime({ path, opening, pending, onReady }: {
  path: ScreenPath; opening?: CharacterOpening; pending: ReactNode; onReady: (ready: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const hash = useSyncExternalStore(onFragmentChange, () => location.hash, () => '');
  const [revision, refresh] = useState(0);
  const [ready, setReady] = useState(false);
  const target = useExecutionTarget();
  useEffect(() => {
    if (target === 'device' || target === 'local') {
      const route = legacyPath(location.hash, location.origin) ?? location.pathname + location.search;
      location.replace((target === 'device' ? '/device/#' : '/index.html#') + route);
    } else {
      if (location.hash.startsWith('#/')) {
        const route = legacyPath(location.hash, location.origin);
        if (route && route.split('#')[0] !== location.pathname + location.search) {
          location.replace(route);
          return;
        }
        history.replaceState(history.state, '', route ?? location.pathname + location.search);
      }
      if (location.pathname === '/' && location.search === '?kyalulu-entry=online') {
        history.replaceState(history.state, '', '/');
      }
      setReady(true);
      onReady(true);
    }
  }, [target, hash, onReady]);

  const navigator = useMemo<Navigator>(() => {
    function navigate(to: To, state: unknown, replace: boolean) {
      const url = new URL(href(to), location.href);
      const target = url.pathname + url.search + url.hash;
      if (url.origin !== location.origin) throw new Error('Expected a same-origin app route');
      if (url.pathname === location.pathname && url.search === location.search && (replace || url.hash !== location.hash)) {
        if (replace) history.replaceState({ ...history.state, usr: state }, '', target);
        else history.pushState({ ...history.state, usr: state }, '', target);
        refresh(value => value + 1);
      } else if (state != null) {
        const first = state as { nextChat?: boolean; send?: string; sendOwner?: string };
        const chat = /^\/chats\/(chat_[a-f0-9-]+)$/.exec(url.pathname);
        if (path === '/characters/:characterId' && first.nextChat === true && chat && !url.search && !url.hash &&
            executionTarget() === 'cloud' && first.sendOwner && first.sendOwner === cloudOwner() &&
            typeof first.send === 'string' && first.send.trim() && stageChatFirstSend(connectionScope(), chat[1], first.send)) {
          if (replace) router.replace(target);
          else router.push(target);
          return;
        }
        // The shared chat consumes history.state.usr once and clears it before sending.
        const write = replace ? History.prototype.replaceState : History.prototype.pushState;
        write.call(history, { usr: state }, '', target);
        location.reload();
      } else if (onlineRouteGroup(path) !== 'browse' && onlineRouteGroup(url.pathname) === onlineRouteGroup(path)) {
        if (replace) router.replace(target);
        else router.push(target);
      } else if (replace) location.replace(target);
      else location.assign(target);
    }
    return { createHref: href, go: delta => history.go(delta),
      push: (to, state) => navigate(to, state, false), replace: (to, state) => navigate(to, state, true) };
  }, [router, path]);

  if (!ready || target === 'device' || target === 'local') return null;
  const runtime = <RuntimeGate pending={pending}><Routes><Route element={<AppShell />}>
    <Route path={path} element={<ScreenView path={path} opening={opening} pending={pending} />} />
  </Route></Routes></RuntimeGate>;
  return <Router navigator={navigator} location={{
    pathname, search: query ? '?' + query : '', hash,
    state: history.state?.usr ?? null, key: pathname + '?' + query + ':' + revision,
  }}>
    <div className="k-pwa-root"><MobileAppStatus quiet />
      {target === 'pc' ? <Suspense fallback={pending}>
        <RemoteRuntime>{runtime}</RemoteRuntime>
      </Suspense> : runtime}
    </div>
  </Router>;
}
