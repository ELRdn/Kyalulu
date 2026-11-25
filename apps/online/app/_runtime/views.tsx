import { lazy, Suspense, useState, type ReactNode } from 'react';
import AdminPage from '../../../web/src/components/AdminPage';
import { useDeviceOwner, useExecutionTarget } from '../../../web/src/lib/appContext';
import type { CharacterOpening } from '../../../web/src/lib/characterHandoff';
import { chatModule } from './chatRouteModules';

const DeferredChat = lazy(chatModule.load);

function ChatView() {
  // Keep the selected component type for the life of this conversation view.
  const [View] = useState(() => chatModule.current() ?? DeferredChat);
  return <View />;
}

const Profile = lazy(() => import('../../../web/src/pages/Profile'));
const views = {
  '/': lazy(() => import('../../../web/src/pages/Home')),
  '/login': () => null, // CloudRouteChoice renders sign-in or restores the validated return path.
  '/characters/:characterId': lazy(() => import('../../../web/src/pages/CharacterEntry')),
  '/discover': lazy(() => import('../../../web/src/pages/Discover')),
  '/published': lazy(() => import('../../../web/src/pages/Published')),
  '/published/:publicationId': lazy(() => import('../../../web/src/pages/Published').then(module => ({ default: module.PublishedDetail }))),
  '/works/:workId': lazy(() => import('../../../web/src/pages/PublicWork')),
  '/authors/:authorId': lazy(() => import('../../../web/src/pages/PublicAuthor')),
  '/chats': lazy(() => import('../../../web/src/pages/ChatsLanding')),
  '/chats/:sessionId': ChatView,
  '/profile': Profile,
  '/profile/:section': Profile,
  '/profile/legal/:doc': lazy(() => import('../../../web/src/pages/Legal')),
  '/create': lazy(() => import('../../../web/src/pages/Create')),
  '/create/settings': lazy(() => import('../../../web/src/pages/CreatorSettings')),
  '/publications': lazy(() => import('../../../web/src/pages/Publications')),
  '/studio': lazy(() => import('../../../web/src/pages/Studio')),
  '/status': lazy(() => import('../../../web/src/pages/Status')),
  '/research': lazy(() => import('../../../web/src/pages/Research')),
  '/research/benchmarks': lazy(() => import('../../../web/src/pages/BenchmarkLab')),
};

export type ScreenPath = keyof typeof views;
export const screenPaths = Object.keys(views) as ScreenPath[];

export function ScreenView({ path, opening, pending }: { path: ScreenPath; opening?: CharacterOpening; pending?: ReactNode }) {
  const View = views[path];
  const target = useExecutionTarget();
  const owner = useDeviceOwner();
  const administrative = path === '/studio' || path === '/status' ||
    (path.startsWith('/research') && target !== 'device');
  const content = <Suspense fallback={pending ?? <div className="k-page" aria-busy="true" />}>
    <View key={owner} opening={opening} />
  </Suspense>;
  return administrative ? <AdminPage>{content}</AdminPage> : content;
}
