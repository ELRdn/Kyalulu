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
