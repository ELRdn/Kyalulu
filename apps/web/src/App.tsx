import { Routes, Route } from "react-router-dom";
import AppShell from "./layout/AppShell";
import Home from "./pages/Home";
import Discover from "./pages/Discover";
import ChatsLanding from "./pages/ChatsLanding";
import ActiveChat from "./pages/ActiveChat";
import CharacterEntry from "./pages/CharacterEntry";
import Create from "./pages/Create";
import Profile from "./pages/Profile";
import Studio from "./pages/Studio";
import ResearchPage from "./pages/Research";
import Status from "./pages/Status";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/chats" element={<ChatsLanding />} />
        <Route path="/chats/:sessionId" element={<ActiveChat />} />
        <Route path="/characters/:characterId" element={<CharacterEntry />} />
        <Route path="/create" element={<Create />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/research" element={<ResearchPage />} />
        <Route path="/status" element={<Status />} />
      </Route>
    </Routes>
  );
}
