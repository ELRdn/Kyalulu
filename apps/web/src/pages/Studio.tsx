import { Link } from "react-router-dom";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { useResearcherMode } from "../lib/mode";
import "./pages.css";

/**
 * Studio導線ページ（最小実装）。
 * モデル選択/プリセット管理/Inspectorの本体ロジックは、現状 ActiveChat.tsx 内の
 * Researcher限定Sheetにそのまま残している（既存state ownershipを崩さないため）。
 * ここは Consumer Chat から視覚的に切り離すための入口としてのみ機能する。
 * 本格的な内部state移設は本リデザイン完了後の別タスクとする。
 */
export default function Studio() {
  const [researcher, setResearcher] = useResearcherMode();

  return (
    <div className="k-page" style={{ maxWidth: 720 }}>
      <div>
        <h1 className="k-page-title">Studio</h1>
        <p className="k-page-sub">モデル選択・プリセット・キャラクター/世界設定・プロンプトInspectorなど、上級者向けの制作機能</p>
      </div>

      <Card>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>Researcherモード</div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            チャット画面右上の ⚙ アイコンから、モデル選択・プリセット管理・キャラクター/ペルソナ/ワールドの割り当て・system prompt直接編集・Inspector（合成済みプロンプトの確認）にアクセスできます。
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button variant={researcher ? "primary" : "secondary"} size="sm" onClick={() => setResearcher(!researcher)}>
              {researcher ? "🔬 Researcherモード ON" : "Researcherモードを有効化"}
            </Button>
            <Link to="/chats"><Button variant="ghost" size="sm">チャットへ移動 →</Button></Link>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>関連ページ</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/research"><Button variant="secondary" size="sm">📊 Research（A/B/C比較・リーダーボード）</Button></Link>
            <Link to="/status"><Button variant="secondary" size="sm">◉ Status（プロバイダ稼働状況）</Button></Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
