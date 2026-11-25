"""Prepare prebuilt Web and allowlisted Cloud sources; never deploy or copy keys."""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile

from collect_release_sources import ROOT, archive, collect, copy_runtime_licenses
from prepare_online_pwa import (
    check_relay_origin, checked_mode, checked_tree, declaration, next_relay_origin, prepare as prepare_pwa, sri,
)
from sync_online_route_groups import sync as check_online_routes


def retain_assets(previous, target):
    if not stat.S_ISDIR(checked_mode(previous)):
        raise ValueError("Expected a prior release directory")
    worker = previous / "sw.js"
    if not stat.S_ISREG(checked_mode(worker)):
        raise ValueError("Expected a prior release service worker")
    script = worker.read_text(encoding="utf-8")
    digests = declaration(script, "INTEGRITY")
    packed = declaration(script, "COMPRESSED")
    # Only immutable build outputs from the previous worker's verified inventory
    # belong in the compatibility window. Never add them to the new precache.
    for directory in ("assets", "_next/static"):
        folder = previous / directory
        if not folder.exists():
            continue
        if directory == "_next/static" and not stat.S_ISDIR(checked_mode(folder.parent)):
            raise ValueError("Expected a prior Next asset directory")
        for file in checked_tree(folder):
            name = file.relative_to(previous).as_posix()
            compressed = name.endswith(".gz")
            logical = name.removesuffix(".gz")
            if logical not in digests or (directory == "assets" and not re.search(r"[-.][\w-]{8,}\.[\w]+$", logical)):
                continue
            expected = digests[logical]
            if compressed and packed.get(logical, {}).get("path") != name:
                continue
            data = file.read_bytes()
            if sri(data) != (packed[logical]["integrity"] if compressed else expected):
                raise ValueError(f"Prior release integrity mismatch: {name}")
            dest = target / name
            if dest.exists():
                if dest.read_bytes() != data:
                    raise ValueError(f"Immutable asset collision: {name}")
            else:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
            if compressed:
                wasm = target / logical
                if not wasm.exists():
                    body = gzip.decompress(data)
                    if sri(body) != expected:
                        raise ValueError(f"Prior release decompression mismatch: {name}")
                    wasm.write_bytes(body)
    return declaration(script, "VERSION")


def package_online(stage, source, web_dist, next_build, previous, expected_relay):
    worker_version = prepare_pwa(web_dist, next_build, stage / "web")
    target = stage / "online"
    application = target / "apps/online"
    application.mkdir(parents=True)
    for name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "apps/online/package.json", "apps/online/next.config.ts"):
        shutil.copyfile(source / name, target / name)
    destination = application / ".next"
    for name in ("server", "static"):
        for file in checked_tree(next_build / name):
            packaged = destination / file.relative_to(next_build)
            packaged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, packaged)
    # Only runtime manifests belong with the private Node service. Build caches and
    # diagnostic traces can contain machine-specific information.
    for name in ("BUILD_ID", "package.json", "app-path-routes-manifest.json", "build-manifest.json",
                 "images-manifest.json", "routes-manifest.json", "prerender-manifest.json",
                 "required-server-files.json", "required-server-files.js", "react-loadable-manifest.json"):
        file = next_build / name
        if not stat.S_ISREG(checked_mode(file)):
            raise ValueError(f"Expected Next runtime manifest: {name}")
        shutil.copyfile(file, destination / name)
    check_online_routes(source, next_manifest=destination / "app-path-routes-manifest.json")
    relay = next_relay_origin((destination / "required-server-files.json").read_bytes())
    worker = (stage / "web/sw.js").read_text(encoding="utf-8")
    check_relay_origin(worker, next_origin=relay, expected=expected_relay)
    build_id = (destination / "BUILD_ID").read_text().strip()
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", build_id):
        raise ValueError("Invalid Next build ID")
    info = {"next_build_id": build_id, "worker_version": worker_version,
            "retained_workers": [retain_assets(path, stage / "web") for path in previous],
            "node_version": subprocess.check_output(["node", "--version"], text=True).strip().removeprefix("v"),
            "next_version": json.loads((application / "package.json").read_text())["dependencies"]["next"],
            "relay_origin": relay}
    shutil.copyfile(source / "deploy/cloud/Dockerfile.online", target / "Dockerfile")
    (stage / "online-release.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")


def prepare(output, *, unified=False, online=False, web_dist=None, previous=(), expected_relay=None):
    if previous and not (online or unified):
        raise ValueError("Retaining web assets requires a unified or Next release")
    if expected_relay is not None and not (online or (unified and previous)):
        raise ValueError("An explicit Relay origin requires an online candidate or a companion recovery bundle")
    if online or previous:
        if output.exists():
            raise ValueError("Choose a new online release directory to preserve previous bundles")
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
            release = Path(temporary) / "release"
            build_bundle(release, unified=True, online=online, web_dist=web_dist,
                         previous=previous, expected_relay=expected_relay)
            release.rename(output)
        return
    build_bundle(output, unified=unified, online=False, web_dist=web_dist, previous=(), expected_relay=None)


def build_bundle(output, *, unified, online, web_dist, previous, expected_relay):
    output.mkdir(parents=True, exist_ok=True)
    web_dist = web_dist or ROOT / ('.artifacts/unified-app' if unified else 'apps/web/dist')
    if not (web_dist / "index.html").is_file():
        raise ValueError("Build Web locally before preparing the cloud bundle")
    for path in web_dist.rglob('*'):
        if path.is_symlink() or not path.resolve().is_relative_to(web_dist.resolve()):
            raise ValueError('Prebuilt Web escaped its build directory')
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        stage = Path(temporary) / "stage"
        stage.mkdir()
        corresponding = Path(temporary) / "source"
        collect(corresponding)
        archive(corresponding, stage / "kyalulu-source.tar.gz")
        for directory in ("runtime/python", "characters", "personas", "worlds", "prompts", "scenarios"):
            shutil.copytree(corresponding / directory, stage / directory)
        if online:
            package_online(stage, corresponding, web_dist, ROOT / "apps/online/.next", previous, expected_relay)
        else:
            shutil.copytree(web_dist, stage / "web")
            if previous:
                worker = (stage / "web/sw.js").read_text(encoding="utf-8")
                relay = check_relay_origin(worker, expected=expected_relay)
                recovered = {"worker_version": declaration(worker, "VERSION"),
                             "retained_workers": [retain_assets(path, stage / "web") for path in previous]}
                if relay is not None:
                    recovered["relay_origin"] = relay
                (stage / "recovery-release.json").write_text(json.dumps(recovered, indent=2) + "\n", encoding="utf-8")
        if unified:
            copy_runtime_licenses(ROOT, stage / "web")
        for name in ("LICENSE", "scripts/cloud_admin.py", "deploy/cloud/compose.yml",
                     "deploy/cloud/compose.vps.yml", "deploy/cloud/Caddyfile.example",
                     *(("deploy/cloud/compose.online.yml",) if online else ()),
                     *(("deploy/cloud/compose.online-proxy.yml", "scripts/probe_online_rollout.py")
                       if online or previous else ()),
                     *(("deploy/cloud/Caddyfile.unified.example",
                        "deploy/cloud/Caddyfile.cloud-migration.example") if unified else ())):
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        shutil.copy2(ROOT / "deploy/cloud/Dockerfile.prebuilt", stage / "Dockerfile")
        (stage / ".dockerignore").write_text(
            "**/.env*\n**/*.key\n**/*.pem\n**/*.vault\n**/*.db\n**/*.sqlite*\n", encoding="ascii")
        subprocess.run([
            "uv", "export", "--frozen", "--all-packages", "--extra", "remote",
            "--no-dev", "--no-emit-workspace", "--no-header", "--format", "requirements-txt",
            "--output-file", str(stage / "requirements.txt"),
        ], cwd=ROOT, check=True, stdout=subprocess.PIPE)
        manifest = []
        for file in sorted(stage.rglob("*")):
            if file.is_symlink():
                raise ValueError("Cloud staging must contain only regular files")
            if file.is_file():
                if (file.name.startswith(".env") or file.suffix.lower() in
                        {".key", ".pem", ".vault", ".db", ".sqlite", ".sqlite3", ".gguf"}):
                    raise ValueError("Private data is not permitted in a cloud bundle")
                manifest.append(f"{hashlib.sha256(file.read_bytes()).hexdigest()}  "
                                f"{file.relative_to(stage).as_posix()}")
        (stage / "SHA256SUMS").write_text("\n".join(manifest) + "\n", encoding="ascii")
        destination = Path(temporary) / "kyalulu-cloud.tar.gz"
        with tarfile.open(destination, "w:gz") as bundle:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    data = file.read_bytes()
                    member = tarfile.TarInfo(file.relative_to(stage).as_posix())
                    member.size, member.mode = len(data), 0o644
                    # Docker Desktop may reuse same-size files with the same mtime when syncing a build context.
                    member.mtime = int(file.stat().st_mtime)
                    bundle.addfile(member, io.BytesIO(data))
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        checksum = destination.with_suffix(destination.suffix + ".sha256")
        checksum.write_text(
            f"{digest}  {destination.name}\n", encoding="ascii")
        destination.replace(output / destination.name)
        checksum.replace(output / checksum.name)
        print(f"Prepared {len(manifest)} files; no keys, connection or deployment")
        print(f"SHA256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/cloud-vps")
    parser.add_argument('--unified', action='store_true', help='Package the verified build:app output')
    parser.add_argument('--online', action='store_true', help='Package the matching Next server, device shell and Cloud runtime')
    parser.add_argument('--web-dist', type=Path, help='Use a specific prebuilt Web directory')
    parser.add_argument('--expected-relay-origin', help='Require the exact HTTPS Relay origin in the build inputs')
    parser.add_argument('--retain-web', action='append', type=Path, default=[],
                        help='Keep immutable assets from this release during rollout and rollback (repeatable)')
    arguments = parser.parse_args()
    prepare(arguments.output, unified=arguments.unified, online=arguments.online, web_dist=arguments.web_dist,
            previous=arguments.retain_web, expected_relay=arguments.expected_relay_origin)
