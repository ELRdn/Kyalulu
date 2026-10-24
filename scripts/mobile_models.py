"""Prepare and publish byte-verified, tensor-preserving mobile GGUF shards.

Install tools into .artifacts/mobile-python: huggingface_hub==2.2.0 gguf==0.19.0
Run: python scripts/mobile_models.py --publish
Only generated files inside .artifacts/mobile-models are cleaned after remote verification.
"""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.artifacts/mobile-python'))
WORK = ROOT / '.artifacts/mobile-models'
CATALOG = ROOT / 'apps/web/src/mobile/catalog.generated.json'
DEST = 'Naotaka0127/Kyalulu-Mobile-GGUF'
SOURCES = [
    ('kyalulu-iq3m', 'Kyalulu E2B JP Rolepaly beta · IQ3_M', 'Naotaka0127/Kyalulu-E2B-JP-Rolepaly-beta-GGUF', 'afa8d2cf7d521cf045d8ac90a790670083d320a4', 'Kyalulu-E2B-JP-Rolepaly-beta-IQ3_M.gguf'),
    ('google-q4', 'Google Gemma 4 E2B QAT · Q4_0', 'google/gemma-4-E2B-it-qat-q4_0-gguf', '675cff42a74c774d6cb76f76d8eacb49b48c9b93', 'gemma-4-E2B_q4_0-it.gguf'),
    ('heretic-iq3m', 'Heretic Gemma 4 E2B · IQ3_M', 'mradermacher/gemma-4-E2B-it-qat-q4_0-unquantized-heretic-i1-GGUF', 'ad4ee4e644fb0123d44deea5c5a4ee9c172a64c6', 'gemma-4-E2B-it-qat-q4_0-unquantized-heretic.i1-IQ3_M.gguf'),
]
ONNX_REPO = 'onnx-community/gemma-4-E2B-it-qat-mobile-ONNX'
ONNX_REV = 'a7f19b0ab28252b77cea830f52b8290b2479c87d'


def sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def download(url: str, path: Path, size: int, digest: str):
    if path.is_file() and path.stat().st_size == size and sha(path) == digest:
        return
    if shutil.disk_usage(WORK).free < size * 2 + 512 * 1024**2:
        raise RuntimeError('Not enough space for one source and its verified shards')
    part = path.with_suffix(path.suffix + '.part')
    h = hashlib.sha256()
    count = 0
    # A fresh signed URL avoids cached, expired Hugging Face CDN redirects.
    with urllib.request.urlopen(url + '?download=true', timeout=180) as r, part.open('wb') as f:
        if r.status != 200:
            raise RuntimeError(f'Download HTTP {r.status}')
        for chunk in iter(lambda: r.read(4 * 1024 * 1024), b''):
            f.write(chunk)
            h.update(chunk)
            previous = count // (128 * 1024**2)
            count += len(chunk)
            if count // (128 * 1024**2) != previous:
                print(f'{path.name}: {count}/{size} bytes', flush=True)
    if count != size or h.hexdigest() != digest:
        raise RuntimeError('Source size/hash mismatch; no publish')
    part.replace(path)


def tensor_inventory(paths: list[Path]):
    from gguf import GGUFReader
    result = {}
    for path in paths:
        reader = GGUFReader(str(path), 'r')
        for t in reader.tensors:
            if t.name in result:
                raise RuntimeError('Duplicate tensor: ' + t.name)
            result[t.name] = {'shape': t.shape.tolist(), 'type': int(t.tensor_type),
                              'sha256': hashlib.sha256(memoryview(t.data).cast('B')).hexdigest()}
        del reader
        gc.collect()
    return result


def splitter() -> Path:
    target = WORK / 'llama-b10964-bin-win-cpu-x64'
    exe = target / 'llama-gguf-split.exe'
    if exe.is_file():
        return exe
    asset = next(a for a in get_json('https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b10964')['assets']
                 if a['name'] == 'llama-b10964-bin-win-cpu-x64.zip')
    archive = WORK / asset['name']
    download(asset['browser_download_url'], archive, asset['size'], '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7')
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            resolved = (target / info.filename).resolve()
            if not resolved.is_relative_to(target.resolve()):
                raise RuntimeError('Unsafe archive member')
        z.extractall(target)
    if not exe.is_file():
        matches = list(target.rglob('llama-gguf-split.exe'))
        if len(matches) != 1:
            raise RuntimeError('Missing split executable')
        return matches[0]
    return exe


def write_catalog(entries):
    CATALOG.parent.mkdir(parents=True, exist_ok=True)
    CATALOG.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def onnx_entry():
    metadata = get_json(f'https://huggingface.co/api/models/{ONNX_REPO}/revision/{ONNX_REV}?blobs=true')
    files = []
    for f in metadata['siblings']:
        name = f['rfilename']
        if name in ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'chat_template.jinja'] or name.startswith(('onnx/decoder_model_', 'onnx/embed_tokens_')):
            url = f'https://huggingface.co/{ONNX_REPO}/resolve/{ONNX_REV}/{name}'
            digest = f.get('lfs', {}).get('sha256')
            if not digest:
                digest = hashlib.sha256(urllib.request.urlopen(url, timeout=60).read()).hexdigest()
            files.append({'path': name, 'url': url, 'bytes': f['size'], 'sha256': digest})
    return {'id': 'google-mobile-onnx', 'name': 'Google Gemma 4 E2B Mobile QAT · ONNX q2f16', 'runtime': 'onnx',
            'repo': ONNX_REPO, 'revision': ONNX_REV, 'source': 'https://huggingface.co/google/gemma-4-E2B-it-qat-mobile-ct',
            'license': 'Apache-2.0', 'files': files, 'temperature': 1, 'topK': 64, 'topP': .95,
            'note': '同じMobile QAT系の公開ONNX変換版です。CTファイルそのものではありません。WebGPU・shader-f16が必要です。'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--only', choices=[s[0] for s in SOURCES])
    parser.add_argument('--catalog-only', action='store_true')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    entries = json.loads(CATALOG.read_text(encoding='utf-8')) if CATALOG.exists() else []
    entries = [e for e in entries if e['id'] != 'google-mobile-onnx'] + [onnx_entry()]
    for ident, name, repo, revision, filename in SOURCES:
        if not any(e['id'] == ident for e in entries):
            entries.append({'id': ident, 'name': name, 'runtime': 'gguf', 'repo': repo, 'revision': revision,
                            'source': f'https://huggingface.co/{repo}', 'license': 'Apache-2.0', 'files': [],
                            'temperature': .85 if ident == 'kyalulu-iq3m' else 1, 'topK': 64, 'topP': .95,
                            'note': 'IQ3_Mは実験用の容量優先モデルです。' if 'iq3m' in ident else ''})
    write_catalog(entries)
    if args.catalog_only:
        return
    from huggingface_hub import HfApi
    from huggingface_hub.utils import disable_progress_bars
    disable_progress_bars()
    api = HfApi()
    if args.publish:
        if api.whoami()['name'] != 'Naotaka0127':
            raise RuntimeError('Wrong publishing account')
        api.create_repo(DEST, private=False, exist_ok=True)
        info = api.model_info(DEST)
        if info.private:
            raise RuntimeError('Existing destination is private; no visibility change')
    exe = splitter()
    for ident, name, repo, revision, filename in SOURCES:
        if args.only and args.only != ident:
            continue
        entry = next(e for e in entries if e['id'] == ident)
        if entry['files']:
            print('Already catalogued:', ident, flush=True)
            continue
        meta = get_json(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true')
        src = next(f for f in meta['siblings'] if f['rfilename'] == filename)
        folder = WORK / ident
        folder.mkdir(exist_ok=True)
        source = folder / 'source.gguf'
        download(f'https://huggingface.co/{repo}/resolve/{revision}/{filename}', source, src['size'], src['lfs']['sha256'])
        before = tensor_inventory([source])
        out = folder / 'shards'
        out.mkdir(exist_ok=True)
        if not list(out.glob('*.gguf')):
            subprocess.run([str(exe), '--split-max-size', '512M', str(source), str(out / ident)], check=True)
        shards = sorted(out.glob('*.gguf'))
        if not shards or any(p.stat().st_size >= 2**31 for p in shards):
            raise RuntimeError('Shard missing or >=2GiB; no publish')
        after = tensor_inventory(shards)
        if before != after:
            raise RuntimeError('Tensor names/shapes/types/bytes changed; no publish')
        provenance = {'source_repo': repo, 'source_revision': revision, 'source_file': filename,
                      'source_sha256': src['lfs']['sha256'], 'splitter': 'llama.cpp b10964',
                      'tensor_count': len(before), 'tensors': before,
                      'files': [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': sha(p)} for p in shards]}
        (out / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n', encoding='utf-8')
        (out / 'README.md').write_text(f'# {name}\n\nSource: https://huggingface.co/{repo}/tree/{revision}\n\nApache-2.0. Tensor-preserving GGUF split; no requantization or PLE removal.\n\nEvery tensor was compared by name, shape, type and SHA-256. See provenance.json.\n', encoding='utf-8')
        if args.publish:
            result = api.upload_folder(repo_id=DEST, folder_path=out, path_in_repo=ident,
                                       commit_message=f'Add verified tensor-preserving {ident} shards')
            published_revision = result.oid
            remote = get_json(f'https://huggingface.co/api/models/{DEST}/revision/{published_revision}?blobs=true')
            remote_files = {f['rfilename']: f for f in remote['siblings']}
            for f in provenance['files']:
                r = remote_files[f'{ident}/{f["path"]}']
                if r['size'] != f['bytes'] or r.get('lfs', {}).get('sha256') != f['sha256']:
                    raise RuntimeError('Remote hash mismatch; keep local artifacts')
            entry['files'] = [{**f, 'url': f'https://huggingface.co/{DEST}/resolve/{published_revision}/{ident}/{f["path"]}'} for f in provenance['files']]
            entry['distributionRevision'] = published_revision
            write_catalog(entries)
            # Generated downloads/shards only; originals in other projects are never touched.
            for path in [source, *shards]:
                resolved = path.resolve()
                if not resolved.is_relative_to(WORK.resolve()):
                    raise RuntimeError('Cleanup escaped the generated workspace')
                resolved.unlink()
            print('Published and remote-verified:', ident, published_revision, flush=True)
        else:
            print('Prepared only:', out, flush=True)


if __name__ == '__main__':
    main()
