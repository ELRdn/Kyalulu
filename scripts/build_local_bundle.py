"""Build a self-contained, allowlisted runtime artifact on its target OS.

The managed interpreter and locked binary dependencies are bundled. End users
need only Node 22; no postinstall script, Python install, Git or package manager.
"""

import argparse
import hashlib
import json
import os
import platform
import re
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VERSION = "3.13.7"


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def copy_source(source, target):
    from collect_release_sources import check_source, ignore_private

    check_source(source)
    shutil.copytree(
        source,
        target,
        ignore=ignore_private,
    )


def build(output, release, target, web_dist=None):
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[a-z0-9.]+)?", release, re.I):
        raise ValueError("Invalid runtime release")
    host = (
        "win32-x64"
        if os.name == "nt" and platform.machine().lower() in {"amd64", "x86_64"}
        else "darwin-arm64"
        if platform.system() == "Darwin" and platform.machine().lower() == "arm64"
        else None
    )
    if target != host:
        raise ValueError("Build each artifact on its native target OS and architecture")
    web_dist = (web_dist or ROOT / "apps/web/dist").resolve()
    if not web_dist.is_relative_to(ROOT) or not (web_dist / "index.html").is_file():
        raise ValueError("Build Web UI inside the workspace before assembling the runtime")
    artifact = output / f"kyalulu-{release}-{target}.tar.gz"
    manifest_file = output / (target + ".manifest.json")
    if artifact.exists() or manifest_file.exists():
        raise ValueError("Release output already exists; use a fresh output directory")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as tmp:
        stage = Path(tmp) / "bundle"
        stage.mkdir()
        # Version pinned here; the complete final artifact is pinned by SHA-256 in
        # the npm manifest. No latest-version lookup occurs on the user's machine.
        env = {
            **os.environ,
            "UV_PYTHON_INSTALL_DIR": str(stage / "python"),
            "UV_CACHE_DIR": str(output / ".cache"),
            "PYTHONHOME": "",
            "PYTHONPATH": "",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        run(
            ["uv", "python", "install", "--no-bin", "--no-registry", PYTHON_VERSION],
            env=env,
        )
        found = run(
            ["uv", "python", "find", "--managed-python", PYTHON_VERSION],
            env=env,
            capture_output=True,
        )
        executable = Path(found.stdout.strip())
        # Resolve UV's convenience symlink. Archives contain only regular files.
        executable = executable.resolve()
        if not executable.is_relative_to(stage.resolve()):
            raise ValueError("Managed interpreter escaped staging directory")
        requirements = Path(tmp) / "requirements.txt"
        run(
            [
                "uv",
                "export",
                "--frozen",
                "--all-packages",
                "--extra",
                "remote",
                "--no-dev",
                "--no-emit-workspace",
                "--format",
                "requirements-txt",
                "--output-file",
                str(requirements),
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
        )
        run(
            [
                "uv",
                "pip",
                "install",
                "--python",
                str(executable),
                "--target",
                str(stage / "vendor"),
                "--require-hashes",
                "-r",
                str(requirements),
            ],
            env=env,
        )
        for pth in executable.parent.glob("*._pth"):
            text = pth.read_text()
            for directory in (stage / "runtime", stage / "vendor"):
                text += "\n" + os.path.relpath(directory, executable.parent)
            pth.write_text(text + "\nimport site\n")
        copy_source(ROOT / "runtime/python", stage / "runtime/python")
        for directory in ("characters", "personas", "worlds", "prompts", "models"):
            target_dir = stage / directory
            target_dir.mkdir()
            for source in (ROOT / directory).iterdir():
                if source.suffix not in {".yaml", ".yml", ".md"}:
                    continue
                if directory == "models":
                    if source.name not in {
                        "example-le.yaml",
                        "example-lmstudio.yaml",
                        "example-ollama.yaml",
                        "mock-echo.yaml",
                    }:
                        continue
                    import yaml

                    data = yaml.safe_load(source.read_text(encoding="utf-8"))
                    entries = data if isinstance(data, list) else [data]
                    if any(
                        (d or {}).get("provider", {}).get("api_key") for d in entries
                    ):
                        raise ValueError("Model registry contains credentials")
                shutil.copy2(source, target_dir / source.name)
        copy_source(web_dist, stage / "web")
        # Complete corresponding application source for AGPL delivery, including
        # renderer and schema sources used to generate the supplied Web bundle.
        for file in (
            "LICENSE",
            "README.md",
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            "tsconfig.json",
            "uv.lock",
            "pyproject.toml",
            "apps/web/package.json",
            "apps/web/vite.config.ts",
            "apps/web/tsconfig.json",
            "apps/web/tsconfig.app.json",
            "apps/web/tsconfig.node.json",
            "runtime/pyproject.toml",
        ):
            source = ROOT / file
            if source.is_file():
                destination = stage / "source" / file
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        shutil.copy2(ROOT / "LICENSE", stage / "LICENSE")
        from collect_release_sources import collect, archive as source_archive

        collect(stage / "source")
        source_archive(stage / "source", stage / "kyalulu-source.tar.gz")
        shutil.copy2(requirements, stage / "requirements.txt")
        metadata_code = (
            "import importlib.metadata,json,sys;sys.path.insert(0,sys.argv[1]);"
            "print(json.dumps([{'name':d.metadata['Name'],'version':d.version,'license':d.metadata.get('License-Expression') or d.metadata.get('License'),"
            "'classifiers':d.metadata.get_all('Classifier',[])} for d in importlib.metadata.distributions(path=[sys.argv[1]])],indent=2))"
        )
        notices = run(
            [str(executable), "-c", metadata_code, str(stage / "vendor")],
            capture_output=True,
            env=env,
        )
        (stage / "third-party-licenses.json").write_text(
            notices.stdout, encoding="utf-8"
        )
        descriptor = {
            "schema": 1,
            "release": release,
            "target": target,
            "python_version": PYTHON_VERSION,
            "python": executable.relative_to(stage.resolve()).as_posix(),
            "le_auto_install": False,
        }
        (stage / "bundle.json").write_text(
            json.dumps(descriptor, indent=2), encoding="utf-8"
        )
        # Materialize interpreter symlinks; USTAR allows the launcher to reject all
        # link types and extended records. No developer data is in the allowlist.
        with tarfile.open(
            Path(tmp) / artifact.name, "w:gz", format=tarfile.USTAR_FORMAT, dereference=True
        ) as archive:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    archive.add(
                        file,
                        arcname=file.relative_to(stage).as_posix(),
                        recursive=False,
                    )
        with (Path(tmp) / artifact.name).open("rb") as stream:
            sha = hashlib.file_digest(stream, "sha256").hexdigest()
        manifest = {
            "schema": 1,
            "release": release,
            "artifacts": {
                target: {
                    "url": f"https://github.com/ELRdn/Kyalulu/releases/download/npm-{release}/{artifact.name}",
                    "sha256": sha,
                }
            },
            "gates": {"device_accepted": False, "license_reviewed": False},
        }
        (Path(tmp) / manifest_file.name).write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        (Path(tmp) / artifact.name).rename(artifact)
        (Path(tmp) / manifest_file.name).rename(manifest_file)
        return artifact


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release", default="0.1.0-beta.1")
    parser.add_argument("--web-dist", type=Path)
    parser.add_argument(
        "--target", required=True, choices=("win32-x64", "darwin-arm64")
    )
    args = parser.parse_args()
    print(build(args.output.resolve(), args.release, args.target, args.web_dist))
