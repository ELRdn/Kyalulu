"""Experiments API — POST run + GET list"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from python.core.experiment import load_scenario, run_single, save_experiment, list_experiments

router = APIRouter()

class RunRequest(BaseModel):
    scenario: str  # id or path
    model_id: str
    runs: int = 1
    temperature: float | None = None
    seed: int | None = None
    extra_system_prompt: str | None = None

@router.post("/experiments/run")
async def run_experiments(req: RunRequest):
    if req.runs < 1 or req.runs > 10:
        return JSONResponse(status_code=400, content={"error": "runs must be 1..10"})
    try:
        scenario = load_scenario(req.scenario)
    except Exception as e:
        return JSONResponse(status_code=404, content={"error": str(e)})
    results = []
    for run in range(1, req.runs + 1):
        meta, turns, raw_prompt = await run_single(
            scenario,
            model_id=req.model_id,
            run_number=run,
            seed=req.seed,
            temperature=req.temperature,
            extra_system_prompt=req.extra_system_prompt,
        )
        out_dir = save_experiment(meta, turns, raw_prompt)
        results.append({"experiment_id": meta.experiment_id, "path": str(out_dir), "meta": meta.model_dump()})
    return {"results": results, "count": len(results)}

@router.get("/experiments")
async def get_experiments(limit: int = 50, include_nsfw: bool = False):
    try:
        exps = list_experiments(limit=limit, include_nsfw=include_nsfw)
        return {"experiments": exps}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@router.get("/scenarios")
async def list_scenarios(include_nsfw: bool = False):
    """scenarios/*.yaml 一覧"""
    import pathlib, yaml
    root = pathlib.Path(__file__).resolve().parents[3] / "scenarios"
    if not root.exists():
        return {"scenarios": []}
    out = []
    for f in sorted(root.glob("*.yaml")):
        try:
            data = yaml.safe_load(f.read_text(encoding="utf-8"))
            if not include_nsfw and data.get("nsfw"):
                continue
            out.append({"id": data.get("id"), "version": data.get("version"), "character": data.get("character"), "difficulty": data.get("difficulty"), "turns": len(data.get("turns", [])), "nsfw": bool(data.get("nsfw")), "nsfw_level": data.get("nsfw_level"), "path": str(f)})
        except Exception as e:
            out.append({"path": str(f), "error": str(e)})
    return {"scenarios": out}

# 追加: 詳細 + ratings
import json, pathlib
from python.storage.db import DB_PATH, init_db
import aiosqlite

# --- M6: leaderboard (SFW official + all) — 静的ルートは動的より前に置く ---
@router.get("/leaderboard")
async def get_leaderboard(scope: str = "official", limit: int = 50):
    """SFW公式ランキング。 scope=official は nsfw除外、scope=all は NSFW含む参考表示"""
    from python.core.experiment import EXPERIMENTS_DIR
    from python.core.metrics import compute_metrics
    scope = scope if scope in ("official", "all") else "official"
    await init_db()
    # ratings をまとめて読む（モデル集計用）
    ratings_by_exp: dict[str, list[int]] = {}
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute("SELECT experiment_id, score FROM ratings")
            for r in await cur.fetchall():
                ratings_by_exp.setdefault(r["experiment_id"], []).append(int(r["score"]))
    except Exception:
        pass

    if not EXPERIMENTS_DIR.exists():
        return {"scope": scope, "ranking": [], "generated_at": ""}

    # 全 meta を走査
    entries = []
    for d in EXPERIMENTS_DIR.iterdir():
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        is_nsfw = bool(meta.get("nsfw"))
        if scope == "official" and is_nsfw:
            continue
        # metrics: meta.metrics があれば使う、なければ recompute
        metrics = meta.get("metrics")
        if not metrics:
            # metrics.json があれば読む
            mj = d / "metrics.json"
            if mj.exists():
                try:
                    metrics = json.loads(mj.read_text(encoding="utf-8"))
                except Exception:
                    metrics = None
            if not metrics:
                tj = d / "turns.json"
                if tj.exists():
                    try:
                        turns = json.loads(tj.read_text(encoding="utf-8"))
                        metrics = compute_metrics(turns)
                    except Exception:
                        metrics = None
        meta["__metrics"] = metrics
        # human avg for this exp
        scores = ratings_by_exp.get(meta.get("experiment_id"), [])
        meta["__human_avg"] = round(sum(scores)/len(scores), 2) if scores else None
        entries.append(meta)

    # model_id で集計
    from collections import defaultdict
    by_model: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_model[e.get("model_id", "unknown")].append(e)

    ranking = []
    for model_id, exps in by_model.items():
        n = len(exps)
        # metrics 平均
        vals = [e["__metrics"] for e in exps if e["__metrics"]]
        avg_chars = round(sum(v.get("avg_chars", 0) for v in vals)/len(vals), 1) if vals else None
        avg_failure = round(sum(v.get("failure_rate", 0) for v in vals)/len(vals), 3) if vals else None
        avg_rep = None
        reps = [v.get("repetition_score") for v in vals if v.get("repetition_score") is not None]
        if reps:
            avg_rep = round(sum(reps)/len(reps), 3)
        # human 平均（null除外）
        human_avgs = [e["__human_avg"] for e in exps if e["__human_avg"] is not None]
        avg_human = round(sum(human_avgs)/len(human_avgs), 2) if human_avgs else None
        # auto スコア簡易正規化 0-100（失敗率とrepetitionが低いほど高得点）
        auto_score = None
        if vals:
            # 仮式: 100 - failure*50 - rep*30  を 0-100にクランプ
            base = 100
            if avg_failure is not None:
                base -= avg_failure * 50
            if avg_rep is not None:
                base -= avg_rep * 30
            auto_score = round(max(0, min(100, base)), 1)

        ranking.append({
            "model_id": model_id,
            "runs": n,
            "avg_human": avg_human,
            "auto_score": auto_score,
            "avg_chars": avg_chars,
            "avg_failure_rate": avg_failure,
            "avg_repetition": avg_rep,
        })

    # ソート: humanがあるもの優先で human降順、なければ auto降順、次に runs降順
    def sort_key(r):
        has_human = 0 if r["avg_human"] is not None else 1
        h = -(r["avg_human"] or 0)
        a = -(r["auto_score"] or 0)
        return (has_human, h, a, -r["runs"])
    ranking.sort(key=sort_key)
    ranking = ranking[:limit]

    from datetime import datetime, timezone
    return {"scope": scope, "ranking": ranking, "generated_at": datetime.now(timezone.utc).isoformat(), "total_experiments": len(entries)}

@router.get("/experiments/{experiment_id}")
async def get_experiment(experiment_id: str):
    try:
        from python.core.experiment import EXPERIMENTS_DIR
        d = EXPERIMENTS_DIR / experiment_id
        if not d.exists():
            return JSONResponse(status_code=404, content={"error": "experiment not found"})
        meta = json.loads((d / "meta.json").read_text(encoding="utf-8")) if (d / "meta.json").exists() else {}
        turns = []
        if (d / "turns.json").exists():
            turns = json.loads((d / "turns.json").read_text(encoding="utf-8"))
        raw_prompt = (d / "raw_prompt.txt").read_text(encoding="utf-8") if (d / "raw_prompt.txt").exists() else ""
        # metrics: metaに無ければ metrics.json から補完
        metrics = meta.get("metrics")
        if not metrics and (d / "metrics.json").exists():
            try:
                metrics = json.loads((d / "metrics.json").read_text(encoding="utf-8"))
                meta["metrics"] = metrics
            except Exception:
                pass
        if not metrics and turns:
            try:
                from python.core.metrics import compute_metrics
                metrics = compute_metrics(turns)
                meta["metrics"] = metrics
            except Exception:
                pass
        # ratings を付与
        await init_db()
        ratings = {}
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                cur = await db.execute("SELECT turn, score, comment FROM ratings WHERE experiment_id=?", (experiment_id,))
                for r in await cur.fetchall():
                    ratings[str(r["turn"])] = {"score": r["score"], "comment": r["comment"]}
        except Exception:
            pass
        # metrics をトップにも出す（フロント互換）
        metrics_out = meta.get("metrics") if isinstance(meta, dict) else None
        return {"meta": meta, "turns": turns, "raw_prompt": raw_prompt, "ratings": ratings, "metrics": metrics_out}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

class RatingIn(BaseModel):
    experiment_id: str
    turn: int
    score: int
    comment: str = ""
    rater: str = "local"

@router.post("/ratings")
async def put_rating(body: RatingIn):
    if body.score < 1 or body.score > 5:
        return JSONResponse(status_code=400, content={"error": "score 1-5"})
    await init_db()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO ratings (experiment_id, turn, score, comment, rater, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'))
               ON CONFLICT(experiment_id, turn) DO UPDATE SET score=excluded.score, comment=excluded.comment, updated_at=datetime('now')""",
            (body.experiment_id, body.turn, body.score, body.comment, body.rater),
        )
        await db.commit()
    return {"ok": True}

@router.get("/ratings")
async def get_ratings(experiment_id: str):
    await init_db()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT turn, score, comment, rater, updated_at FROM ratings WHERE experiment_id=? ORDER BY turn", (experiment_id,))
        rows = await cur.fetchall()
        return {"ratings": [dict(r) for r in rows]}
