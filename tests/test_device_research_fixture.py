import json
from pathlib import Path

from python.core.experiment import load_scenario
from python.core.schemas import ScenarioCard
from scripts.build_research_fixture import fixture

ROOT = Path(__file__).resolve().parents[1]


def test_browser_research_reference_matches_native():
    assert json.loads((ROOT / 'tests/fixtures/device-research.json').read_text(encoding='utf-8')) == fixture()


def test_browser_scenarios_include_native_memory_probes_and_session_breaks():
    scenarios = json.loads((ROOT / 'apps/web/src/mobile/app-catalog.generated.json').read_text(encoding='utf-8'))['scenarios']
    assert len(scenarios) == 16
    for scenario in scenarios:
        assert ScenarioCard.model_validate(scenario) == load_scenario(scenario['id'])
