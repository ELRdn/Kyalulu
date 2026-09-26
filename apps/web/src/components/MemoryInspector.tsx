import type { MemoryTrace } from "../lib/api";
import { MEMORY_TYPE_LABEL } from "./MemoryPanel";
import "./memory.css";

const DECISION: Record<string, string> = {
  injected: "注入",
  recent_fill: "注入(最近)",
  below_threshold: "関連薄",
  over_top_k: "件数超過",
  over_budget: "予算超過",
  unverified: "根拠未確認"
};

const SKIP: Record<string, string> = { duplicate: "重複", too_short: "短すぎ" };

/** 直近ターンの Memory: 保存済み → 検索候補 → 注入 → 返答への反映（推定）と、提案の採否。 */
export default function MemoryInspector({ trace }: { trace: MemoryTrace | null | undefined }) {
  if (!trace) {
    return <div className="k-meminspect">このターンは Memory が無効でした（会話パネルの「覚えていること」で有効化）。</div>;
  }
  const evidenced = new Set(trace.evidenced ?? []);
  return (
    <div className="k-meminspect">
      <div className="k-meminspect__stats">
        <span>scope: {trace.scope}</span>
        <span>保存 {trace.stored_count}</span>
        <span title="記憶本文の推定値。前置きの指示文は含みません。">注入 {trace.injected.length} 件 / 推定 {trace.injected_tokens} tok</span>
        <span>検索 {trace.retrieval_ms} ms</span>
        <span>反映(推定) {evidenced.size}</span>
      </div>
      {trace.candidates.length === 0 && <div>保存済みの記憶はまだありません。</div>}
      {trace.candidates.map((c) => (
        <div key={c.id} className="k-meminspect__row">
          <span className={`k-meminspect__decision k-meminspect__decision--${c.decision}`}>{DECISION[c.decision] ?? c.decision}</span>
          <span>{c.score.toFixed(2)}</span>
          <span className="k-meminspect__content">
            [{MEMORY_TYPE_LABEL[c.type]}] {c.content}
            {evidenced.has(c.id) && <span className="k-meminspect__flag" title="返答が記憶の言葉を含む（推定であり因果の証明ではない）">反映</span>}
            {c.version != null && <small style={{ display: "block", overflowWrap: "anywhere", color: "var(--text-muted)" }}>
              版{c.version} · {c.origin === "model" ? "会話からの提案" : "手動保存"}
              {c.source_session_id && <> · 会話 {c.source_session_id}</>}
              {c.source_turn != null && <> · ターン{c.source_turn}</>}
              {c.updated_at && <> · 更新 {c.updated_at}</>}
            </small>}
          </span>
        </div>
      ))}
      {(trace.decisions?.length ?? 0) > 0 && (
        <>
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>このターンの記憶の提案</div>
          {trace.decisions!.map((d, i) => (
            <div key={i} className="k-meminspect__row">
              <span className="k-meminspect__decision">{d.action === "store" ? "保存" : `見送り(${SKIP[d.reason ?? ""] ?? d.reason})`}</span>
              <span>{d.action === "store" ? (d.supported ? "根拠◯" : "根拠?") : ""}</span>
              <span className="k-meminspect__content">[{MEMORY_TYPE_LABEL[d.type]}] {d.content}</span>
            </div>
          ))}
        </>
      )}
      <div style={{ color: "var(--text-muted)" }}>検索クエリ: {trace.query || "(なし)"}</div>
    </div>
  );
}
