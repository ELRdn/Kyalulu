import asyncio
import json

import httpx
import pytest

from python.api.main import app
from python.core import benchmark, experiment
from python.core.schemas import ScenarioCard

pytestmark = pytest.mark.asyncio


async def test_long_scenarios_are_versioned_distinct_and_valid():
    assert len(benchmark.scenario_catalog()) == 12
    for entry in benchmark.scenario_catalog():
        scenario = experiment.load_scenario(entry["id"])
        assert len(scenario.turns) == entry["turns"]
        assert len({t.user for t in scenario.turns}) == len(scenario.turns)
        assert sum(bool(t.expect_recall) for t in scenario.turns) == 3
        assert not scenario.nsfw
    with pytest.raises(ValueError):
        ScenarioCard(id="duplicate", turns=[{"turn": 1, "user": "a"}, {"turn": 1, "user": "b"}])


async def test_paired_long_runs_snapshots_metrics_and_replay(isolated):
    request = benchmark.BenchmarkRequest(model_ids=["mock-echo"], scenarios=["advanced_librarian_sfw_30"],
                                         runs=1, memory="compare", seed=71, history_turn_limit=2,
                                         memory_options={"top_k": 2, "fill_recent": False})
    job, matrix = benchmark.prepare_job(request)
    assert job["planned_turns"] == 60
    await benchmark.execute_job(job, matrix, request)
    assert job["status"] == "completed" and len(job["results"]) == 2
    off, on = job["results"]
    assert off["seed"] == on["seed"] == 71
    assert not off["official"] and not on["official"]
    assert on["memory_options"]["top_k"] == 2 and not on["memory_options"]["fill_recent"]
    assert all(r["metrics"]["turn_count"] == 30 and r["metrics"]["first_attempt_success_rate"] == 1 for r in job["results"])
    saved = benchmark.read_job(job["id"])
    assert saved["status"] == "completed"
    assert len(experiment.list_experiments()) == 2
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(f"/api/experiments/{on['experiment_id']}/rerun", json={"runs": 1})
        assert response.status_code == 200, response.text
        replay = response.json()["results"][0]["meta"]
        assert replay["memory_options"] == on["memory_options"] and replay["history_turn_limit"] == 2
        export = await client.get(f"/api/benchmarks/{job['id']}/export")
        assert export.status_code == 200 and export.json()["results"][1]["seed"] == 71


async def test_job_idempotency_cancel_and_restart_recovery(isolated, monkeypatch):
    from python.api import benchmarks
    started = asyncio.Event()
    async def slow(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(experiment, "run_single", slow)
    request = benchmark.BenchmarkRequest(model_ids=["mock-echo"], scenarios=["mocha_memory_001"])
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/benchmarks", json=request.model_dump(mode="json"))
        assert response.status_code == 202
        id_ = response.json()["id"]
        await asyncio.wait_for(started.wait(), 2)
        assert (await client.post("/api/benchmarks", json=request.model_dump(mode="json"))).json()["id"] == id_
        another = {"model_ids": ["mock-echo"], "scenarios": ["mocha_memory_001"]}
        assert (await client.post("/api/benchmarks", json=another)).status_code == 409
        response = await client.post(f"/api/benchmarks/{id_}/cancel")
        assert response.json()["status"] == "cancelled"
        assert not benchmarks.tasks
        changed = {**request.model_dump(mode="json"), "seed": 99}
        assert (await client.post("/api/benchmarks", json=changed)).status_code == 409
    saved = benchmark.read_job(id_)
    saved["status"] = "running"
    benchmark.save_job(saved)
    benchmark.recover_jobs()
    assert benchmark.read_job(id_)["status"] == "interrupted"


async def test_partial_generation_saved_on_cancellation(isolated, monkeypatch):
    from python.providers.mock import MockProvider
    event = asyncio.Event()
    class Slow(MockProvider):
        async def stream_events(self, *args, **kwargs):
            yield {"type": "delta", "text": '{"reply":"partial'}
            event.set()
            await asyncio.Event().wait()
    monkeypatch.setattr(experiment, "get_provider_for_model", lambda cfg: Slow())
    task = asyncio.create_task(experiment.run_single(experiment.load_scenario("mocha_memory_001"), "mock-echo"))
    await asyncio.wait_for(event.wait(), 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    meta = experiment.list_experiments()[0]
    assert meta["status"] == "cancelled"
    records = json.loads((experiment.EXPERIMENTS_DIR / meta["experiment_id"] / "turns.json").read_text())
    assert records[0]["attempts"] and records[0]["status"] == "cancelled"


async def test_benchmark_rejects_unknown_models_nsfw_and_duplicates(isolated):
    with pytest.raises(ValueError):
        benchmark.BenchmarkRequest(model_ids=["mock-echo", "mock-echo"], scenarios=["mocha_daily_001"])
    for models, scenarios in ((["missing"], ["mocha_daily_001"]), (["mock-echo"], ["mocha_night_E"])):
        with pytest.raises(ValueError):
            benchmark.prepare_job(benchmark.BenchmarkRequest(model_ids=models, scenarios=scenarios))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for scenario, status in (("missing", 404), ("../outside", 422)):
            response = await client.post("/api/benchmarks", json={"model_ids": ["mock-echo"], "scenarios": [scenario]})
            assert response.status_code == status


@pytest.mark.parametrize("reason", ["cancel", "timeout"])
async def test_interrupted_matrix_keeps_partial_result_in_export(isolated, monkeypatch, reason):
    from python.providers.mock import MockProvider
    started = asyncio.Event()
    class Slow(MockProvider):
        async def stream_events(self, *args, **kwargs):
            yield {"type": "delta", "text": '{"reply":"partial'}
            started.set()
            await asyncio.Event().wait()
    monkeypatch.setattr(experiment, "get_provider_for_model", lambda cfg: Slow())
    request = benchmark.BenchmarkRequest(model_ids=["mock-echo"], scenarios=["mocha_memory_001"])
    if reason == "timeout":
        request = request.model_copy(update={"run_timeout_seconds": 1})
    job, matrix = benchmark.prepare_job(request)
    task = asyncio.create_task(benchmark.execute_job(job, matrix, request))
    await asyncio.wait_for(started.wait(), 2)
    if reason == "cancel":
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    else:
        await asyncio.wait_for(task, 2)
    saved = benchmark.read_job(job["id"])
    assert saved["status"] == ("cancelled" if reason == "cancel" else "timed_out")
    assert len(saved["results"]) == 1
    partial = saved["results"][0]
    assert partial["status"] == "cancelled" and partial["metrics"]["failure_rate"] == 1
    assert partial["experiment_id"] == saved["current"]["experiment_id"]
