"""Corresponding source must not collect private files or follow external links."""

import importlib.util
from pathlib import Path

import pytest


def test_corresponding_source_boundaries(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts/collect_release_sources.py"
    spec = importlib.util.spec_from_file_location("release_sources", path)
    sources = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sources)
    monkeypatch.setattr(sources, "ROOT", tmp_path / "repo")
    monkeypatch.setattr(sources, "DIRECTORIES", ("runtime/python",))
    monkeypatch.setattr(sources, "FILES", ())
    tree = sources.ROOT / "runtime/python"
    tree.mkdir(parents=True)
    (tree / "main.py").write_text("print('fixture')", encoding="utf-8")
    private = [".env", "data.sqlite3", "data.sqlite3-wal", "data.db-wal", "identity.vault",
               "private.pem", "private.key", "model.gguf", "requests.log"]
    for name in private:
        (tree / name).write_text("synthetic private fixture", encoding="utf-8")
    output = tmp_path / "output"
    sources.collect(output)
    assert (output / "runtime/python/main.py").is_file()
    assert not any((output / "runtime/python" / name).exists() for name in private)
    outside = tmp_path / "outside.py"
    outside.write_text("synthetic outside fixture", encoding="utf-8")
    with pytest.raises(ValueError, match="escaped workspace"):
        sources.check_source(outside)
    try:
        (tree / "linked.py").symlink_to(outside)
    except OSError:
        pass  # Windows may require privileges; the path-boundary check above still runs.
    else:
        with pytest.raises(ValueError, match="symlink"):
            sources.collect(tmp_path / "linked-output")
        (tree / "linked.py").unlink()
    model = sources.ROOT / "models/example.yaml"
    model.parent.mkdir()
    model.write_text("provider:\n  api_key: synthetic-secret\n", encoding="utf-8")
    monkeypatch.setattr(sources, "FILES", ("models/example.yaml",))
    with pytest.raises(ValueError, match="credentials"):
        sources.collect(tmp_path / "credential-output")


@pytest.mark.parametrize('linked_name', ['LICENSE', 'package.json'])
def test_renderer_licenses_and_metadata_reject_links_before_collection(tmp_path, monkeypatch, linked_name):
    path = Path(__file__).resolve().parents[1] / 'scripts/collect_release_sources.py'
    spec = importlib.util.spec_from_file_location('release_sources', path)
    sources = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sources)
    monkeypatch.setattr(sources, 'ROOT', tmp_path / 'repo')
    monkeypatch.setattr(sources, 'DIRECTORIES', ())
    monkeypatch.setattr(sources, 'FILES', ())
    package = sources.ROOT / 'node_modules/.pnpm/fixture@1/node_modules/fixture'
    package.mkdir(parents=True)
    (package / 'package.json').write_text('{"name":"fixture","version":"1","license":"MIT"}', encoding='utf-8')
    (package / 'LICENSE').write_text('synthetic private sentinel', encoding='utf-8')
    # Model a link without requiring Windows symlink privileges.
    is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda self: self == package / linked_name or is_symlink(self))
    output = tmp_path / 'output'
    with pytest.raises(ValueError, match='symlink'):
        sources.collect(output)
    assert not list(output.rglob('LICENSE'))
