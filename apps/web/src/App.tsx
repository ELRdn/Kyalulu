import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import AppShell from "./layout/AppShell";
import Home from "./pages/Home";
import Discover from "./pages/Discover";
import ChatsLanding from "./pages/ChatsLanding";
import ActiveChat from "./pages/ActiveChat";
import CharacterEntry from "./pages/CharacterEntry";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import { useAdministrative, useRuntimeAccess } from './components/RuntimeGate';
import { subscribeAppAnalyticsPageView, syncAppAnalytics } from './lib/analytics';
import { useLanguage, useExecutionTarget, useDeviceOwner } from './lib/appContext';

// 制作・検証向けの画面は初回表示に不要なので分割して遅延読み込みする
const Create = lazy(() => import("./pages/Create"));
const Studio = lazy(() => import("./pages/Studio"));
const ResearchPage = lazy(() => import("./pages/Research"));
const Status = lazy(() => import("./pages/Status"));
const CreatorSettings = lazy(() => import("./pages/CreatorSettings"));
const BenchmarkLab = lazy(() => import("./pages/BenchmarkLab"));
const PublicWork = lazy(() => import('./pages/PublicWork'));
const PublicAuthor = lazy(() => import('./pages/PublicAuthor'));
const Migration = lazy(() => import('./pages/Migration'));
const Publications = lazy(() => import('./pages/Publications'));
const Published = lazy(() => import('./pages/Published'));
const PublishedDetail = lazy(() => import('./pages/Published').then(module=>({default:module.PublishedDetail})));

const deferred = (node: ReactNode) => <Suspense fallback={<div className="k-page" aria-busy="true" />}>{node}</Suspense>;
function AdminPage({ children }: { children: ReactNode }) {
  const en = useLanguage() === 'en';
  return useAdministrative() ? children : <div className="k-page"><h1>{en ? 'This feature requires PC management access' : 'サーバー側で管理する機能です'}</h1><p>{en ? 'Open model management, diagnostics and comparison experiments on the PC running the server. Character creation and conversations are available on this device.' : 'モデルの管理・診断・比較実験は、サーバーを実行しているPCで開いてください。この端末ではキャラの作成と会話を楽しめます。'}</p></div>;
}

export default function App() {
  const location = useLocation();
  const { cloud_mode } = useRuntimeAccess();
  const target = useExecutionTarget();
  const owner = useDeviceOwner();
  useEffect(() => { syncAppAnalytics(); }, [cloud_mode]);
  useEffect(() => subscribeAppAnalyticsPageView(location.key, location.pathname), [location.key, location.pathname, cloud_mode]);
  return (
    <>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/published" element={deferred(<Published />)} />
        <Route path="/published/:publicationId" element={deferred(<PublishedDetail />)} />
        <Route path="/publications" element={deferred(<Publications />)} />
        <Route path="/works/:workId" element={deferred(<PublicWork />)} />
        <Route path="/authors/:authorId" element={deferred(<PublicAuthor />)} />
        <Route path="/chats" element={<ChatsLanding />} />
        <Route path="/chats/:sessionId" element={<ActiveChat />} />
        <Route path="/characters/:characterId" element={<CharacterEntry />} />
        <Route path="/create" element={deferred(<Create />)} />
        <Route path="/create/settings" element={deferred(<CreatorSettings key={owner} />)} />
        <Route path="/research/benchmarks" element={target==='device'?deferred(<BenchmarkLab key={owner} />):<AdminPage>{deferred(<BenchmarkLab />)}</AdminPage>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/migration" element={deferred(<Migration />)} />
        <Route path="/studio" element={<AdminPage>{deferred(<Studio />)}</AdminPage>} />
        <Route path="/research" element={target==='device'?deferred(<ResearchPage key={owner} />):<AdminPage>{deferred(<ResearchPage />)}</AdminPage>} />
        <Route path="/status" element={<AdminPage>{deferred(<Status />)}</AdminPage>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </>
  );
}
