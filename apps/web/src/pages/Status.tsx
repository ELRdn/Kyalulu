import { useEffect, useState } from "react";
import ProviderStatus from "../components/ProviderStatus";
import Diagnostics from "../components/Diagnostics";
import Card from "../components/ui/Card";
import { fetchHealth } from "../lib/api";
import { useLanguage } from "../lib/appContext";
import "./pages.css";
import { useDocumentTitle } from "../lib/title";
import { executionTarget } from "../lib/appContext";
import { formatBytes, readyModels } from "../mobile/models";

export default function Status() {
  const en = useLanguage() === 'en';
  useDocumentTitle("Status");
  const [health, setHealth] = useState<Awaited<ReturnType<typeof fetchHealth>> | 'failed' | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth('failed'));
  }, []);

  const [storage, setStorage] = useState<string | null>(null);
  const [engine, setEngine] = useState<boolean | null>(null);
  useEffect(() => {
    void navigator.storage?.estimate?.().then(value => setStorage(formatBytes(value.usage ?? 0))).catch(() => {});
    void readyModels().then(ready => setEngine(ready.size > 0)).catch(() => {});
  }, []);
  const relay = import.meta.env.VITE_RELAY_ORIGIN ? new URL(import.meta.env.VITE_RELAY_ORIGIN).host : '';
  const worker = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  const pc = executionTarget() === 'pc';

  return (
    <div className="k-page k-tool k-tool--narrow">
      <div>
        <div className="k-tool__title"><h1 className="k-page-title">Status</h1><span className="k-studio-kicker">{en ? 'Advanced' : '上級者向け'}</span></div>
        <p className="k-page-sub">{en ? 'Connections, storage and this device at a glance.' : 'つながり・保存・端末の状態をまとめて確認します。'}</p>
      </div>

      <Card className="k-tool__card">
        <h2>{en ? 'Connection' : '接続'}</h2>
        <div className="k-tool__rows">
          <div className="k-tool__row"><span>API</span><span>{health === null ? (en ? 'Checking...' : '確認中...') : health === 'failed' ? (en ? 'Not connected (API not started)' : '未接続 (API起動前)') : `${health.status} (v${health.version})`}</span></div>
          {relay && <div className="k-tool__row"><span>Relay</span><span>{relay}</span></div>}
          <div className="k-tool__row"><span>{en ? 'Your PC' : '自分のPC'}</span><span>{pc ? (en ? 'Selected' : '選択中') : (en ? 'Not connected' : '未接続')}</span></div>
        </div>
      </Card>

      <Card className="k-tool__card">
        <h2>{en ? 'This browser' : 'このブラウザー'}</h2>
        <div className="k-tool__rows">
          <div className="k-tool__row"><span>{en ? 'Storage' : '保存領域'}</span><span>{storage ? `IndexedDB · ${storage}` : '—'}</span></div>
          <div className="k-tool__row"><span>Service Worker</span><span>{worker ? (en ? 'Active' : '有効') : (en ? 'Inactive' : '無効')}</span></div>
          <div className="k-tool__row"><span>{en ? 'On-device engine' : '端末内の会話エンジン'}</span><span>{engine === null ? '—' : engine ? (en ? 'Downloaded' : 'ダウンロード済み') : (en ? 'Not downloaded' : '未ダウンロード')}</span></div>
        </div>
      </Card>

      <Card className="k-tool__card">
        <h2>{en ? 'How to use' : '使い方'}</h2>
        <div className="k-tool__rows">
          <div className="k-tool__row"><span>{en ? 'Try an external API' : '外部APIで試す'}</span><span>{en ? 'Choose Cloud' : 'Cloudを選ぶ'}</span></div>
          <div className="k-tool__row"><span>{en ? 'Try a local LLM' : 'ローカルLLMで試す'}</span><span>{en ? 'Start Ollama / LM Studio' : 'Ollama / LM Studio を起動'}</span></div>
        </div>
      </Card>

      <details className="k-tool__more"><summary>{en ? 'API / provider status' : 'API / プロバイダの稼働状況'}</summary>
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
      </details>
    </div>
  );
}
