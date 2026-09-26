import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { fetchModels, fetchScenarios, type ModelInfo } from "../lib/api";
import { labRequest, type BenchmarkJob } from "../lib/lab";
import { useDocumentTitle } from "../lib/title";
import "./lab.css";

const statusLabels: Record<string, string> = { queued: "開始待ち", running: "実行中", completed: "完了", failed: "失敗", cancelled: "中止", interrupted: "再起動により中断", timed_out: "制限時間に到達" };
const active = (j: BenchmarkJob) => ["running", "queued"].includes(j.status);
export default function BenchmarkLab() {
  useDocumentTitle("比較実験");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [scenarios, setScenarios] = useState<Awaited<ReturnType<typeof fetchScenarios>>>([]);
  const [modelIds, setModelIds] = useState<string[]>(["mock-echo"]);
  const [scenario, setScenario] = useState("mocha_memory_001");
  const [memory, setMemory] = useState("compare");
  const [runs, setRuns] = useState(1);
  const [seed, setSeed] = useState(42);
  const [topK, setTopK] = useState(5);
  const [budget, setBudget] = useState(300);
  const [recent, setRecent] = useState(true);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [jobs, setJobs] = useState<BenchmarkJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; id: string } | null>(null);
  const jobsVersion = useRef(0);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchModels(), fetchScenarios()]).then(([m, s]) => { if (alive) { setModels(m); setScenarios(s); } }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = jobsVersion.current;
      try {
        const result = await labRequest<{ jobs: BenchmarkJob[] }>("benchmarks");
        if (alive && version === jobsVersion.current) setJobs(result.jobs);
      } catch (e) { if (alive) setError(String(e)); }
      finally { if (alive) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const start = () => run(async () => {
    const body = { model_ids: modelIds, scenarios: [scenario], runs, seed, memory, history_turn_limit: historyLimit || null,
      memory_options: { top_k: topK, budget_tokens: budget, fill_recent: recent } };
    const key = JSON.stringify(body);
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
    const job = await labRequest<BenchmarkJob>("benchmarks", { method: "POST", body: JSON.stringify({ ...body, request_id: pending.current.id }) });
    pending.current = null;
    jobsVersion.current++;
    setJobs(previous => [job, ...previous.filter(x => x.id !== job.id)]);
  });
  const planned = (scenarios.find(s => s.id === scenario)?.turns ?? 0) * runs * modelIds.length * (memory === "compare" ? 2 : 1);
  return <div className="k-page k-lab">
    <header><Link to="/research">← Research</Link><h1 className="k-page-title">比較実験</h1><p className="k-page-sub">同じシナリオ・シードでモデルと記憶の効果を比較します。実験は画面を閉じても続きます。</p></header>
    {error && <p role="alert" className="k-lab-error">{error}</p>}
    <Card><form className="k-lab-form" onSubmit={e => { e.preventDefault(); void start(); }}>
      <fieldset disabled={busy || jobs.some(active)}><legend>会話モデル（最大3つ）</legend><div className="k-lab-actions">{models.map(m => <label key={m.id}><input type="checkbox" checked={modelIds.includes(m.id)} disabled={!modelIds.includes(m.id) && modelIds.length >= 3} onChange={e => setModelIds(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} />{m.display_name}</label>)}</div></fieldset>
      <div className="k-lab-fields">
        <label>シナリオ<select value={scenario} onChange={e => setScenario(e.target.value)}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.id}（{s.turns}ターン）</option>)}</select></label>
        <label>記憶<select value={memory} onChange={e => setMemory(e.target.value)}><option value="compare">オフとオンを比較</option><option value="off">オフのみ</option><option value="on">オンのみ</option></select></label>
        <label>繰り返し<input type="number" min={1} max={3} value={runs} onChange={e => setRuns(Number(e.target.value))} /></label>
        <label>シード<input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
      </div>
      <details><summary>記憶検索・文脈の条件</summary><div className="k-lab-fields">
        <label>最大記憶数<input type="number" min={1} max={20} value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
        <label>記憶の推定トークン枠<input type="number" min={20} max={4000} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label>
        <label>直近の会話ターン数（0＝全履歴）<input type="number" min={0} max={100} value={historyLimit} onChange={e => setHistoryLimit(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={recent} onChange={e => setRecent(e.target.checked)} />余った記憶枠を新しい記憶で補う</label>
      </div></details>
      <p className="k-page-sub">合計 {planned} ターン。1実験の上限は60分です。Mockは機能確認用で、モデルの品質評価には数えません。キーワード判定と人手の評価は別に扱います。</p>
      <Button type="submit" disabled={busy || !modelIds.length || !scenarios.length || jobs.some(active)}>比較実験を開始</Button>
    </form></Card>
    <h2>実験の進行と結果</h2>
    {!jobs.length && <p>まだ比較実験はありません。</p>}
    {jobs.map(job => <Card key={job.id}>
      <div className="k-lab-actions"><strong>{statusLabels[job.status] ?? job.status}</strong><span>{job.results.length}/{job.planned_runs} 実験 · {job.planned_turns} ターン予定</span>
        <a href={`/api/benchmarks/${job.id}/export`} download>結果JSON</a>
        {active(job) && <Button disabled={busy} variant="secondary" onClick={() => void run(async () => {
          const updated = await labRequest<BenchmarkJob>(`benchmarks/${job.id}/cancel`, { method: "POST" });
          jobsVersion.current++;
          setJobs(all => all.map(x => x.id === job.id ? updated : x));
        })}>実験を中止</Button>}
      </div>
      {job.current && <p aria-live="polite">{job.current.model_id} · 記憶{job.current.memory ? "オン" : "オフ"} · {job.current.turns_completed}/{job.current.turns_planned}ターン</p>}
      {job.error && <p role="alert">実験を続行できませんでした（{job.error}）。接続診断と保存された実験を確認してください。</p>}
      {job.results.length > 0 && <div className="k-lab-table"><table><thead><tr><th>モデル</th><th>記憶</th><th>シード</th><th>想起</th><th>禁止語一致</th><th>平均時間</th><th>状態</th></tr></thead><tbody>{job.results.map(r => <tr key={r.experiment_id}><td>{r.model_id}</td><td>{r.memory_enabled ? "オン" : "オフ"}</td><td>{r.seed}</td><td>{r.metrics.memory ? `${r.metrics.memory.recalled}/${r.metrics.memory.probes}` : "—"}</td><td>{r.metrics.memory?.hallucinated ?? "—"}</td><td>{r.metrics.avg_elapsed_ms == null ? "—" : `${(r.metrics.avg_elapsed_ms / 1000).toFixed(2)}秒`}</td><td>{statusLabels[r.status] ?? r.status}</td></tr>)}</tbody></table></div>}
      <Link to="/research">Researchで発話・記憶の根拠を確認</Link>
    </Card>)}
  </div>;
}
