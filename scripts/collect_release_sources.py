"""Allowlisted corresponding source and installed renderer license texts."""

import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
import yaml

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = (
    "runtime/python",
    "apps/web/src",
    "apps/web/public",
    "packages/schemas",
    "packages/ui",
    "packages/launcher",
    "characters",
    "personas",
    "worlds",
    "prompts",
)
FILES = (
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
    "apps/web/package.json",
    "apps/web/vite.config.ts",
    "apps/web/tsconfig.json",
    "scripts/build_local_bundle.py",
    "scripts/collect_release_sources.py",
    "scripts/prepare_npm_manifest.mjs",
    "scripts/check_launch_readiness.py",
    "scripts/verify_npm_beta.mjs",
    "scripts/cloud_admin.py",
    "scripts/prepare_cloud_bundle.py",
    "deploy/cloud/Dockerfile",
    "deploy/cloud/Dockerfile.prebuilt",
    "deploy/cloud/compose.yml",
    "deploy/cloud/compose.vps.yml",
    "deploy/cloud/Caddyfile.example",
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
        texts = []
        for text in sorted(metadata.parent.iterdir()):
            if text.is_file() and text.name.lower().startswith(
                ("license", "licence", "copying", "notice")
            ):
                check_source(text)
                target = destination / "licenses/renderer" / folder / text.name[:80]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(text, target)
                texts.append(target.relative_to(destination).as_posix())
        notices.append(
            {"package": identity, "license": package.get("license"), "texts": texts}
        )
    (destination / "renderer-licenses.json").write_text(
        json.dumps(notices, indent=2), encoding="utf-8"
    )
    (destination / "BUILD.md").write_text(
        "# Corresponding source\n\nNode 22+, pnpm 10.30.1, uv 0.8.22.\n"
        "`pnpm install --frozen-lockfile` then `pnpm --filter web build`.\n"
        "`uv sync --frozen --all-packages --all-extras --no-install-workspace` for Python.\n"
        "On the native target: `uv run --no-sync python scripts/build_local_bundle.py --output .artifacts/npm-beta --target win32-x64` (or darwin-arm64).\n"
        "Operator keys/data/model weights are excluded. Artifacts are not published by these steps.\n",
        encoding="utf-8",
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
