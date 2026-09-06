import { useEffect, useState } from "react";
import ProviderStatus from "../components/ProviderStatus";
import Card from "../components/ui/Card";
import { fetchHealth } from "../lib/api";
import "./pages.css";

export default function Status() {
  const [health, setHealth] = useState("確認中...");

  useEffect(() => {
    fetchHealth()
      .then((d) => setHealth(`${d.status} (v${d.version})`))
      .catch(() => setHealth("未接続 (API起動前)"));
  }, []);

  return (
    <div className="k-page" style={{ maxWidth: 640 }}>
      <div>
        <h1 className="k-page-title">Status</h1>
        <p className="k-page-sub">API / プロバイダの稼働状況</p>
      </div>

      <Card>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>API</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>{health}</div>
      </Card>

      <ProviderStatus />

      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>使い方</div>
        <ol style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          <li><code>.env</code> を作成: <code>.env.example</code> をコピー</li>
          <li>外部APIで試すなら <code>OPENAI_COMPATIBLE_URL</code> と <code>OPENAI_COMPATIBLE_API_KEY</code> を設定</li>
          <li>ローカルLLMなら Ollama (<code>ollama serve</code>) / LM Studio を起動</li>
          <li>何もなくても Mock Echo でUI動作確認できるよ</li>
        </ol>
      </Card>
    </div>
  );
}
