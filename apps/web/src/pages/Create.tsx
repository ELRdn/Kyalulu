import Card from "../components/ui/Card";
import "./pages.css";

const DOMAINS = [
  { icon: "◐", title: "Identity", desc: "名前・種族・年齢などの基本情報" },
  { icon: "♡", title: "Personality", desc: "性格・関係性・感情表現の傾向" },
  { icon: "✦", title: "Speech", desc: "口調・語尾・話し方のクセ" },
  { icon: "✧", title: "World / Scenario", desc: "舞台となる世界観とシナリオ" },
  { icon: "◔", title: "Visual", desc: "見た目・アートワークの方向性" },
  { icon: "❞", title: "Dialogue samples", desc: "サンプル会話・イントロ" },
];

export default function Create() {
  return (
    <div className="k-page" style={{ maxWidth: 880 }}>
      <div>
        <h1 className="k-page-title">Create</h1>
        <p className="k-page-sub">Character Sheet Builder — キャラクターを一から作る場所</p>
      </div>

      <Card>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-primary)" }}>✦ 近日公開</div>
          <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8 }}>
            Kyaluluのキャラクター作成体験は、単なるフォームではなく「Character Sheet Builder」として設計中です。
            現時点ではキャラクター作成APIがまだ無いため、この画面はプレースホルダーです。
            将来的には以下のドメインを順番に組み立てていく体験になる予定です。
          </p>
        </div>
      </Card>

      <div className="k-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {DOMAINS.map((d) => (
          <Card key={d.title}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 20 }} aria-hidden="true">{d.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{d.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>{d.desc}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
