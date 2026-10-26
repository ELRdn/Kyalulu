import type { MemoryTrace } from "../lib/api";
import { MEMORY_TYPE_LABEL } from "./MemoryPanel";
import "./memory.css";
import MemorySource from './MemorySource';
import { useLanguage } from '../lib/appContext';

const DECISION: Record<string, string> = {
  injected: "注入",
  recent_fill: "注入(最近)",
  below_threshold: "関連薄",
  over_top_k: "件数超過",
  over_budget: "予算超過",
  unverified: "根拠未確認"
};

const SKIP: Record<string, string> = { duplicate: "重複", too_short: "短すぎ" };
const DECISION_EN: Record<string, string> = { injected: 'Included', recent_fill: 'Included (recent)', below_threshold: 'Low relevance', over_top_k: 'Count limit', over_budget: 'Token budget', unverified: 'Source unverified' };
const SKIP_EN: Record<string, string> = { duplicate: 'Duplicate', too_short: 'Too short' };

/** 直近ターンの Memory: 保存済み → 検索候補 → 注入 → 返答への反映（推定）と、提案の採否。 */
export default function MemoryInspector({ trace }: { trace: MemoryTrace | null | undefined }) {
  const language = useLanguage(), en = language === 'en', typeLabels = MEMORY_TYPE_LABEL[language];
  const decisions = en ? DECISION_EN : DECISION, skips = en ? SKIP_EN : SKIP;
  if (!trace) {
    return <div className="k-meminspect">{en ? 'Memory was off for this turn. Enable it in the conversation’s Memories panel.' : 'このターンは Memory が無効でした（会話パネルの「覚えていること」で有効化）。'}</div>;
  }
  const evidenced = new Set(trace.evidenced ?? []);
  return (
    <div className="k-meminspect">
      <p>{en ? 'Word matches and estimated use in replies are reference information. “supported” does not prove factuality or source accuracy.' : '語句の一致・返答への反映は参考情報です。supportedは事実性や出典の正しさの証明ではありません。'}</p>
      <div className="k-meminspect__stats">
        <span>{en ? 'Scope: ' : 'scope: '}{trace.scope}</span>
        <span>{en ? 'Stored: ' : '保存 '}{trace.stored_count}</span>
        <span title={en ? 'Estimated memory-body tokens; excludes the preceding instructions.' : '記憶本文の推定値。前置きの指示文は含みません。'}>{en ? `Included: ${trace.injected.length} / estimated ${trace.injected_tokens} tok` : `注入 ${trace.injected.length} 件 / 推定 ${trace.injected_tokens} tok`}</span>
        <span>{en ? 'Retrieval: ' : '検索 '}{trace.retrieval_ms} ms</span>
        <span>{en ? 'Used (estimated): ' : '反映(推定) '}{evidenced.size}</span>
      </div>
      {trace.candidates.length === 0 && <div>{en ? 'No saved memories yet.' : '保存済みの記憶はまだありません。'}</div>}
      {trace.candidates.map((c) => (
        <div key={c.id} className="k-meminspect__row">
          <span className={`k-meminspect__decision k-meminspect__decision--${c.decision}`}>{decisions[c.decision] ?? c.decision}</span>
          <span>{c.score.toFixed(2)}</span>
          <span className="k-meminspect__content">
            [{typeLabels[c.type]}] {c.content}
            <MemorySource memory={c} />
            {evidenced.has(c.id) && <span className="k-meminspect__flag" title={en ? 'The reply contains words from this memory; estimated, not proof of causation.' : '返答が記憶の言葉を含む（推定であり因果の証明ではない）'}>{en ? 'Used (estimated)' : '反映'}</span>}
            {c.version != null && <small style={{ display: "block", overflowWrap: "anywhere", color: "var(--text-muted)" }}>
              {en ? 'Revision ' : '版'}{c.version} · {c.origin === "model" ? (en ? 'Proposed from conversation' : '会話からの提案') : (en ? 'Saved manually' : '手動保存')}
              {c.source_session_id && <> · {en ? 'Conversation ' : '会話 '}{c.source_session_id}</>}
              {c.source_turn != null && <> · {en ? 'Turn ' : 'ターン'}{c.source_turn}</>}
              {c.updated_at && <> · {en ? 'Updated ' : '更新 '}{c.updated_at}</>}
            </small>}
          </span>
        </div>
      ))}
      {(trace.decisions?.length ?? 0) > 0 && (
        <>
          <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>{en ? 'Memory proposals for this turn' : 'このターンの記憶の提案'}</div>
          {trace.decisions!.map((d, i) => (
            <div key={i} className="k-meminspect__row">
              <span className="k-meminspect__decision">{d.action === "store" ? (en ? 'Saved' : '保存') : `${en ? 'Skipped' : '見送り'}(${skips[d.reason ?? ""] ?? d.reason})`}</span>
              <span title={en ? 'Does not prove factuality' : '事実性の証明ではありません'}>{d.action === "store" ? (d.supported ? (en ? 'Word match found' : '語句一致あり') : (en ? 'Word match unverified' : '語句一致未確認')) : ""}</span>
              <span className="k-meminspect__content">[{typeLabels[d.type]}] {d.content}<MemorySource memory={d} /></span>
            </div>
          ))}
        </>
      )}
      <div style={{ color: "var(--text-muted)" }}>{en ? 'Search query: ' : '検索クエリ: '}{trace.query || (en ? '(none)' : '(なし)')}</div>
    </div>
  );
}
