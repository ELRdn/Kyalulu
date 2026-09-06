import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    from python.storage import db
    from python.api import chat, experiments
    from python.core import experiment, registry
    for module in (db, chat, experiments, registry):
        monkeypatch.setattr(module, "DB_PATH", tmp_path / "data.db")
    monkeypatch.setattr(experiment, "EXPERIMENTS_DIR", tmp_path / "experiments")
    return tmp_path
