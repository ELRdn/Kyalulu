import { useEffect, useState } from "react";
import ProviderStatus from "../components/ProviderStatus";
import Diagnostics from "../components/Diagnostics";
import Card from "../components/ui/Card";
import { fetchHealth } from "../lib/api";
import { useLanguage } from "../lib/appContext";
import "./pages.css";
import { useDocumentTitle } from "../lib/title";

export default function Status() {
  const en = useLanguage() === 'en';
  useDocumentTitle("Status");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchHealth>> | 'failed' | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth('failed'));
  }, []);

  return (
    <div className="k-page" style={{ maxWidth: 640 }}>
      <div>
        <h1 className="k-page-title">Status</h1>
        <p className="k-page-sub">{en ? 'API / provider status' : 'API / プロバイダの稼働状況'}</p>
      </div>

      <Card>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>API</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>{health === null ? (en ? 'Checking...' : '確認中...') : health === 'failed' ? (en ? 'Not connected (API not started)' : '未接続 (API起動前)') : `${health.status} (v${health.version})`}</div>
      </Card>

      <Diagnostics />

      <ProviderStatus />

      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{en ? 'How to use' : '使い方'}</div>
        <ol style={{ paddingLeft: 18, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.8 }}>
          <li>{en ? 'Create ' : ''}<code>.env</code>{en ? ' by copying ' : ' を作成: '}<code>.env.example</code>{en ? '.' : ' をコピー'}</li>
          <li>{en ? 'To try an external API, set ' : '外部APIで試すなら '}<code>OPENAI_COMPATIBLE_URL</code>{en ? ' and ' : ' と '}<code>OPENAI_COMPATIBLE_API_KEY</code>{en ? '.' : ' を設定'}</li>
          <li>{en ? 'For a local LLM, start Ollama (' : 'ローカルLLMなら Ollama ('}<code>ollama serve</code>{en ? ') or LM Studio.' : ') / LM Studio を起動'}</li>
          <li>{en ? 'You can check the UI with Mock Echo even without an external API or local LLM.' : '何もなくても Mock Echo でUI動作確認できるよ'}</li>
        </ol>
      </Card>
    </div>
  );
}
