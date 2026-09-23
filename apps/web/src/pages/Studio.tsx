import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Icon, { type IconName } from "../components/ui/Icon";
import { useResearcherMode } from "../lib/mode";
import "./pages.css";

/**
 * Studio導線ページ（最小実装）。
 * モデル選択/プリセット管理/Inspectorの本体ロジックは、現状 ActiveChat.tsx 内の
 * Researcher限定Sheetにそのまま残している（既存state ownershipを崩さないため）。
 * ここは Consumer Chat から視覚的に切り離すための入口としてのみ機能する。
 */
export default function Studio() {
  const [researcher, setResearcher] = useResearcherMode();

  return (
    <div className="k-page" style={{ maxWidth: 780 }}>
      <div>
        <div className="k-studio-kicker">上級者向け</div>
        <h1 className="k-page-title">スタジオ</h1>
        <p className="k-page-sub">モデル選択・プリセット・キャラクター/ワールドの割り当て・プロンプト確認など、制作と検証のための機能です。</p>
      </div>

      <Card>
        <div className="k-setting-row">
          <div>
            <div className="k-setting-row__label">Researcherモード</div>
            <div className="k-setting-row__desc">ONにすると、チャット画面のヘッダーに詳細設定（歯車）とデバッグ（Ctrl+Shift+D）が現れます。</div>
          </div>
          <Button variant={researcher ? "primary" : "secondary"} size="sm" onClick={() => setResearcher(!researcher)} aria-pressed={researcher}>
            {researcher ? "ON" : "OFF"}
          </Button>
        </div>
      </Card>

      <div className="k-advanced-links">
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
