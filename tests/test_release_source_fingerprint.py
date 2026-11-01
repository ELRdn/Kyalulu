"""Every delivered prompt, asset and build input must invalidate old acceptance."""

import hashlib

import pytest

from python.cloud.release_readiness import evidence_status, source_fingerprint


@pytest.mark.parametrize("name", [
    "characters/guide.yaml", "personas/default.yaml", "worlds/default.yaml", "prompts/base.md",
    "packages/schemas/src/index.ts", "packages/ui/src/index.ts", "apps/web/index.html", "apps/web/migration/index.html",
    "apps/web/tsconfig.json", "packages/schemas/package.json", "pnpm-workspace.yaml",
    "models/example-ollama.yaml", "scripts/collect_release_sources.py", "packages/analytics/analytics.js", "packages/analytics/config.json",
    "scripts/mobile_wasm/ple.patch", "scripts/build_app_catalog.py", "tests/fixtures/unified-core.json", "tests/fixtures/unified-memory-provenance.json", "tests/fixtures/portable-prompt.json",
    "tests/fixtures/unified-history.json", "tests/fixtures/device-exports.json", "tests/fixtures/device-imports.json",
    "tests/fixtures/device-media.json", "tests/fixtures/device-research.json", "tests/fixtures/device-lore-values.json",
    "tests/fixtures/rp-format.json",
    "deploy/cloud/Caddyfile.unified.example",
    "deploy/cloud/Caddyfile.cloud-migration.example",
    "deploy/cloud/VPS.md",
])
def test_delivered_input_change_rejects_previous_evidence(tmp_path, name):
    source = tmp_path / name
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("version one", encoding="utf-8")
    report = tmp_path / "acceptance.json"
    report.write_text("{}", encoding="utf-8")
    entry = {"accepted": True, "kind": "real", "source_fingerprint": source_fingerprint(tmp_path),
             "evidence": report.name, "sha256": hashlib.sha256(report.read_bytes()).hexdigest()}
    assert evidence_status(entry, source_fingerprint(tmp_path), root=tmp_path) == "accepted"
    source.write_text("version two", encoding="utf-8")
    assert evidence_status(entry, source_fingerprint(tmp_path), root=tmp_path) == "stale_source"


def test_full_export_and_offered_source_have_identical_fingerprint(tmp_path, monkeypatch):
    from pathlib import Path
    import shutil
    from python.cloud.release_readiness import SOURCE_DIRS, SOURCE_FILES

    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / "scripts"))
    import collect_release_sources as sources

    exported = tmp_path / "export"
    for name in dict.fromkeys((*sources.DIRECTORIES, *SOURCE_DIRS)):
        if (root / name).is_dir():
            shutil.copytree(root / name, exported / name, dirs_exist_ok=True,
                            ignore=sources.ignore_private)
    for name in {*sources.FILES, *SOURCE_FILES}:
        if (root / name).is_file():
            target = exported / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, target)
    expected = source_fingerprint(root)
    assert source_fingerprint(exported) == expected
    monkeypatch.setattr(sources, "ROOT", exported)
    offered = tmp_path / "offered"
    sources.collect(offered)
    assert (offered / "deploy/cloud/VPS.md").read_bytes() == (exported / "deploy/cloud/VPS.md").read_bytes()
    assert source_fingerprint(offered) == expected
