"""Prepare an allowlisted VPS source bundle locally; never connect or deploy."""

import hashlib
import io
from pathlib import Path
import tarfile


ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "runtime/python/relay/__init__.py",
    "runtime/python/relay/app.py",
    "runtime/python/relay/store.py",
    "scripts/relay.py",
    "deploy/remote/Dockerfile",
    "deploy/remote/Dockerfile.dockerignore",
    "deploy/remote/compose.pages.yaml",
    "deploy/remote/Caddyfile.relay",
    "deploy/remote/.env.pages.example",
    "deploy/remote/README.md",
    "deploy/remote/CLOUDFLARE.md",
    "deploy/remote/CONOHA.md",
    "deploy/remote/backup-encrypted.sh",
    "deploy/remote/kyalulu-backup.service",
    "deploy/remote/kyalulu-backup.timer",
)


def main():
    destination = ROOT / ".artifacts/conoha"
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / "kyalulu-relay.tar.gz"
    manifest = []
    with tarfile.open(archive, "w:gz") as bundle:
        for name in FILES:
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"Expected regular source file: {name}")
            data = source.read_bytes()
            member = tarfile.TarInfo(name)
            member.mode = 0o644
            member.size = len(data)
            bundle.addfile(member, io.BytesIO(data))
            manifest.append(f"{hashlib.sha256(data).hexdigest()}  {name}")
        data = ("\n".join(manifest) + "\n").encode()
        member = tarfile.TarInfo("SHA256SUMS")
        member.mode = 0o644
        member.size = len(data)
        bundle.addfile(member, io.BytesIO(data))
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (destination / "kyalulu-relay.tar.gz.sha256").write_text(
        f"{digest}  {archive.name}\n", encoding="ascii"
    )
    print(f"Prepared {len(FILES)} allowlisted source files: {archive}")
    print("No connection, installation, DNS change or deployment performed.")


if __name__ == "__main__":
    main()
