import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { RuntimeDownload } from "../components/RuntimeMedia";
import { fetchModels, fetchScenarios, type ModelInfo } from "../lib/api";
import { labRequest, type BenchmarkJob } from "../lib/lab";
import { useDocumentTitle } from "../lib/title";
import { useLanguage, useExecutionTarget, useGenerationBusy } from "../lib/appContext";
import { friendlyMessage } from "../lib/errors";
import "./lab.css";

const active = (j: BenchmarkJob) => ["running", "queued"].includes(j.status);
export default function BenchmarkLab() {
  const language = useLanguage(), en = language === 'en';
  const device=useExecutionTarget()==='device',generating=useGenerationBusy();
  const statusLabels: Record<string, string> = en
    ? { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted by restart", timed_out: "Time limit reached" }
    : { queued: "開始待ち", running: "実行中", completed: "完了", failed: "失敗", cancelled: "中止", interrupted: "再起動により中断", timed_out: "制限時間に到達" };
  useDocumentTitle(en ? "Benchmarks" : "比較実験");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [scenarios, setScenarios] = useState<Awaited<ReturnType<typeof fetchScenarios>>>([]);
  const [modelIds, setModelIds] = useState<string[]>(device?[]:["mock-echo"]);
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
  const [error, setError] = useState<unknown>(null);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const jobsVersion = useRef(0);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchModels(), fetchScenarios()]).then(([m, s]) => { if (alive) { setModels(m); setScenarios(s);if(device)setModelIds(ids=>ids.length?ids:m.filter(model=>model.available!==false).slice(0,1).map(model=>model.id)); } }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [device]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = jobsVersion.current;
      try {
        const result = await labRequest<{ jobs: BenchmarkJob[] }>("benchmarks");
        if (alive && version === jobsVersion.current) setJobs(result.jobs);
      } catch (e) { if (alive) setError(e); }
      finally { if (alive) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); }
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
    <header><Link to="/research">← {en ? "Research" : "研究"}</Link><h1 className="k-page-title">{en ? "Benchmarks" : "比較実験"}</h1><p className="k-page-sub">{device?(en?'Compare prepared on-device models using the same scenario and seed. Runs continue while this tab is open, including on other screens. Closing or reloading the tab interrupts the job; saved results stay on this device.':'準備済みの端末内モデルを、同じシナリオ・シードで比較します。このタブを開いている間は別の画面に移っても続きます。タブを閉じる・再読込すると中断し、保存済み結果は端末に残ります。'):(en ? "Compare models and memory using the same scenario and seed. Experiments continue after you close this page." : "同じシナリオ・シードでモデルと記憶の効果を比較します。実験は画面を閉じても続きます。")}</p></header>
    {device&&<p><Link to="/profile">{en?'Prepare models in Settings':'設定でモデルを準備'}</Link></p>}
    {error != null && <p role="alert" className="k-lab-error">{friendlyMessage(error, language)}</p>}
    <Card><form className="k-lab-form" onSubmit={e => { e.preventDefault(); void start(); }}>
      <fieldset disabled={busy || jobs.some(active)||device&&generating}><legend>{en ? "Conversation models (up to 3)" : "会話モデル（最大3つ）"}</legend><div className="k-lab-actions">{models.map(m => <label key={m.id}><input type="checkbox" checked={modelIds.includes(m.id)} disabled={!modelIds.includes(m.id) && modelIds.length >= 3||device&&m.available===false} onChange={e => setModelIds(ids => e.target.checked ? [...ids, m.id] : ids.filter(id => id !== m.id))} />{m.display_name}</label>)}</div></fieldset>
      <div className="k-lab-fields">
        <label>{en ? "Scenario" : "シナリオ"}<select aria-label={en?'Scenario':'シナリオ'} value={scenario} onChange={e => setScenario(e.target.value)}>{scenarios.map(s => <option key={s.id} value={s.id}>{s.id} ({s.turns}{en ? " turns" : "ターン"})</option>)}</select></label>
        <label>{en ? "Memory" : "記憶"}<select aria-label={en?'Memory':'記憶'} value={memory} onChange={e => setMemory(e.target.value)}><option value="compare">{en ? "Compare off and on" : "オフとオンを比較"}</option><option value="off">{en ? "Off only" : "オフのみ"}</option><option value="on">{en ? "On only" : "オンのみ"}</option></select></label>
        <label>{en ? "Runs" : "繰り返し"}<input type="number" min={1} max={3} value={runs} onChange={e => setRuns(Number(e.target.value))} /></label>
        <label>{en ? "Seed" : "シード"}<input type="number" min={device?0:undefined} max={device?2**32-runs:undefined} value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
      </div>
      <details><summary>{en ? "Memory retrieval and context conditions" : "記憶検索・文脈の条件"}</summary><div className="k-lab-fields">
        <label>{en ? "Maximum memories" : "最大記憶数"}<input type="number" min={1} max={20} value={topK} onChange={e => setTopK(Number(e.target.value))} /></label>
        <label>{en ? "Estimated memory token budget" : "記憶の推定トークン枠"}<input type="number" min={20} max={4000} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label>
        <label>{en ? "Recent conversation turns (0 = all history)" : "直近の会話ターン数（0＝全履歴）"}<input type="number" min={0} max={100} value={historyLimit} onChange={e => setHistoryLimit(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={recent} onChange={e => setRecent(e.target.checked)} />{en ? "Fill remaining memory budget with recent memories" : "余った記憶枠を新しい記憶で補う"}</label>
      </div></details>
      <p className="k-page-sub">{en ? `Total: ${planned} turns. Each experiment is limited to 60 minutes. Mock runs check functionality and do not count as model quality evidence. Keyword checks and human ratings are reported separately.` : `合計 ${planned} ターン。1実験の上限は60分です。Mockは機能確認用で、モデルの品質評価には数えません。キーワード判定と人手の評価は別に扱います。`}</p>
      <Button type="submit" disabled={busy || !modelIds.length || !scenarios.length || jobs.some(active)||device&&generating}>{en ? "Start benchmark" : "比較実験を開始"}</Button>
    </form></Card>
    <h2>{en ? "Progress and results" : "実験の進行と結果"}</h2>
    {!jobs.length && <p>{en ? "No benchmarks yet." : "まだ比較実験はありません。"}</p>}
    {jobs.map(job => <Card key={job.id}>
      <div className="k-lab-actions"><strong>{active(job)&&job.cancel_requested?(en?'Stopping…':'停止要求中'):statusLabels[job.status] ?? job.status}</strong><span>{job.results.length}/{job.planned_runs} {en ? "experiments" : "実験"} · {job.planned_turns} {en ? "planned turns" : "ターン予定"}</span>
        <RuntimeDownload href={`/api/benchmarks/${encodeURIComponent(job.id)}/export`} download>{en ? "Results JSON" : "結果JSON"}</RuntimeDownload>
        {active(job) && <Button disabled={busy||job.cancel_requested} variant="secondary" onClick={() => void run(async () => {
          const updated = await labRequest<BenchmarkJob>(`benchmarks/${job.id}/cancel`, { method: "POST" });
          jobsVersion.current++;
          setJobs(all => all.map(x => x.id === job.id ? updated : x));
        })}>{en ? "Cancel benchmark" : "実験を中止"}</Button>}
      </div>
      {job.current && <p aria-live="polite">{job.current.model_id} · {en ? "Memory " : "記憶"}{job.current.memory ? (en ? "on" : "オン") : (en ? "off" : "オフ")} · {job.current.turns_completed}/{job.current.turns_planned}{en ? " turns" : "ターン"}</p>}
      {job.error && <p role="alert">{en ? `The experiment could not continue (${job.error}). Check connection diagnostics and saved experiments.` : `実験を続行できませんでした（${job.error}）。接続診断と保存された実験を確認してください。`}</p>}
      {job.results.length > 0 && <div className="k-lab-table"><table><thead><tr><th>{en ? "Model" : "モデル"}</th><th>{en ? "Memory" : "記憶"}</th><th>{en ? "Seed" : "シード"}</th><th>{en ? "Recall" : "想起"}</th><th>{en ? "Forbidden-word matches" : "禁止語一致"}</th><th>{en ? "Average latency" : "平均時間"}</th><th>{en ? "Status" : "状態"}</th></tr></thead><tbody>{job.results.map(r => <tr key={r.experiment_id}><td>{r.model_id}</td><td>{r.memory_enabled ? (en ? "On" : "オン") : (en ? "Off" : "オフ")}</td><td>{r.seed}</td><td>{r.metrics.memory ? `${r.metrics.memory.recalled}/${r.metrics.memory.probes}` : "—"}</td><td>{r.metrics.memory?.hallucinated ?? "—"}</td><td>{r.metrics.avg_elapsed_ms == null ? "—" : `${(r.metrics.avg_elapsed_ms / 1000).toFixed(2)}${en ? "s" : "秒"}`}</td><td>{statusLabels[r.status] ?? r.status}</td></tr>)}</tbody></table></div>}
      <Link to="/research">{en ? "Review responses and memory evidence in Research" : "研究画面で発話・記憶の根拠を確認"}</Link>
    </Card>)}
  </div>;
}
