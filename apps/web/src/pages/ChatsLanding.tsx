import { useEffect, useMemo, useState } from "react";
import { fetchSessions, type SessionInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import SessionRow from "../components/ui/SessionRow";
import EmptyState from "../components/ui/EmptyState";
import Button from "../components/ui/Button";
import { usePinnedSessions, togglePin } from "../lib/pins";
import { useNavigate } from "react-router-dom";
import { startNewSession } from "../lib/session";
import "./pages.css";

export default function ChatsLanding() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const pinned = usePinnedSessions();
  const navigate = useNavigate();

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withData = sessions.filter((s) => s.count > 0 || s.session_id === "default");
    const list = q ? withData.filter((s) => s.session_id.toLowerCase().includes(q) || (s.last_preview ?? "").toLowerCase().includes(q)) : withData;
    return [...list].sort((a, b) => {
      const ap = pinned.includes(a.session_id) ? 0 : 1;
      const bp = pinned.includes(b.session_id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (b.last_at ?? "").localeCompare(a.last_at ?? "");
    });
  }, [sessions, query, pinned]);

  const handleNew = async () => {
    const id = await startNewSession();
    navigate(`/chats/${encodeURIComponent(id)}`);
  };

  return (
    <div className="k-page" style={{ maxWidth: 720 }}>
      <div className="k-toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 className="k-page-title">チャット</h1>
          <p className="k-page-sub">これまでの会話を続けよう</p>
        </div>
        <Button variant="primary" onClick={handleNew}>
          ＋ 新しいチャット
        </Button>
      </div>

      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="チャットを検索..." aria-label="チャットを検索" />

      {loading ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>読み込み中...</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          motif="✧"
          title="まだチャットがありません"
          description="Discoverでキャラクターを見つけて、最初の会話を始めよう。"
          action={
            <Button variant="secondary" onClick={() => navigate("/discover")}>
              Discoverへ
            </Button>
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 4 }}>
          {filtered.map((s) => (
            <SessionRow
              key={s.session_id}
              sessionId={s.session_id}
              name={s.session_id === "default" ? "きゃるる" : s.session_id}
              preview={s.last_preview}
              time={s.last_at}
              pinned={pinned.includes(s.session_id)}
              onTogglePin={() => togglePin(s.session_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
