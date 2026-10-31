"""Fetch the pinned WASM build inputs inside the ignored workspace directory.

Then run (WSL): python3 emsdk/emsdk.py install 4.0.20 && ... activate 4.0.20
Run this script from Windows, prepare.py, then build.sh from WSL/Linux.
The source patch and both source revisions must accompany distributed binaries.
"""
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / '.artifacts/mobile-wasm'
SOURCES = [
    ('https://api.github.com/repos/ngxson/wllama/zipball/3.8.1', 'wllama', True),
    ('https://api.github.com/repos/ggml-org/llama.cpp/zipball/46ca246de9bb1c35269722a6240d37d9dfd79cad', 'llama.cpp', True),
    ('https://api.github.com/repos/emscripten-core/emsdk/zipball/4.0.20', 'emsdk', True),
    ('https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-linux.zip', 'ninja', False),
    ('https://github.com/google/dawn/releases/download/v20260317.182325/emdawnwebgpu_pkg-v20260317.182325.zip', 'emdawn', False),
]


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    lock_path = WORK/'downloads.json'
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else {}
    for url, name, strip in SOURCES:
        dest = WORK/name
        if dest.exists() or (name == 'llama.cpp' and (WORK/'wllama/llama.cpp/src/llama.cpp').exists()):
            continue
        data = urllib.request.urlopen(url, timeout=180).read()
        digest = hashlib.sha256(data).hexdigest()
        if url in lock and lock[url] != digest:
            raise RuntimeError('Downloaded build source differs from recorded checksum')
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            prefix = archive.namelist()[0].split('/')[0]+'/' if strip else ''
            for item in archive.infolist():
                relative = item.filename[len(prefix):]
                if not relative:
                    continue
                target = dest/relative
                if not target.resolve().is_relative_to(dest.resolve()):
                    raise RuntimeError('Unsafe archive member')
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(item))
                    if (item.external_attr >> 16) & 0o111:
                        target.chmod(0o755)
        lock[url] = digest
        lock_path.write_text(json.dumps(lock, indent=2)+'\n')
        print('Prepared', name, digest, flush=True)
    if not (WORK/'cmake-3.31.6-linux-x86_64/bin/cmake').exists():
        url = 'https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-linux-x86_64.tar.gz'
        data = urllib.request.urlopen(url, timeout=180).read()
        digest = hashlib.sha256(data).hexdigest()
        if url in lock and lock[url] != digest:
            raise RuntimeError('CMake archive checksum changed')
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            archive.extractall(WORK, filter='data')
        lock[url] = digest
        lock_path.write_text(json.dumps(lock, indent=2)+'\n')


if __name__ == '__main__':
    main()
