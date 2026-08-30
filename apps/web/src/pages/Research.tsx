import { useEffect, useState } from "react";
import {
  fetchExperiments,
  fetchExperimentDetail,
  putRating,
  runExperiments,
  fetchModels,
  fetchScenarios,
  fetchLeaderboard,
  type ExperimentMeta,
  type ExperimentDetail,
  type Leaderboard,
} from "../lib/api";
import MarkdownView from "../components/MarkdownView";

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 16,
            color: n <= value ? "#f59e0b" : "var(--border-strong)",
            lineHeight: 1,
          }}
          title={`${n}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function ExperimentColumn({
  expId,
  syncTurn,
  onSyncTurn,
}: {
  expId: string;
  syncTurn: number | null;
  onSyncTurn: (t: number) => void;
}) {
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expId) return;
    setLoading(true);
    fetchExperimentDetail(expId)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [expId]);

  if (!expId) return <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 13 }}>未選択</div>;
  if (loading) return <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 13 }}>読込中…</div>;
  if (!detail) return <div style={{ padding: 24, color: "var(--error-text)", fontSize: 13 }}>取得失敗</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {/* sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--bg-card)", borderBottom: "1px solid var(--border)", padding: "10px 12px", display: "grid", gap: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: "var(--text)", wordBreak: "break-all" }}>{detail.meta.experiment_id}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>model: <code>{detail.meta.model_id}</code></span>
          <span>scenario: <code>{detail.meta.scenario_id}</code></span>
          <span>run#{detail.meta.run_number}</span>
          <span>{detail.meta.character_id ?? "-"}/{detail.meta.world_id ?? "-"}</span>
        </div>
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{detail.meta.timestamp as string} · {detail.turns.length} turns · {detail.meta.prompt_version as string}</div>
        {((detail as any).metrics || (detail.meta as any).metrics) && (
          <div style={{ fontSize: 10, color: "var(--text-dim)", display: "flex", gap: 8, flexWrap: "wrap", background: "var(--bg-subtle)", padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)" }}>
            {(() => { const m = (detail as any).metrics || (detail.meta as any).metrics; return (
              <>
                <span>chars {m.avg_chars} avg</span>
                <span>fail {m.failure_rate}</span>
                <span>empty {m.empty_rate}</span>
                {m.repetition_score !== null && <span>rep {m.repetition_score}</span>}
                {m.avg_elapsed_ms !== null && <span>{m.avg_elapsed_ms}ms avg</span>}
              </>
            )})()}
          </div>
        )}
        <details style={{ fontSize: 11 }}>
          <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>raw prompt</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 10, background: "var(--bg-subtle)", padding: 8, borderRadius: 6, marginTop: 6, maxHeight: 180, overflow: "auto", border: "1px solid var(--border)" }}>{detail.raw_prompt}</pre>
        </details>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "grid", gap: 14, alignContent: "start" }}>
        {detail.turns.map((t) => {
          const isActive = syncTurn === t.turn;
          const rating = detail.ratings[String(t.turn)];
          return (
            <div
              key={t.turn}
              onClick={() => onSyncTurn(t.turn)}
              style={{
                border: isActive ? "1px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--bg-card)",
                overflow: "hidden",
                boxShadow: isActive ? "0 0 0 2px rgba(0,0,0,0.04)" : "none",
                cursor: "pointer",
              }}
            >
              <div style={{ padding: "8px 10px", background: "var(--bg-subtle)", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                  T{t.turn} <span style={{ fontWeight: 400, color: "var(--text-dim)", fontSize: 10, marginLeft: 6 }}>{t.type}</span>
                </span>
                <span style={{ fontSize: 10, color: "var(--text-faint)" }}>{t.elapsed_ms}ms · {(t.state as any)?.relationship ?? "-"}</span>
              </div>
              <div style={{ padding: 10, display: "grid", gap: 8 }}>
                <div style={{ background: "var(--user-bg)", color: "var(--user-text)", borderRadius: 10, padding: "8px 10px", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{t.user}</div>
                <div style={{ background: "var(--assistant-bg)", color: "var(--assistant-text)", border: "1px solid var(--assistant-border)", borderRadius: 10, padding: "8px 10px", fontSize: 12, lineHeight: 1.6 }}>
                  <MarkdownView content={t.assistant} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Stars
                    value={rating?.score ?? 0}
                    onChange={async (n) => {
                      await putRating(detail.meta.experiment_id as string, t.turn, n);
                      // 楽観更新
                      setDetail((prev) => (prev ? { ...prev, ratings: { ...prev.ratings, [String(t.turn)]: { score: n, comment: "" } } } : prev));
                    }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{rating ? `${rating.score}/5` : "未評価"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ResearchPage() {
  const [exps, setExps] = useState<ExperimentMeta[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [scenarios, setScenarios] = useState<{ id: string; nsfw?: boolean }[]>([]);
  const [runScenario, setRunScenario] = useState("");
  const [runModel, setRunModel] = useState("");
  const [runs, setRuns] = useState(3);
  const [running, setRunning] = useState(false);
  const [syncTurn, setSyncTurn] = useState<number | null>(null);
  const [syncScroll, setSyncScroll] = useState(false);
  const [showNsfw, setShowNsfw] = useState(false);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [boardScope, setBoardScope] = useState<"official" | "all">("official");

  const load = async () => {
    const [e, m, s, b] = await Promise.all([fetchExperiments(50, showNsfw), fetchModels().catch(() => []), fetchScenarios(showNsfw).catch(() => []), fetchLeaderboard(boardScope).catch(() => null)]);
    setExps(e);
    setModels(m as any);
    setScenarios(s as any);
    if (b) setBoard(b);
    if (s.length && !runScenario) setRunScenario(s[0].id);
    if ((m as any).length && !runModel) setRunModel((m as any)[0].id);
    if (e.length >= 3 && selected.length === 0) {
      setSelected(e.slice(0, 3).map((x) => x.experiment_id));
    }
  };

  const reloadBoard = async (scope: "official" | "all") => {
    setBoardScope(scope);
    try {
      const b = await fetchLeaderboard(scope);
      setBoard(b);
    } catch {}
  };

  useEffect(() => {
    load();
  }, [showNsfw]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleRun = async () => {
    if (!runScenario || !runModel) return;
    setRunning(true);
    try {
      const res = await runExperiments(runScenario, runModel, runs);
      // 新しい実験を先頭に追加
      await load();
      if (res.length) setSelected(res.map((r: any) => r.experiment_id).slice(0, 3));
    } finally {
      setRunning(false);
    }
  };

  const cols: [string | undefined, string | undefined, string | undefined] = [selected[0], selected[1], selected[2]];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "var(--bg)" }}>
      {/* ツールバー */}
      <div style={{ padding: 12, borderBottom: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Research — A/B/C</div>
        <span style={{ fontSize: 11, color: "var(--text-dim)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 99 }}>{exps.length} experiments</span>
        <label style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", color: showNsfw ? "var(--error-text)" : "var(--text-dim)" }}>
          <input type="checkbox" checked={showNsfw} onChange={(e) => setShowNsfw(e.target.checked)} /> NSFW
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select value={runScenario} onChange={(e) => setRunScenario(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", fontSize: 12 }}>
            {scenarios.map((s: any) => (
              <option key={s.id} value={s.id}>{s.id}{s.nsfw ? " 🔞" : ""}</option>
            ))}
          </select>
          <select value={runModel} onChange={(e) => setRunModel(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", fontSize: 12 }}>
            {models.map((m: any) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
          <label style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center" }}>
            runs <input type="number" min={1} max={3} value={runs} onChange={(e) => setRuns(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))} style={{ width: 48, padding: "4px 6px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", fontSize: 12 }} />
          </label>
          <button onClick={handleRun} disabled={running} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: running ? "var(--border)" : "var(--accent)", color: running ? "var(--text-dim)" : "var(--accent-text)", fontSize: 12, cursor: running ? "not-allowed" : "pointer" }}>
            {running ? "実行中..." : "▶ 実行"}
          </button>
          <button onClick={load} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", fontSize: 12, cursor: "pointer" }}>↻</button>
          <label style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={syncScroll} onChange={(e) => setSyncScroll(e.target.checked)} /> 同期
          </label>
        </div>
      </div>

      {/* 実験一覧（折りたたみ） */}
      <details open style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
        <summary style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>実験一覧（最大3件選択 → 下にA/B/Cで比較） — 選択: {selected.length}/3</summary>
        <div style={{ padding: "0 12px 12px", display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
          {exps.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 8 }}>まだ experiments がありません。上の「▶ 実行」で作成してね。</div>}
          {exps.map((e) => {
            const active = selected.includes(e.experiment_id);
            const isNsfw = (e as any).nsfw;
            return (
              <label key={e.experiment_id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, border: active ? "1px solid var(--accent)" : isNsfw ? "1px solid var(--error-border)" : "1px solid var(--border)", background: active ? "var(--bg-card)" : "var(--bg-card)", cursor: "pointer" }}>
                <input type="checkbox" checked={active} onChange={() => toggleSelect(e.experiment_id)} />
                <span style={{ fontSize: 11, fontWeight: 600, color: isNsfw ? "var(--error-text)" : "var(--text)", flex: 1, wordBreak: "break-all" }}>{e.experiment_id}{isNsfw ? " 🔞" : ""}</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{e.scenario_id} · {e.model_id} · run{e.run_number} · {String(e.timestamp ?? "").slice(0, 19).replace("T", " ")}</span>
              </label>
            );
          })}
        </div>
      </details>

      {/* M6: 公式リーダーボード */}
      <details open style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
        <summary style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--text)", display: "flex", gap: 8, alignItems: "center" }}>
          🏆 リーダーボード <span style={{ fontWeight: 400, fontSize: 10, color: "var(--text-dim)" }}>{board ? `${board.ranking.length} models · ${board.total_experiments} exps` : "読込中..."}</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }} onClick={(e) => e.preventDefault()}>
            <button onClick={() => reloadBoard("official")} style={{ padding: "3px 8px", borderRadius: 6, border: boardScope === "official" ? "1px solid var(--accent)" : "1px solid var(--border)", background: boardScope === "official" ? "var(--accent)" : "var(--bg-subtle)", color: boardScope === "official" ? "var(--accent-text)" : "var(--text)", fontSize: 10, cursor: "pointer" }}>official (SFW)</button>
            <button onClick={() => reloadBoard("all")} style={{ padding: "3px 8px", borderRadius: 6, border: boardScope === "all" ? "1px solid var(--accent)" : "1px solid var(--border)", background: boardScope === "all" ? "var(--accent)" : "var(--bg-subtle)", color: boardScope === "all" ? "var(--accent-text)" : "var(--text)", fontSize: 10, cursor: "pointer" }}>all (参考)</button>
          </span>
        </summary>
        <div style={{ padding: "8px 12px", overflowX: "auto" }}>
          {!board || board.ranking.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)", padding: 8 }}>{boardScope === "official" ? "SFWデータがありません。SFWシナリオで実験を実行してね。" : "データがありません。"}</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ color: "var(--text-faint)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "4px 6px" }}>#</th>
                  <th style={{ padding: "4px 6px" }}>model</th>
                  <th style={{ padding: "4px 6px" }}>runs</th>
                  <th style={{ padding: "4px 6px" }}>human</th>
                  <th style={{ padding: "4px 6px" }}>auto 0-100</th>
                  <th style={{ padding: "4px 6px" }}>avg chars</th>
                  <th style={{ padding: "4px 6px" }}>failure</th>
                  <th style={{ padding: "4px 6px" }}>repetition</th>
                </tr>
              </thead>
              <tbody>
                {board.ranking.map((r, i) => (
                  <tr key={r.model_id} style={{ borderBottom: "1px solid var(--border)", background: i === 0 ? "var(--bg-subtle)" : "transparent" }}>
                    <td style={{ padding: "4px 6px", fontWeight: 700 }}>{i + 1}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}><code>{r.model_id}</code></td>
                    <td style={{ padding: "4px 6px" }}>{r.runs}</td>
                    <td style={{ padding: "4px 6px", color: r.avg_human !== null ? "var(--text)" : "var(--text-faint)" }}>{r.avg_human ?? "-"}</td>
                    <td style={{ padding: "4px 6px" }}>{r.auto_score ?? "-"}</td>
                    <td style={{ padding: "4px 6px" }}>{r.avg_chars ?? "-"}</td>
                    <td style={{ padding: "4px 6px" }}>{r.avg_failure_rate ?? "-"}</td>
                    <td style={{ padding: "4px 6px" }}>{r.avg_repetition ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {board && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>{board.generated_at.slice(0, 19).replace("T", " ")} · scope={board.scope}</div>}
        </div>
      </details>

      {/* A/B/C グリッド */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: "1px solid var(--border)" }}>
        {(["A", "B", "C"] as const).map((label, idx) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: idx < 2 ? "1px solid var(--border)" : "none", background: "var(--bg)" }}>
            <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)", fontWeight: 700, fontSize: 12, display: "flex", justifyContent: "space-between" }}>
              <span>{label} {cols[idx] ? "" : "(空)"}</span>
              {cols[idx] && <span style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 400 }}>{cols[idx]!.slice(0, 24)}…</span>}
            </div>
            <div
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}
              // 同期スクロールは簡易：syncTurnでハイライトのみ。完全なscroll同期は将来
            >
              <ExperimentColumn expId={cols[idx] ?? ""} syncTurn={syncScroll ? syncTurn : null} onSyncTurn={setSyncTurn} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
