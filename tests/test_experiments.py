import httpx
import pytest
from python.core import experiment
from python.api.main import app

pytestmark = pytest.mark.asyncio


async def test_official_three_scenarios_twenty_turns_three_runs(isolated):
    ids = set()
    for scenario_id in experiment.OFFICIAL_SCENARIOS:
        scenario = experiment.load_scenario(scenario_id)
        from python.core.prompt_compiler import compile_prompt, _load_yaml, CHAR_DIR
        card = _load_yaml(CHAR_DIR, scenario.character)
        assert card['official'] and not card['nsfw']
        assert 'legacy_NSFW' not in compile_prompt(scenario.character).sections['skill']
        assert len(scenario.turns) == 20
        for run in range(1, 4):
            meta, turns, prompt = await experiment.run_single(scenario, "mock-echo", run, seed=42)
            ids.add(meta.experiment_id)
            assert meta.status == "completed"
            assert meta.official
            assert len(turns) == 20 and turns[-1]["state"]["turn"] == 20
            assert all(t["validation"]["ok"] for t in turns)
            assert meta.scenario_snapshot["id"] == scenario_id
    assert len(ids) == 9
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        board = (await client.get("/api/leaderboard")).json()
        assert board["ranking"] == []
        assert board["excluded"]["mock"] == 9
        sample = next(iter(ids))
        exported = await client.get(f"/api/experiments/{sample}/export")
        assert len(exported.json()["turns"]) == 20
        assert "attachment" in exported.headers["content-disposition"]
        rating = await client.post("/api/ratings", json={"experiment_id": sample, "turn": 1, "score": 4, "comment": "good", "rater": "tester"})
        assert rating.status_code == 200
        detail = (await client.get(f"/api/experiments/{sample}")).json()
        assert detail["ratings"]["1"]["rater"] == "tester"
        replay = await client.post(f"/api/experiments/{sample}/rerun", json={"runs": 1})
        assert replay.status_code == 200
        assert replay.json()["results"][0]["meta"]["seed"] == 42


async def test_nsfw_api_guard(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/experiments/run", json={"scenario": "mocha_night_E", "model_id": "mock-echo"})
        assert response.status_code == 403


async def test_mislabeled_scenario_cannot_bypass_character_nsfw(tmp_path):
    import yaml
    scenario = {'id':'custom', 'character':'mocha', 'nsfw':False, 'turns':[{'turn':1,'user':'hello'}]}
    path = tmp_path / 'custom.yaml'
    path.write_text(yaml.safe_dump(scenario), encoding='utf-8')
    assert experiment.load_scenario(str(path)).nsfw


async def test_invalid_run_is_saved_and_excluded(isolated, monkeypatch):
    from test_generation import Fake
    monkeypatch.setattr(experiment, "get_provider_for_model", lambda cfg: Fake(['{"reply":"bad"}'] * 3))
    meta, turns, _ = await experiment.run_single(experiment.load_scenario("mocha_daily_001"), "mock-echo")
    assert meta.status == "invalid" and len(turns) == 1
    assert (experiment.EXPERIMENTS_DIR / meta.experiment_id / "meta.json").exists()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        board = (await client.get("/api/leaderboard?scope=all")).json()
        assert board["ranking"] == [] and board["excluded"]["invalid"] == 1


async def test_legacy_failed_completed_run_is_readable_but_not_ranked(isolated):
    import json
    path = experiment.EXPERIMENTS_DIR / 'legacy'
    path.mkdir(parents=True)
    (path / 'meta.json').write_text(json.dumps({'experiment_id':'legacy','model_id':'old-model','status':'completed'}))
    (path / 'turns.json').write_text(json.dumps([{'turn':1,'assistant':'[error: offline]','user':'hello'}]))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.get('/api/experiments/legacy')).status_code == 200
        assert (await client.post('/api/experiments/legacy/rerun', json={})).status_code == 409
        board = (await client.get('/api/leaderboard?scope=all')).json()
        assert not board['ranking'] and board['excluded']['invalid'] == 1
