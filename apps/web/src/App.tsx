import { useEffect, useState } from "react";
import ChatPage from "./pages/Chat";
import ResearchPage from "./pages/Research";
import ProviderStatus from "./components/ProviderStatus";
import { fetchHealth } from "./lib/api";
import { useTheme } from "./lib/theme";

type Tab = "chat" | "research" | "status";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [health, setHealth] = useState<string>("確認中...");
  const { theme, toggle } = useTheme();
  const [researcher, setResearcher] = useState<boolean>(() => localStorage.getItem("my-zeta-researcher") === "1");

  useEffect(() => {
    fetchHealth()
      .then((d) => setHealth(`${d.status} (v${d.version})`))
      .catch(() => setHealth("未接続 (API起動前)"));
  }, []);

  useEffect(() => {
    localStorage.setItem("my-zeta-researcher", researcher ? "1" : "0");
  }, [researcher]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)" }}>
      {/* ヘッダー */}
      <header
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-card)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Kyalulu</div>
          <span style={{ fontSize: 11, color: "var(--text-dim)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 99 }}>
            M7
          </span>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{health}</span>
          <span style={{ fontSize: 10, color: researcher ? "var(--accent)" : "var(--text-faint)", border: `1px solid ${researcher ? "var(--accent)" : "var(--border)"}`, padding: "2px 6px", borderRadius: 99 }}>{researcher ? "Researcher" : "Beginner"}</span>
        </div>
        <nav style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setTab("chat")}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: tab === "chat" ? "var(--accent)" : "var(--bg-card)",
              color: tab === "chat" ? "var(--accent-text)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            チャット
          </button>
          <button
            onClick={() => setTab("research")}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: tab === "research" ? "var(--accent)" : "var(--bg-card)",
              color: tab === "research" ? "var(--accent-text)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Research
          </button>
          <button
            onClick={() => setTab("status")}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: tab === "status" ? "var(--accent)" : "var(--bg-card)",
              color: tab === "status" ? "var(--accent-text)" : "var(--text-muted)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ステータス
          </button>
          <button
            onClick={() => setResearcher((v) => !v)}
            title={researcher ? "Beginnerモードに切替" : "Researcherモードに切替"}
            aria-label="Researcher切替"
            style={{
              marginLeft: 4,
              padding: "0 8px",
              height: 32,
              borderRadius: 8,
              border: researcher ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: researcher ? "var(--accent)" : "var(--bg-card)",
              color: researcher ? "var(--accent-text)" : "var(--text)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
            }}
          >
            {researcher ? "🔬 Researcher" : "😊 Beginner"}
          </button>
          <button
            onClick={toggle}
            title={theme === "dark" ? "ライトモードに切替" : "ダークモードに切替"}
            aria-label="テーマ切替"
            style={{
              marginLeft: 4,
              width: 36,
              height: 32,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-card)",
              color: "var(--text)",
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </nav>
      </header>

      {/* メイン */}
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
        {tab === "chat" ? (
          <ChatPage researcher={researcher} />
        ) : tab === "research" ? (
          <ResearchPage />
        ) : (
          <div style={{ padding: 16, maxWidth: 720, margin: "0 auto", width: "100%", display: "grid", gap: 16 }}>
            <ProviderStatus />
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--bg-card)" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>使い方</div>
              <ol style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                <li>
                  <code>.env</code> を作成: <code>.env.example</code> をコピー
                </li>
                <li>
                  外部APIで試すなら <code>OPENAI_COMPATIBLE_URL</code> と <code>OPENAI_COMPATIBLE_API_KEY</code> を設定
                </li>
                <li>
                  ローカルLLMなら Ollama (<code>ollama serve</code>) / LM Studio を起動
                </li>
                <li>何もなくても Mock Echo でUI動作確認できるよ</li>
              </ol>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--bg-subtle)" }}>
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>API</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.6 }}>
                <div>
                  <code>GET /api/health</code> / <code>GET /api/models</code> / <code>GET /api/providers/health</code>
                </div>
                <div>
                  <code>POST /api/chat/stream</code> (SSE) / <code>POST /api/chat</code> (non-stream) /{" "}
                  <code>GET /api/chat/history</code>
                </div>
                <div>
                  <code>GET /api/experiments</code> / <code>GET /api/experiments/{"{id}"}</code> / <code>POST /api/ratings</code>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
