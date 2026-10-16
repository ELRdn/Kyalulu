"""Production output caps cannot be reduced silently to fit acceptance funds."""
import importlib.util
from pathlib import Path


def test_complete_campaign_does_not_authorize_partial_paid_validation():
    path = Path(__file__).resolve().parents[1] / "scripts/check_cloud_beta_budget.py"
    spec = importlib.util.spec_from_file_location("beta_budget", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.estimate()
    assert result["calls_required"] == 240
    assert sum(row["calls"] for row in result["routes"]) == 240
    assert all(row["max_output_tokens"] == 4096 for row in result["routes"])
    assert result["output_only_upper_allowance_usd"] == "0.3489792"
    assert result["reason"] == "output_allowance_alone_exceeds_cap"
    assert not result["ready"] and not result["execute"] and result["real_generation_requests"] == 0
