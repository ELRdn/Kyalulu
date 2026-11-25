"""Verify a private online or recovery bundle in one pass without extracting it."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

from collect_release_sources import ROOT
from prepare_online_pwa import check_relay_origin, declaration, next_relay_origin

NEXT_BUILD = "online/apps/online/.next/"


def digest(stream):
    return hashlib.file_digest(stream, "sha256").hexdigest()


def member_name(member):
    path = PurePosixPath(member.name)
    if (not member.isfile() or path.is_absolute() or ".." in path.parts or ":" in member.name
            or "\\" in member.name or str(path) != member.name):
        raise ValueError("Unexpected archive entry")
    return member.name


def verify(directory, expected=None, compare=False, expected_relay=None):
    bundle = directory / "kyalulu-cloud.tar.gz"
    checksum, filename = (directory / "kyalulu-cloud.tar.gz.sha256").read_text(encoding="ascii").split()
    with bundle.open("rb") as file:
        if filename != bundle.name or digest(file) != checksum or expected is not None and checksum != expected:
            raise ValueError("Private bundle checksum mismatch")
    hashes, metadata = {}, {}
    required = {"online-release.json", "recovery-release.json", NEXT_BUILD + "BUILD_ID",
                NEXT_BUILD + "required-server-files.json",
                "kyalulu-source.tar.gz", "SHA256SUMS", "web/sw.js"}
    with tarfile.open(bundle, "r|gz") as tar:
        for member in tar:
            name = member_name(member)
            if name in hashes:
                raise ValueError("Duplicate bundle entry")
            stream = tar.extractfile(member)
            if name in required:
                metadata[name] = stream.read()
                hashes[name] = hashlib.sha256(metadata[name]).hexdigest()
            else:
                hashes[name] = digest(stream)
    declared = {}
    for line in metadata["SHA256SUMS"].decode("ascii").splitlines():
        sha, name = line.split("  ", 1)
        if name in declared:
            raise ValueError("Duplicate manifest entry")
        declared[name] = sha
    del hashes["SHA256SUMS"]
    if hashes != declared:
        raise ValueError("Bundle members differ from the release manifest")
    records = [name for name in ("online-release.json", "recovery-release.json") if name in metadata]
    if len(records) != 1:
        raise ValueError("Expected exactly one release record")
    release = json.loads(metadata[records[0]])
    worker = metadata["web/sw.js"].decode("utf-8")
    if release["worker_version"] != declaration(worker, "VERSION"):
        raise ValueError("Packaged worker differs from the release record")
    if records[0] == "online-release.json":
        if release["next_build_id"] != metadata[NEXT_BUILD + "BUILD_ID"].decode().strip():
            raise ValueError("Node build ID differs from the release record")
        relay = next_relay_origin(metadata[NEXT_BUILD + "required-server-files.json"])
        if release["relay_origin"] != relay:
            raise ValueError("Next Relay origin differs from the release record")
        check_relay_origin(worker, next_origin=relay, expected=expected_relay)
    elif check_relay_origin(worker, expected=expected_relay) != release.get("relay_origin"):
        raise ValueError("Recovery Relay origin differs from the release record")
    for name, sha in hashes.items():
        prefix = NEXT_BUILD + "static/"
        if name.startswith(prefix) and PurePosixPath(name).suffix in {".js", ".css", ".wasm", ".png", ".woff2"}:
            if hashes.get("web/_next/static/" + name.removeprefix(prefix)) != sha:
                raise ValueError("Device and Node assets differ: " + name)
    matched = 0
    if compare:
        seen = set()
        with tarfile.open(fileobj=io.BytesIO(metadata["kyalulu-source.tar.gz"]), mode="r|gz") as tar:
            for member in tar:
                name = member_name(member)
                if name in seen:
                    raise ValueError("Duplicate public source entry")
                seen.add(name)
                path = ROOT / name
                if not path.resolve().is_relative_to(ROOT.resolve()):
                    raise ValueError("Source comparison escaped the workspace")
                if path.is_file():
                    with path.open("rb") as file:
                        if digest(file) != digest(tar.extractfile(member)):
                            raise ValueError("Workspace differs from corresponding source: " + name)
                    matched += 1
        app_sources = {path.relative_to(ROOT).as_posix() for path in (ROOT / "apps/online/app").rglob("*") if path.is_file()}
        if app_sources - seen or not {"scripts/prepare_online_pwa.py", "apps/online/proxy.ts", "apps/web/public/sw.js"} <= seen:
            raise ValueError("Missing online frontend source")
    print(json.dumps({"bundle_sha256": checksum, "source_sha256": hashes["kyalulu-source.tar.gz"],
                      "members_verified": len(hashes), "workspace_files_compared": matched, **release}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--expected-sha256")
    parser.add_argument("--expected-relay-origin", help="Require the exact HTTPS Relay origin in packaged frontends")
    parser.add_argument("--compare-worktree", action="store_true")
    args = parser.parse_args()
    verify(args.directory, args.expected_sha256, args.compare_worktree, args.expected_relay_origin)
