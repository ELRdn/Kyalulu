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


@pytest.mark.parametrize("character", [None, "mocha_sfw"])
async def test_custom_scenario_runs_and_replays_as_non_official(isolated, character):
    import json
    import yaml
    path = isolated / "private-scenario.yaml"
    scenario = {"id": "private_unregistered_scenario", "character": character,
                "turns": [{"turn": 1, "user": "hello"}]}
    path.write_text(yaml.safe_dump(scenario), encoding="utf-8")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url="http://test") as client:
        response = await client.post("/api/experiments/run", json={
            "scenario": str(path), "model_id": "mock-echo", "seed": 42})
        assert response.status_code == 200, response.text
        meta = response.json()["results"][0]["meta"]
        assert meta["status"] == "completed" and not meta["official"]
        assert meta["character_id"] == character and meta["scenario_snapshot"]["id"] == scenario["id"]
        saved = experiment.EXPERIMENTS_DIR / meta["experiment_id"]
        assert json.loads((saved / "meta.json").read_text(encoding="utf-8")) == meta
        turns = json.loads((saved / "turns.json").read_text(encoding="utf-8"))
        assert len(turns) == 1 and turns[0]["status"] == "completed"
        assert turns[0]["assistant"] == "Mock: hello"
        replay = await client.post(f"/api/experiments/{meta['experiment_id']}/rerun", json={"runs": 1})
        assert replay.status_code == 200, replay.text
        replay_meta = replay.json()["results"][0]["meta"]
        assert replay_meta["status"] == "completed" and not replay_meta["official"]
        assert replay_meta["scenario_snapshot"] == meta["scenario_snapshot"]


@pytest.mark.parametrize('variant,official', [('unknown-empty', False), ('unknown-character', False),
    ('canonical', True), ('changed-description', False), ('changed-character', False)])
async def test_scenario_catalog_matches_canonical_official_identity(isolated, monkeypatch, variant, official):
    import importlib
    import yaml
    api = importlib.import_module('python.api.experiments')
    root = isolated / 'scenario-catalog'
    directory = root / 'scenarios'
    directory.mkdir(parents=True)
    if variant.startswith('unknown'):
        data = {'id': 'private_unregistered_scenario', 'character': None if variant == 'unknown-empty' else 'mocha_sfw',
                'turns': [{'turn': 1, 'user': 'hello'}]}
    else:
        data = experiment.load_scenario('mocha_daily_001').model_dump()
        if variant == 'changed-description':
            data['description'] = 'private altered scenario'
        if variant == 'changed-character':
            data['character'] = None
    source = directory / 'private.yaml'
    source.write_text(yaml.safe_dump(data, allow_unicode=True), encoding='utf-8')
    monkeypatch.setattr(api, '__file__', str(root / 'runtime/python/api/experiments.py'))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/scenarios')
    assert response.status_code == 200
    row, = [row for row in response.json()['scenarios'] if row.get('path') == str(source)]
    assert row['id'] == data['id'] and row['official'] is official


@pytest.mark.parametrize("changes", [
    {"character": None}, {"character": "senior_cool"}, {"description": "private clone"},
])
async def test_official_id_does_not_make_modified_scenario_official(isolated, changes):
    scenario = experiment.load_scenario("mocha_daily_001").model_copy(update=changes)
    meta, turns, _ = await experiment.run_single(scenario, "mock-echo")
    assert meta.status == "completed" and not meta.official
    assert len(turns) == len(scenario.turns)


@pytest.mark.parametrize("options", [
    {"extra_system_prompt": "Private experiment instruction."},
    {"memory": True}, {"history_turn_limit": 1},
])
async def test_custom_run_options_exclude_official_scenario(isolated, options):
    scenario = experiment.load_scenario("mocha_daily_001")
    meta, turns, _ = await experiment.run_single(scenario, "mock-echo", **options)
    assert meta.status == "completed" and not meta.official
    assert len(turns) == len(scenario.turns)
    for key, value in options.items():
        assert getattr(meta, "memory_enabled" if key == "memory" else key) == value


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
