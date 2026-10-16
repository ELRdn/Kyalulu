"""Prepare prebuilt Web and allowlisted Cloud sources; never deploy or copy keys."""

import argparse
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from collect_release_sources import ROOT, archive, collect


def prepare(output):
    output.mkdir(parents=True, exist_ok=True)
    if not (ROOT / "apps/web/dist/index.html").is_file():
        raise ValueError("Build Web locally before preparing the cloud bundle")
    with tempfile.TemporaryDirectory(dir=output) as temporary:
        stage = Path(temporary) / "stage"
        stage.mkdir()
        corresponding = Path(temporary) / "source"
        collect(corresponding)
        archive(corresponding, stage / "kyalulu-source.tar.gz")
        for directory in ("runtime/python", "characters", "personas", "worlds", "prompts"):
            shutil.copytree(corresponding / directory, stage / directory)
        shutil.copytree(ROOT / "apps/web/dist", stage / "web")
        for name in ("LICENSE", "scripts/cloud_admin.py", "deploy/cloud/compose.yml",
                     "deploy/cloud/compose.vps.yml", "deploy/cloud/Caddyfile.example"):
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        shutil.copy2(ROOT / "deploy/cloud/Dockerfile.prebuilt", stage / "Dockerfile")
        (stage / ".dockerignore").write_text(
            "**/.env*\n**/*.key\n**/*.pem\n**/*.vault\n**/*.db\n**/*.sqlite*\n", encoding="ascii")
        subprocess.run([
            "uv", "export", "--frozen", "--all-packages", "--extra", "remote",
            "--no-dev", "--no-emit-workspace", "--format", "requirements-txt",
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
        destination = output / "kyalulu-cloud.tar.gz"
        with tarfile.open(destination, "w:gz") as bundle:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    data = file.read_bytes()
                    member = tarfile.TarInfo(file.relative_to(stage).as_posix())
                    member.size, member.mode = len(data), 0o644
                    bundle.addfile(member, io.BytesIO(data))
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        destination.with_suffix(destination.suffix + ".sha256").write_text(
            f"{digest}  {destination.name}\n", encoding="ascii")
        print(f"Prepared {len(manifest)} files; no keys, connection or deployment")
        print(f"SHA256 {digest}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/cloud-vps")
    prepare(parser.parse_args().output)
