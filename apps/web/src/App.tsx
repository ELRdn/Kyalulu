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

// 制作・検証向けの画面は初回表示に不要なので分割して遅延読み込みする
const Create = lazy(() => import("./pages/Create"));
const Studio = lazy(() => import("./pages/Studio"));
const ResearchPage = lazy(() => import("./pages/Research"));
const Status = lazy(() => import("./pages/Status"));

const deferred = (node: ReactNode) => <Suspense fallback={<div className="k-page" aria-busy="true" />}>{node}</Suspense>;

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
        <Route path="/profile" element={<Profile />} />
        <Route path="/studio" element={deferred(<Studio />)} />
        <Route path="/research" element={deferred(<ResearchPage />)} />
        <Route path="/status" element={deferred(<Status />)} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
