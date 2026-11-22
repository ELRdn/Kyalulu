import { useEffect, useState } from "react";
import { fetchExperiments, fetchPersonas, fetchWorlds, type ExperimentMeta } from "../lib/api";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { isModelAvailable, useChatModel } from "../lib/models";
import { useDocumentTitle } from "../lib/title";
import { useLanguage } from "../lib/appContext";
import "./pages.css";

const PROVIDER_LABEL: Record<'ja' | 'en', Record<string, string>> = { ja: {
  mock: "テスト用（オウム返し）",
  ollama: "Ollama（ローカル）",
  lm_studio: "LM Studio（ローカル）",
  le: "LE（ローカル）",
  openai_compatible: "OpenAI互換API",
  responses: "Responses API",
}, en: {
  mock: "Test (echo)",
  ollama: "Ollama (local)",
  lm_studio: "LM Studio (local)",
  le: "LE (local)",
  openai_compatible: "OpenAI-compatible API",
  responses: "Responses API",
} };

/** P11: conversation engines and settings at a glance, outside any conversation. */
export default function Studio() {
  const language = useLanguage(), en = language === 'en';
  const { models, health, modelId, setModelId, reload, loadFailed } = useChatModel();
  useDocumentTitle(en ? "Studio" : "スタジオ");
  const [counts, setCounts] = useState<{ personas: number; worlds: number } | null>(null);
  const [runs, setRuns] = useState<ExperimentMeta[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all([fetchPersonas(), fetchWorlds()]).then(([personas, worlds]) => { if (active) setCounts({ personas: personas.length, worlds: worlds.length }); }).catch(() => {});
    fetchExperiments().then(list => { if (active) setRuns(list); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const last = runs[0];
  const lastModels = last ? new Set(runs.filter(run => run.scenario_id === last.scenario_id).map(run => run.model_id)).size : 0;
  const providerState = (status: string) => status === 'ok' ? (en ? 'OK' : '正常') : status === 'not_configured' ? (en ? 'Not set up' : '未設定') : (en ? 'Offline' : '未接続');

  return (
    <div className="k-page k-tool">
      <div>
        <div className="k-tool__title"><h1 className="k-page-title">Studio</h1><span className="k-studio-kicker">{en ? 'Advanced' : '上級者向け'}</span></div>
        <p className="k-page-sub">{en ? 'Review conversation engines and settings outside any conversation.' : '会話エンジンと設定を、会話の外でまとめて確認します。'}</p>
      </div>

      <div className="k-tool__grid">
        <section className="k-tool__card">
          <h2>{en ? 'Conversation engine' : '会話エンジン'}</h2>
          {loadFailed ? (
            <p className="k-engine-empty">{en ? 'Could not connect to the server. Check that the app (runtime) is running.' : 'サーバーに接続できませんでした。アプリ（ランタイム）が起動しているか確認してください。'}</p>
          ) : models.length === 0 ? (
            <div className="k-engine-list">{[0, 1, 2].map((i) => <div key={i} className="k-skeleton-row" />)}</div>
          ) : (
            <div className="k-tool__rows" role="radiogroup" aria-label={en ? 'Conversation engine' : '会話エンジン'}>
              {models.map((m) => {
                const available = isModelAvailable(m, health);
                const checking = !health;
                const active = m.id === modelId;
                return (
                  <button key={m.id} type="button" role="radio" aria-checked={active} disabled={!available && !checking} className={`k-tool__row k-tool__engine${active ? ' is-active' : ''}`} onClick={() => setModelId(m.id)} title={[PROVIDER_LABEL[language][m.provider_type] ?? m.provider_type, m.quantization].filter(Boolean).join(' · ')}>
                    <span>{m.display_name}</span>
                    <span>{active ? (en ? 'Ready' : '準備完了') : checking ? (en ? 'Checking…' : '確認中…') : available ? '' : health?.some(h => h.id === m.provider_type && h.status === "ok") ? (en ? 'Model not ready' : 'モデル未準備') : (en ? 'Offline' : '未接続')}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <Link to="/status" className="k-tool__card">
          <h2>{en ? 'Provider status' : 'プロバイダの稼働状況'}</h2>
          <div className="k-tool__rows">{(health ?? []).map(h => <div className="k-tool__row" key={h.id}><span>{PROVIDER_LABEL[language][h.id] ?? h.id}</span><span>{providerState(h.status)}</span></div>)}</div>
        </Link>
        <Link to="/create/settings" className="k-tool__card">
          <h2>{en ? 'Personas & worlds' : 'ペルソナ・世界観'}</h2>
          <div className="k-tool__rows">
            <div className="k-tool__row"><span>{en ? 'Personas' : '人物像'}</span><span>{counts ? (en ? counts.personas : `${counts.personas}件`) : '—'}</span></div>
            <div className="k-tool__row"><span>{en ? 'Worlds' : '世界観'}</span><span>{counts ? (en ? counts.worlds : `${counts.worlds}件`) : '—'}</span></div>
          </div>
        </Link>
        <section className="k-tool__card">
          <h2><Link to="/research/benchmarks">{en ? 'Comparison experiments' : '比較実験'}</Link></h2>
          <div className="k-tool__rows">
            <div className="k-tool__row"><span>{en ? 'Latest run' : '最後の実験'}</span><span>{last?.timestamp ? `${new Date(last.timestamp).toLocaleDateString(language, { month: 'long', day: 'numeric' })} · ${en ? `${lastModels} models` : `${lastModels}モデル`}` : '—'}</span></div>
            <div className="k-tool__row"><span>{en ? 'Results' : '結果'}</span><Link to="/research">{en ? 'View in Research' : 'Researchで見る'}</Link></div>
          </div>
        </section>
      </div>

      <Button variant="secondary" className="k-tool__recheck" onClick={reload}>{en ? 'Recheck connection' : '接続を再確認'}</Button>
    </div>
  );
}
