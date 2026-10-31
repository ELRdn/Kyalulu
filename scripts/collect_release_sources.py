"""Allowlisted corresponding source and installed renderer license texts."""

import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
import yaml

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LICENSES = {
    "wllama-MIT.txt": ".artifacts/mobile-wasm/wllama/LICENCE",
    "llama-MIT.txt": ".artifacts/mobile-wasm/wllama/llama.cpp/LICENSE",
    "transformers-Apache-2.0.txt": "apps/web/node_modules/@huggingface/transformers/LICENSE",
    "onnxruntime-MIT.txt": "docs/licenses/onnxruntime-MIT.txt",
    "onnxruntime-ThirdPartyNotices.txt": "docs/licenses/onnxruntime-ThirdPartyNotices.txt",
    "noise-c-MIT.txt": "docs/licenses/noise-c-MIT.txt",
    "Dawn-WebGPU.txt": ".artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu/src/LICENSE",
    "Dawn-WebGPU-cpp.txt": ".artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu_cpp/LICENSE",
    "jsonhpp-MIT.txt": ".artifacts/mobile-wasm/wllama/llama.cpp/licenses/LICENSE-jsonhpp",
    "AGPL-3.0.txt": "LICENSE",
}


def copy_runtime_licenses(root, destination):
    target = destination / "licenses"
    if target.is_symlink():
        raise ValueError("Runtime license destination is a symlink")
    texts = {}
    for name, relative in RUNTIME_LICENSES.items():
        origin = root / relative
        if origin.is_symlink() or not origin.resolve().is_relative_to(root.resolve()):
            raise ValueError("Runtime license escaped workspace or is a symlink")
        if (target / name).is_symlink():
            raise ValueError("Runtime license destination is a symlink")
        texts[name] = origin.read_bytes()
        if not texts[name].strip():
            raise ValueError("Runtime license text is empty")
    target.mkdir(parents=True, exist_ok=True)
    for name, data in texts.items():
        (target / name).write_bytes(data)


DIRECTORIES = (
    "runtime/python",
    "apps/web/src",
    "apps/web/public",
    "packages/schemas",
    "packages/ui",
    "packages/analytics",
    "packages/launcher",
    "characters",
    "personas",
    "worlds",
    "prompts",
    "scenarios",
    "scripts/mobile_wasm",
    "docs/licenses",
)
FILES = (
    ".gitattributes",
    "LICENSE",
    "README.md",
    "README.jp.md",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "pyproject.toml",
    "uv.lock",
    "runtime/pyproject.toml",
    "apps/web/index.html",
    "apps/web/migration/index.html",
    "apps/web/package.json",
    "apps/web/vite.config.ts",
    "apps/web/vite.config.test.ts",
    "apps/web/tsconfig.json",
    "scripts/build_local_bundle.py",
    "scripts/collect_release_sources.py",
    "scripts/prepare_npm_manifest.mjs",
    "scripts/check_launch_readiness.py",
    "scripts/verify_npm_beta.mjs",
    "scripts/unified_preview.py",
    "scripts/cloud_admin.py",
    "scripts/prepare_cloud_bundle.py",
    "scripts/build_app_catalog.py",
    "scripts/mobile_models.py",
    "scripts/mobile_release.py",
    "scripts/verify_mobile.py",
    "scripts/publish_mobile.ps1",
    "tests/fixtures/unified-core.json",
    "tests/fixtures/unified-memory-provenance.json",
    "tests/test_device_memory_provenance.py",
    "tests/fixtures/unified-memory-scopes.json",
    "tests/test_device_memory_scopes.py",
    "tests/fixtures/device-memory-scopes.html",
    "tests/e2e_device_memory_scopes.py",
    "tests/e2e_memory_source_projection.py",
    "tests/fixtures/memory-source-projection.html",
    "tests/e2e_history_mutations.py",
    "tests/fixtures/history-mutations.html",
    "tests/e2e_device_branches.py",
    "tests/fixtures/device-branches.html",
    "tests/e2e_generation_commits.py",
    "tests/fixtures/generation-commits.html",
    "tests/e2e_device_memory.py",
    "tests/e2e_device_generation_lock.py",
    "tests/e2e_device_target_switch.py",
    "tests/fixtures/device-research.html",
    "tests/e2e_device_benchmarks.py",
    "tests/test_benchmark.py",
    "tests/test_json_stream.py",
    "tests/test_native_outbox_guard.py",
    "tests/conftest.py",
    "tests/e2e_research_storage.py",
    "tests/fixtures/research-storage.html",
    "tests/e2e_outbox_stream.py",
    "tests/fixtures/outbox-stream.html",
    "tests/fixtures/memory-language.html",
    "tests/fixtures/portable-prompt.json",
    "tests/fixtures/unified-history.json",
    "tests/fixtures/unified-regeneration-memory.json",
    "tests/fixtures/device-exports.json",
    "tests/fixtures/device-imports.json",
    "tests/fixtures/device-media.json",
    "tests/fixtures/device-research.json",
    "tests/fixtures/device-lore-values.json",
    "tests/fixtures/rp-format.json",
    "tests/fixtures/json-stream.json",
    "tests/e2e_unified_entry.py",
    "tests/e2e_native_entry.py",
    "tests/test_native_onboarding.py",
    "tests/test_renderer_licenses.py",
    "tests/e2e_runtime_sync_language.py",
    "tests/fixtures/runtime-sync-language.html",
    "tests/e2e_remote.py",
    "tests/test_remote_bridge.py",
    "tests/test_relay.py",
    "tests/test_relay_operations.py",
    "scripts/relay.py",
    "scripts/remote_acceptance.py",
    "tests/e2e_runtime_privacy.py",
    "tests/fixtures/runtime-privacy.html",
    "tests/e2e_cloud_login.py",
    "tests/e2e_cloud_target_switch.py",
    "tests/test_cloud_stop_acceptance.py",
    "tests/test_core_restore_sync.py",
    "tests/test_core_restore_interruption.py",
    "tests/test_native_sync_client.py",
    "tests/test_native_sync_scopes.py",
    "tests/test_cloud.py",
    "tests/test_cloud_cost_accounting.py",
    "tests/test_cloud_direct_generation.py",
    "tests/e2e_commercial_ui.py",
    "tests/e2e_outbox_guard.py",
    "tests/browser_storage.py",
    "tests/e2e_unified_pwa.py",
    "tests/e2e_mobile_migration.py",
    "tests/e2e_segmented_storage.py",
    "tests/test_segmented_storage_runner.py",
    "tests/e2e_storage_capacity.py",
    "tests/fixtures/storage-capacity.html",
    "tests/fixtures/segmented-storage.html",
    "tests/fixtures/storage-fixture.ts",
    "tests/fixtures/session-policy.tsx",
    "tests/fixtures/outbox-guard.html",
    "tests/e2e_sync_selection.py",
    "tests/fixtures/sync-selection.html",
    "tests/e2e_offline_cache.py",
    "tests/fixtures/offline-cache.html",
    "tests/e2e_device_quota.py",
    "tests/fixtures/device-quota.html",
    "tests/fixtures/unified-container.py",
    "tests/fixtures/unified-disaster-recovery.py",
    "tests/browser_fixture_server.py",
    "docs/MOBILE.md",
    "docs/UNIFIED_APP.md",
    "docs/UNIFIED_DELIVERY.md",
    "docs/UNIFIED_DEPLOYMENT.md",
    "docs/UNIFIED_PRODUCTION_PREFLIGHT_REVIEW.md",
    "docs/UNIFIED_CONTAINER_VALIDATION_REVIEW.md",
    "docs/UNIFIED_RECOVERY_LAYOUT_REVIEW.md",
    "docs/UNIFIED_SYNC_ERASURE_REVIEW.md",
    "docs/validation/2026-10-23-mobile.md",
    "docs/validation/2026-10-24-unified-sync.md",
    "docs/validation/2026-10-24-unified-erasure.md",
    "docs/validation/2026-10-24-unified-cache-migration.md",
    "docs/validation/2026-10-24-unified-portable.md",
    "docs/validation/2026-10-26-unified-proxy.md",
    "docs/validation/2026-10-26-unified-mobile-migration.md",
    "docs/validation/2026-10-26-unified-recommendations.md",
    "docs/validation/2026-10-26-unified-entry.md",
    "docs/validation/2026-10-26-unified-login-language.md",
    "docs/validation/2026-10-26-unified-login-regions.md",
    "docs/validation/2026-10-26-unified-sync-byte-streams.md",
    "docs/validation/2026-10-26-unified-sync-receive-streams.md",
    "docs/validation/2026-10-29-unified-offline-cache.md",
    "docs/validation/2026-10-29-unified-device-reads.md",
    "docs/validation/2026-10-29-unified-commercial-ui.md",
    "docs/validation/2026-10-29-unified-device-quota.md",
    "docs/validation/2026-10-29-unified-container.md",
    "docs/validation/2026-10-29-unified-sync-selection.md",
    "docs/validation/2026-10-29-unified-runtime-routing.md",
    "docs/validation/2026-10-30-unified-native-mobile.md",
    "docs/validation/2026-10-30-unified-native-entry.md",
    "docs/validation/2026-10-30-unified-wasm.md",
    "docs/validation/2026-10-30-unified-container.md",
    "docs/validation/2026-10-30-unified-disaster-recovery.md",
    "docs/validation/2026-10-30-unified-segmented-storage.md",
    "docs/validation/2026-10-30-unified-legacy-cloud.md",
    "docs/validation/2026-10-31-unified-renderer-licenses.md",
    "docs/validation/2026-10-31-unified-runtime-sync-language.md",
    "docs/validation/2026-10-31-unified-ci-storage-diagnostics.md",
    "docs/validation/2026-10-31-unified-target-switch.md",
    "docs/validation/2026-10-31-unified-device-target-switch.md",
    "docs/validation/2026-10-31-unified-runtime-privacy.md",
    "docs/validation/2026-10-31-unified-cloud-stop-accounting.md",
    "docs/validation/2026-10-31-unified-cloud-target-switch.md",
    "deploy/cloud/Dockerfile",
    "deploy/cloud/Dockerfile.prebuilt",
    "deploy/cloud/compose.yml",
    "deploy/cloud/compose.vps.yml",
    "deploy/cloud/Caddyfile.example",
    "deploy/cloud/Caddyfile.unified.example",
    "deploy/cloud/Caddyfile.cloud-migration.example",
    "deploy/cloud/README.md",
    "models/example-le.yaml",
    "models/example-lmstudio.yaml",
    "models/example-ollama.yaml",
    "models/mock-echo.yaml",
)


def check_source(path):
    if path.is_symlink() or not path.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Release source escaped workspace or is a symlink")


def ignore_private(directory, names):
    ignored = shutil.ignore_patterns(
        "__pycache__", "*.pyc", "node_modules", "*.tsbuildinfo", "dist", ".env*",
        "*.db*", "*.sqlite*", "*.vault", "*.pem", "*.key", "*.gguf", "*.log", ".pytest_cache",
    )(directory, names)
    for name in set(names) - ignored:
        check_source(Path(directory) / name)
    return ignored


def collect(destination):
    destination.mkdir(parents=True, exist_ok=True)
    for directory in DIRECTORIES:
        check_source(ROOT / directory)
        shutil.copytree(
            ROOT / directory,
            destination / directory,
            dirs_exist_ok=True,
            ignore=ignore_private,
        )
    for name in FILES:
        check_source(ROOT / name)
        if name.startswith("models/"):
            model = yaml.safe_load((ROOT / name).read_text(encoding="utf-8"))
            entries = model if isinstance(model, list) else [model]
            if any((entry or {}).get("provider", {}).get("api_key") for entry in entries):
                raise ValueError("Release model examples contain credentials")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    collect_renderer_licenses(destination)
    (destination / "BUILD.md").write_text(
        "# Corresponding source\n\nNode 22+, pnpm 10.30.1, uv 0.8.22.\n"
        "`pnpm install --frozen-lockfile` then `pnpm --filter web build`.\n"
        "For the unified app, regenerate the catalog with `python scripts/build_app_catalog.py`, build pinned WASM using `scripts/mobile_wasm/bootstrap.py`, `prepare.py` and `build.sh`, set `VITE_RELAY_ORIGIN` to the exact managed HTTPS Relay origin, then run `pnpm --filter web build:app`. See `docs/MOBILE.md` and `docs/UNIFIED_APP.md`.\n"
        "For the legacy Mobile app, use the same catalog/WASM preparation and `pnpm --filter web build:mobile`.\n"
        "`uv sync --frozen --all-packages --all-extras --no-install-workspace` for Python.\n"
        "For Native, keep the pinned WASM and Relay origin, run `pnpm --filter web build:native`, then on the native target `uv run --no-sync python scripts/build_local_bundle.py --output .artifacts/npm-beta --target win32-x64` (or darwin-arm64). The builder requires the Native UI marker and refuses a hosted-only UI.\n"
        "Operator keys/data/model weights are excluded. Artifacts are not published by these steps.\n",
        encoding="utf-8",
    )


def collect_renderer_licenses(destination):
    if destination.is_symlink():
        raise ValueError("Renderer license destination is a symlink")
    destination.mkdir(parents=True, exist_ok=True)
    manifest = ROOT / "docs/licenses/renderer-license-sources.json"
    overrides = {}
    check_source(manifest)
    if manifest.exists():
        for entry in json.loads(manifest.read_text(encoding="utf-8")):
            for identity in entry["packages"]:
                if identity in overrides:
                    raise ValueError("Duplicate renderer license identity")
                overrides[identity] = entry
    notices, seen = [], set()
    tree = ROOT / "node_modules/.pnpm"
    for metadata in sorted(tree.glob("*/node_modules/*/package.json")) + sorted(
        tree.glob("*/node_modules/@*/*/package.json")
    ):
        if metadata.parent.is_symlink():
            continue
        check_source(metadata)
        package = json.loads(metadata.read_text(encoding="utf-8"))
        identity = package.get("name", "") + "@" + package.get("version", "")
        if identity in seen:
            continue
        seen.add(identity)
        folder = hashlib.sha256(identity.encode()).hexdigest()[:16]
        texts, origins = [], []
        def copy_text(name, data):
            if not data.strip():
                raise ValueError("Renderer license text is empty")
            target = destination / "licenses/renderer" / folder / name
            if any(path.is_symlink() for path in (target, *target.parents) if path.is_relative_to(destination)) or not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Renderer license destination escaped or is a symlink")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            texts.append(target.relative_to(destination).as_posix())
        for text in sorted(metadata.parent.iterdir()):
            if text.is_file() and text.name.lower().startswith(
                ("license", "licence", "copying", "notice")
            ):
                check_source(text)
                copy_text(text.name[:80], text.read_bytes())
        if not texts and identity in overrides:
            entry = overrides[identity]
            if package.get("license") != entry["license"]:
                raise ValueError("Renderer license declaration changed")
            pending = []
            for origin in entry["texts"]:
                relative = Path(origin["path"])
                if relative.is_absolute() or relative.parts[:2] != ("docs", "licenses") or ".." in relative.parts:
                    raise ValueError("Renderer license source escaped license directory")
                source = ROOT / relative
                check_source(source)
                data = source.read_bytes()
                if not data.strip() or hashlib.sha256(data).hexdigest() != origin["sha256"]:
                    raise ValueError("Renderer license text checksum mismatch")
                pending.append((source.name, data))
            if not pending:
                raise ValueError("Renderer license source is empty")
            for name, data in pending:
                copy_text(name, data)
            origins = entry["texts"]
        notices.append(
            {"package": identity, "license": package.get("license"), "texts": texts,
             **({"sources": origins} if origins else {})}
        )
    inventory = destination / "renderer-licenses.json"
    if inventory.is_symlink():
        raise ValueError("Renderer inventory destination is a symlink")
    inventory.write_text(
        json.dumps(notices, indent=2), encoding="utf-8"
    )


def archive(source, output):
    with tarfile.open(
        output, "w:gz", format=tarfile.USTAR_FORMAT, dereference=True
    ) as result:
        for file in sorted(source.rglob("*")):
            if file.is_file():
                result.add(
                    file, arcname=file.relative_to(source).as_posix(), recursive=False
                )


if __name__ == "__main__":
    destination = Path(sys.argv[1])
    collect(destination)
    if len(sys.argv) > 2:
        archive(destination, Path(sys.argv[2]))
