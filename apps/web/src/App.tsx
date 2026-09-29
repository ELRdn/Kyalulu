import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import AppShell from "./layout/AppShell";
import Home from "./pages/Home";
import Discover from "./pages/Discover";
import ChatsLanding from "./pages/ChatsLanding";
import ActiveChat from "./pages/ActiveChat";
import CharacterEntry from "./pages/CharacterEntry";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";
import { useAdministrative } from './components/RuntimeGate';

// 制作・検証向けの画面は初回表示に不要なので分割して遅延読み込みする
const Create = lazy(() => import("./pages/Create"));
const Studio = lazy(() => import("./pages/Studio"));
const ResearchPage = lazy(() => import("./pages/Research"));
const Status = lazy(() => import("./pages/Status"));
const CreatorSettings = lazy(() => import("./pages/CreatorSettings"));
const BenchmarkLab = lazy(() => import("./pages/BenchmarkLab"));

const deferred = (node: ReactNode) => <Suspense fallback={<div className="k-page" aria-busy="true" />}>{node}</Suspense>;
function AdminPage({ children }: { children: ReactNode }) {
  return useAdministrative() ? children : <div className="k-page"><h1>サーバー側で管理する機能です</h1><p>モデルの管理・診断・比較実験は、サーバーを実行しているPCで開いてください。この端末ではキャラの作成と会話を楽しめます。</p></div>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/chats" element={<ChatsLanding />} />
        <Route path="/chats/:sessionId" element={<ActiveChat />} />
        <Route path="/characters/:characterId" element={<CharacterEntry />} />
        <Route path="/create" element={deferred(<Create />)} />
        <Route path="/create/settings" element={deferred(<CreatorSettings />)} />
        <Route path="/research/benchmarks" element={<AdminPage>{deferred(<BenchmarkLab />)}</AdminPage>} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/studio" element={<AdminPage>{deferred(<Studio />)}</AdminPage>} />
        <Route path="/research" element={<AdminPage>{deferred(<ResearchPage />)}</AdminPage>} />
        <Route path="/status" element={<AdminPage>{deferred(<Status />)}</AdminPage>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
