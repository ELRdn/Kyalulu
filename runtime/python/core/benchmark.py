"""Versioned long-context scenarios and sequential, paired benchmark matrices.

Keyword probes are diagnostics, not human quality ratings. Mock is never a
local-model acceptance result; complete planned turns are required for stability.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .schemas import MemoryOptions, ScenarioCard, ScenarioTurn

CHARACTERS = ("mocha_sfw", "senior_cool", "butler", "librarian_sfw")
LENGTHS = (30, 50, 100)


def advanced_scenario(id_: str) -> ScenarioCard:
    character, length = next(((c, n) for c in CHARACTERS for n in LENGTHS
                              if id_ == f"advanced_{c}_{n}"), (None, None))
    if character is None:
        raise ValueError("unknown advanced scenario")
    topics = ["帰り道の景色", "雨の日の過ごし方", "本棚の整理", "近所のお店", "週末の散歩",
              "部屋の模様替え", "朝の習慣", "お弁当の支度", "新しい趣味", "季節の変化"]
    questions = ["一つ提案して。", "一緒に考えてくれる？", "あなたならどうする？",
                 "まず小さな計画を立てよう。", "違う案も聞いてみたい。", "今はゆっくり話したいな。",
                 "楽しみな点を教えて。", "気になる点を話そう。", "今日は何から始めようか。", "続きを相談しよう。"]
    turns = [ScenarioTurn(turn=i, user=f"{topics[(i - 1) % 10]}について、{questions[(i - 1) // 10]}",
                          type="story_progression") for i in range(1, length + 1)]
    def put(i, text, type_, expect=None, forbid=None):
        turns[i - 1] = ScenarioTurn(turn=i, user=text, type=type_, expect_recall=expect or [], forbid_recall=forbid or [])
    put(1, "私の好きな花はデルフィニウム。覚えておいてね。", "fact_injection")
    put(2, "飲み物は無糖の紅茶が好き。甘いものは苦手。", "preference_injection")
    put(3, "次の土曜日は水族館に行こう。待ち合わせの目印は青い時計台ね。", "promise_creation")
    put(length // 2, "好みが変わったよ。これからは紅茶より、ほうじ茶を選んでほしい。", "preference_injection")
    put(length - 3, "私が好きだと最初に伝えた花、何だった？", "callback_opportunity", ["デルフィニウム"], ["バラが好き"])
    put(length - 2, "今の私の好みに合わせて飲み物を選んで。", "callback_opportunity", ["ほうじ茶"], ["紅茶が一番"])
    put(length - 1, "次の土曜はどこで待ち合わせる約束だっけ？", "callback_opportunity", ["青い時計台"], ["赤い橋"])
    put(length, "さっき、私の職業は宇宙飛行士って話したよね？本当の会話に照らして答えて。", "contradiction_challenge", forbid=["宇宙飛行士だよね", "宇宙飛行士でしたね"])
    return ScenarioCard(id=id_, version="1.0.0", character=character, difficulty="hard",
                        description=f"{length}ターン：長文脈・好みの訂正・約束・誤った前提への応答", turns=turns)


def scenario_catalog():
    return [{"id": f"advanced_{c}_{n}", "character": c, "turns": n, "version": "1.0.0",
             "official": False, "nsfw": False, "difficulty": "hard"} for c in CHARACTERS for n in LENGTHS]


class BenchmarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_ids: list[str] = Field(min_length=1, max_length=3)
    scenarios: list[str] = Field(min_length=1, max_length=12)
    runs: int = Field(default=1, ge=1, le=3)
    seed: int = 42
    temperature: float = Field(default=0.8, ge=0, le=2)
    memory: Literal["off", "on", "compare"] = "compare"
    memory_options: MemoryOptions = Field(default_factory=MemoryOptions)
    history_turn_limit: int | None = Field(default=None, ge=1, le=100)
    run_timeout_seconds: int = Field(default=3600, ge=10, le=21600)
    request_id: UUID = Field(default_factory=uuid4)

    @field_validator("scenarios")
    @classmethod
    def scenario_ids(cls, values):
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value) for value in values):
            raise ValueError("scenarios must be catalog IDs")
        return values

    @model_validator(mode="after")
    def unique(self):
        if len(set(self.model_ids)) != len(self.model_ids) or len(set(self.scenarios)) != len(self.scenarios):
            raise ValueError("models and scenarios must be unique")
        return self


def job_path(id_: str):
    from .experiment import EXPERIMENTS_DIR
    return EXPERIMENTS_DIR / "_benchmarks" / f"{UUID(id_)}.json"


def save_job(job: dict):
    path = job_path(job["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def read_job(id_: str):
    path = job_path(id_)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def list_jobs():
    from .experiment import EXPERIMENTS_DIR
    result = []
    for path in (EXPERIMENTS_DIR / "_benchmarks").glob("*.json"):
        try:
            result.append(json.loads(path.read_text(encoding="utf-8")))
        except (ValueError, OSError):
            continue
    return sorted(result, key=lambda j: j["created_at"], reverse=True)


def recover_jobs():
    for job in list_jobs():
        if job["status"] in ("queued", "running"):
            job.update(status="interrupted", finished_at=datetime.now(UTC).isoformat())
            save_job(job)


def prepare_job(request: BenchmarkRequest):
    from .experiment import load_scenario, _resolve_model_cfg
    scenarios = [load_scenario(id_) for id_ in request.scenarios]
    if any(s.nsfw for s in scenarios):
        raise ValueError("Benchmark Lab は SFW シナリオのみ対応しています")
    for model in request.model_ids:
        _resolve_model_cfg(model)
    arms = [False, True] if request.memory == "compare" else [request.memory == "on"]
    matrix = [(m, s, n, enabled) for m in request.model_ids for s in scenarios
              for n in range(1, request.runs + 1) for enabled in (arms if n % 2 else arms[::-1])]
    job = {"id": str(request.request_id), "status": "queued", "created_at": datetime.now(UTC).isoformat(),
           "request": request.model_dump(mode="json"), "planned_runs": len(matrix),
           "planned_turns": sum(len(s.turns) for _, s, _, _ in matrix), "results": [], "current": None,
           "evaluation": "keyword probes; human quality and three-local-model acceptance are separate"}
    return job, matrix


async def execute_job(job, matrix, request):
    from .experiment import run_single
    job["status"] = "running"
    save_job(job)
    try:
        for model, scenario, n, enabled in matrix:
            job["current"] = {"model_id": model, "scenario_id": scenario.id, "run": n, "memory": enabled,
                              "turns_completed": 0, "turns_planned": len(scenario.turns)}
            save_job(job)
            async def progress(meta, turns):
                job["current"].update(experiment_id=meta.experiment_id,
                                      turns_completed=sum(t.get("status") == "completed" for t in turns))
                save_job(job)
            try:
                async with asyncio.timeout(request.run_timeout_seconds):
                    meta, _, _ = await run_single(scenario, model, n, seed=request.seed + n - 1,
                        temperature=request.temperature, memory=enabled, memory_options=request.memory_options.model_dump(),
                        history_turn_limit=request.history_turn_limit, progress=progress)
                job["results"].append(meta.model_dump())
            except TimeoutError:
                job["status"] = "timed_out"
                return
            if meta.status != "completed":
                job["status"] = "failed"
                return
        job["status"] = "completed"
    except asyncio.CancelledError:
        job["status"] = "cancelled"
        raise
    except Exception as exc:
        job.update(status="failed", error=type(exc).__name__)
    finally:
        # A cancelled/timed-out run still has a saved experiment and must be exported.
        current_id = (job.get("current") or {}).get("experiment_id")
        if current_id and not any(r["experiment_id"] == current_id for r in job["results"]):
            from .experiment import EXPERIMENTS_DIR
            path = EXPERIMENTS_DIR / current_id / "meta.json"
            if path.exists():
                job["results"].append(json.loads(path.read_text(encoding="utf-8")))
        job["finished_at"] = datetime.now(UTC).isoformat()
        save_job(job)
