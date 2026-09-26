import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Switch from "../components/ui/Switch";
import Icon, { type IconName } from "../components/ui/Icon";
import { useResearcherMode } from "../lib/mode";
import { isModelAvailable, useChatModel } from "../lib/models";
import { useDocumentTitle } from "../lib/title";
import "./pages.css";

const PROVIDER_LABEL: Record<string, string> = {
  mock: "テスト用（オウム返し）",
  ollama: "Ollama（ローカル）",
  lm_studio: "LM Studio（ローカル）",
  le: "LE（ローカル）",
  openai_compatible: "OpenAI互換API",
  responses: "Responses API",
};

/**
 * 上級者向けの入口。会話エンジン（モデル）の切り替えはここだけで行い、
 * 一般画面（ホーム/ディスカバー/チャット）にはモデル名を出さない。
 */
export default function Studio() {
  const [researcher, setResearcher] = useResearcherMode();
  const { models, health, modelId, setModelId, reload, loadFailed } = useChatModel();
  useDocumentTitle("スタジオ");

  return (
    <div className="k-page" style={{ maxWidth: 820 }}>
      <div>
        <div className="k-studio-kicker">上級者向け</div>
        <h1 className="k-page-title">スタジオ</h1>
        <p className="k-page-sub">会話エンジンの切り替えや、プロンプト確認・評価など制作と検証のための機能です。</p>
      </div>

      <section className="k-section">
        <div className="k-section__head">
          <h2 className="k-section__title">
            <span className="k-section__mark">✦</span> 会話エンジン
          </h2>
          <Button variant="ghost" size="sm" onClick={reload}>
            <Icon name="refresh" size={14} /> 接続を再確認
          </Button>
        </div>
        <p className="k-page-sub" style={{ marginTop: -8 }}>
          すべてのチャットで使うAIです。接続できないエンジンを選んでいた場合は、つながるものへ自動で切り替わります。
        </p>
        {loadFailed ? (
          <Card>
            <p className="k-engine-empty">サーバーに接続できませんでした。アプリ（ランタイム）が起動しているか確認してください。</p>
          </Card>
        ) : models.length === 0 ? (
          <div className="k-engine-list">
            {[0, 1, 2].map((i) => (
              <div key={i} className="k-skeleton-row" />
            ))}
          </div>
        ) : (
          <div className="k-engine-list" role="radiogroup" aria-label="会話エンジン">
            {models.map((m) => {
              const available = isModelAvailable(m, health);
              const checking = !health;
              const active = m.id === modelId;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!available && !checking}
                  className={`k-engine ${active ? "is-active" : ""}`}
                  onClick={() => setModelId(m.id)}
                >
                  <span className={`k-engine__dot ${checking ? "is-checking" : available ? "is-ok" : "is-off"}`} aria-hidden="true" />
                  <span className="k-engine__body">
                    <span className="k-engine__name">{m.display_name}</span>
                    <span className="k-engine__meta">
                      {PROVIDER_LABEL[m.provider_type] ?? m.provider_type}
                      {m.quantization ? ` · ${m.quantization}` : ""}
                    </span>
                  </span>
                  <span className="k-engine__state">{active ? <Icon name="check" size={16} /> : checking ? "確認中…" : available ? "" : health?.some(h => h.id === m.provider_type && h.status === "ok") ? "モデル未準備" : "オフライン"}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <Card>
        <div className="k-setting-row">
          <div>
            <div className="k-setting-row__label">Researcherモード</div>
            <div className="k-setting-row__desc">ONにすると、チャット画面のヘッダーに詳細設定（歯車）とデバッグ（Ctrl+Shift+D）が現れます。</div>
          </div>
          <Switch checked={researcher} onChange={setResearcher} label="Researcherモード" />
        </div>
      </Card>

      <div className="k-advanced-links">
        <StudioLink to="/create/settings" icon="pen" label="ペルソナ・世界観" desc="人物像と舞台の作成・保存" />
        <StudioLink to="/research/benchmarks" icon="flask" label="比較実験" desc="記憶の比較・30/50/100ターン" />
        <StudioLink to="/chats" icon="chat" label="チャットで試す" desc="設定を会話で確認" />
        <StudioLink to="/research" icon="flask" label="Research" desc="A/B/C比較・リーダーボード" />
        <StudioLink to="/status" icon="globe" label="Status" desc="プロバイダの稼働状況" />
        <StudioLink to="/create" icon="pen" label="クリエイト" desc="取り込み・編集・書き出し" />
      </div>
    </div>
  );
}

function StudioLink({ to, icon, label, desc }: { to: string; icon: IconName; label: string; desc: string }) {
  return (
    <Link to={to} className="k-advanced-link">
      <span className="k-advanced-link__icon">
        <Icon name={icon} size={16} />
      </span>
      <span>
        <span className="k-advanced-link__label">{label}</span>
        <span className="k-advanced-link__desc">{desc}</span>
      </span>
    </Link>
  );
}
