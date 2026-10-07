"""Do not accept mock, stale, altered or absent release evidence."""

import hashlib
from python.cloud.release_readiness import audit, evidence_status, source_fingerprint, CLOUD, SALES


def test_unconfigured_release_is_blocked(tmp_path):
    result = audit(root=tmp_path)
    assert all(not p["ready"] for p in result["phases"].values())
    assert result["operator_backend"] == "openrouter"
    assert "openrouter" in result["phases"]["cloud_first_ten"]["blockers"]
    assert "go_permission" not in result["gates"]
    assert "go_accounting" not in result["gates"]
    assert "pilot_72h" not in result["phases"]["cloud_first_ten"]["blockers"]
    assert "pilot_72h" in result["phases"]["cloud_first_hundred"]["blockers"]
    explicit_go = audit(root=tmp_path, backend="opencode-go")
    assert "go_permission" in explicit_go["phases"]["cloud_first_ten"]["blockers"]


def test_first_ten_can_launch_before_observation_but_expansion_cannot(tmp_path):
    # Accepted real evidence can admit the pilot without requiring that pilot to
    # have already run. Missing payment evidence still prevents initial sales.
    report = tmp_path / "report.json"
    report.write_text('{"acceptance":"operator-recorded"}')
    entry = {"accepted": True, "kind": "real", "source_fingerprint": source_fingerprint(tmp_path),
             "evidence": "report.json", "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}
    evidence = {gate: entry for gate in (*CLOUD, "openrouter")}
    result = audit(evidence, root=tmp_path)
    assert result["phases"]["cloud_first_ten"]["ready"]
    assert result["phases"]["sales"]["blockers"] == list(SALES)
    assert result["phases"]["cloud_first_hundred"]["blockers"] == ["pilot_72h"]
    evidence["pilot_72h"] = entry
    assert audit(evidence, root=tmp_path)["phases"]["cloud_first_hundred"]["ready"]


def test_mock_stale_and_tampered_evidence_cannot_accept(tmp_path):
    report = tmp_path / "report.json"
    report.write_text('{"device":"physical"}')
    fingerprint = source_fingerprint(tmp_path)
    entry = {"accepted": True, "kind": "real", "source_fingerprint": fingerprint,
             "evidence": "report.json", "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}
    assert evidence_status(entry, fingerprint, root=tmp_path) == "accepted"
    assert evidence_status({**entry, "kind": "mock"}, fingerprint, root=tmp_path) == "mock_or_development_only"
    assert evidence_status({**entry, "source_fingerprint": "old"}, fingerprint, root=tmp_path) == "stale_source"
    report.write_text('{"device":"mock"}')
    assert evidence_status(entry, fingerprint, root=tmp_path) == "evidence_hash_mismatch"
    assert evidence_status({**entry, "evidence": "../private-file"}, fingerprint, root=tmp_path) == "missing_evidence"


def test_source_change_invalidates_all_acceptance(tmp_path):
    src = tmp_path / "runtime/python"
    src.mkdir(parents=True)
    file = src / "main.py"
    file.write_text("version=1")
    first = source_fingerprint(tmp_path)
    file.write_text("version=2")
    assert source_fingerprint(tmp_path) != first


def test_local_bundle_rejects_unsafe_release_wrong_host_and_existing_output(tmp_path, monkeypatch):
    import importlib.util
    from pathlib import Path
    import pytest
    from types import SimpleNamespace

    spec = importlib.util.spec_from_file_location(
        "build_local_bundle", Path(__file__).resolve().parents[1] / "scripts/build_local_bundle.py"
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    monkeypatch.setattr(builder, "ROOT", tmp_path)
    monkeypatch.setattr(builder, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(builder, "platform", SimpleNamespace(machine=lambda: "AMD64"))
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("test")
    output = tmp_path / "candidate"
    with pytest.raises(ValueError, match="Invalid runtime release"):
        builder.build(output, "../escape", "win32-x64", web)
    with pytest.raises(ValueError, match="native target"):
        builder.build(output, "0.1.0", "darwin-arm64", web)
    with pytest.raises(ValueError, match="inside the workspace"):
        builder.build(output, "0.1.0", "win32-x64", tmp_path.parent)
    assert not output.exists()
    output.mkdir()
    artifact = output / "kyalulu-0.1.0-win32-x64.tar.gz"
    artifact.write_bytes(b"existing candidate")
    with pytest.raises(ValueError, match="already exists"):
        builder.build(output, "0.1.0", "win32-x64", web)
    assert artifact.read_bytes() == b"existing candidate"


def test_bundle_copy_reuses_private_file_and_path_boundary_checks(tmp_path, monkeypatch):
    import importlib.util
    from pathlib import Path
    import pytest

    script = Path(__file__).resolve().parents[1] / "scripts/build_local_bundle.py"
    monkeypatch.syspath_prepend(str(script.parent))
    import collect_release_sources as sources

    monkeypatch.setattr(sources, "ROOT", tmp_path)
    spec = importlib.util.spec_from_file_location("bundle_copy", script)
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "main.py").write_text("fixture")
    private = ("data.sqlite3", "data.db-wal", ".env", "identity.vault", "key.pem", "model.gguf")
    for name in private:
        (runtime / name).write_text("synthetic private fixture")
    output = tmp_path / "stage"
    builder.copy_source(runtime, output)
    assert sorted(p.name for p in output.iterdir()) == ["main.py"]
    with pytest.raises(ValueError, match="escaped workspace"):
        builder.copy_source(tmp_path.parent, tmp_path / "outside-stage")
