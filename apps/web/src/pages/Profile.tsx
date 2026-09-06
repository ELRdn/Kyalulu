import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fetchSessions, type SessionInfo } from "../lib/api";
import { Input } from "../components/ui/Input";
import Button from "../components/ui/Button";
import Avatar from "../components/ui/Avatar";
import Card from "../components/ui/Card";
import SessionRow from "../components/ui/SessionRow";
import { useDisplayName, setDisplayName } from "../lib/profile";
import { useTheme } from "../lib/theme";
import { useResearcherMode } from "../lib/mode";
import { usePinnedSessions, togglePin } from "../lib/pins";
import "./pages.css";

export default function Profile() {
  const displayName = useDisplayName();
  const [nameDraft, setNameDraft] = useState(displayName);
  const { theme, toggle } = useTheme();
  const [researcher, setResearcher] = useResearcherMode();
  const pinned = usePinnedSessions();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  useEffect(() => {
    setNameDraft(displayName);
  }, [displayName]);

  useEffect(() => {
    fetchSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const pinnedSessions = sessions.filter((s) => pinned.includes(s.session_id));

  return (
    <div className="k-page" style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Avatar name={displayName} size="xl" />
        <div style={{ display: "grid", gap: 6, flex: 1 }}>
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => setDisplayName(nameDraft)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="表示名"
            aria-label="表示名"
            style={{ maxWidth: 280, fontSize: 18, fontWeight: 700 }}
          />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ローカルに保存されるプロフィールです（アカウント同期はまだありません）</div>
        </div>
      </div>

      <section className="k-section">
        <h2 className="k-section__title">✦ 設定</h2>
        <Card>
          <div style={{ display: "grid", gap: 14 }}>
            <Row label="テーマ" desc="ライト / ダークを切り替え">
              <Button variant="secondary" size="sm" onClick={toggle}>
                {theme === "dark" ? "☾ ダーク" : "☀ ライト"}
              </Button>
            </Row>
            <Row label="Researcherモード" desc="Studioの詳細設定・デバッグ表示を有効化">
              <Button variant={researcher ? "primary" : "secondary"} size="sm" onClick={() => setResearcher(!researcher)}>
                {researcher ? "🔬 ON" : "OFF"}
              </Button>
            </Row>
          </div>
        </Card>
      </section>

      {pinnedSessions.length > 0 && (
        <section className="k-section">
          <h2 className="k-section__title">✦ ピン留めしたチャット</h2>
          <div style={{ display: "grid", gap: 4 }}>
            {pinnedSessions.map((s) => (
              <SessionRow
                key={s.session_id}
                sessionId={s.session_id}
                name={s.session_id === "default" ? "きゃるる" : s.session_id}
                preview={s.last_preview}
                time={s.last_at}
                pinned
                onTogglePin={() => togglePin(s.session_id)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="k-section">
        <h2 className="k-section__title">✦ 上級者向け</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link to="/studio"><Button variant="secondary" size="sm">⚙ Studio</Button></Link>
          <Link to="/research"><Button variant="secondary" size="sm">📊 Research</Button></Link>
          <Link to="/status"><Button variant="secondary" size="sm">◉ Status</Button></Link>
        </div>
      </section>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{desc}</div>
      </div>
      {children}
    </div>
  );
}
