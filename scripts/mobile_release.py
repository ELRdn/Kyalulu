"""Verify a mobile Pages build and package its corresponding application source.

No upload or credential access. Run after pnpm --filter web build:mobile.
"""
from pathlib import Path
import base64
import gzip
import hashlib
import json
import re
import tempfile
import zipfile

from collect_release_sources import collect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/mobile-pages'


def main():
    if not OUT.resolve().is_relative_to((ROOT/'.artifacts').resolve()):
        raise RuntimeError('Output escaped generated workspace')
    sw = (OUT/'sw.js').read_text(encoding='utf-8')
    integrity = json.loads(re.search(r'const INTEGRITY = (.*);', sw).group(1))
    compressed = json.loads(re.search(r'const COMPRESSED = (.*);', sw).group(1))
    for name, expected in integrity.items():
        path = (OUT/compressed.get(name,{}).get('path',name)).resolve()
        if not path.is_relative_to(OUT.resolve()):
            raise RuntimeError('Precache path escaped output')
        data = path.read_bytes()
        if name in compressed:
            packed_hash='sha256-'+base64.b64encode(hashlib.sha256(data).digest()).decode()
            if packed_hash != compressed[name]['integrity']:
                raise RuntimeError('Compressed asset integrity mismatch')
            data = gzip.decompress(data)
        if 'sha256-'+base64.b64encode(hashlib.sha256(data).digest()).decode() != expected:
            raise RuntimeError('Precache integrity mismatch: '+name)
    catalog = json.loads((ROOT/'apps/web/src/mobile/catalog.generated.json').read_text(encoding='utf-8'))
    if len(catalog) != 4 or any(not m['files'] for m in catalog):
        raise RuntimeError('All four model distributions must be pinned before publication')
    if 'Kyalulu Mobile' not in (OUT/'index.html').read_text(encoding='utf-8'):
        raise RuntimeError('Wrong application entry point')
    for name, origin in [('wllama-MIT.txt', ROOT/'.artifacts/mobile-wasm/wllama/LICENCE'),
                         ('llama-MIT.txt',ROOT/'.artifacts/mobile-wasm/wllama/llama.cpp/LICENSE'),
                         ('transformers-Apache-2.0.txt',ROOT/'apps/web/node_modules/@huggingface/transformers/LICENSE'),
                         ('onnxruntime-MIT.txt',ROOT/'docs/licenses/onnxruntime-MIT.txt'),
                         ('Dawn-WebGPU.txt',ROOT/'.artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu/src/LICENSE'),
                         ('Dawn-WebGPU-cpp.txt',ROOT/'.artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu_cpp/LICENSE'),
                         ('jsonhpp-MIT.txt',ROOT/'.artifacts/mobile-wasm/wllama/llama.cpp/licenses/LICENSE-jsonhpp'),
                         ('AGPL-3.0.txt',ROOT/'LICENSE')]:
        (OUT/'licenses').mkdir(exist_ok=True)
        (OUT/'licenses'/name).write_bytes(origin.read_bytes())
    (OUT/'source').mkdir(exist_ok=True)
    archive = OUT/'source/kyalulu-mobile-source.zip'
    with tempfile.TemporaryDirectory(dir=OUT) as temporary:
        source = Path(temporary) / 'source'
        collect(source)
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for p in sorted(source.rglob('*')):
                if p.is_file():
                    z.write(p,p.relative_to(source).as_posix())
    manifest = {'application':'Kyalulu Mobile','source_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
                'wasm_sources':{'wllama':'3.8.1','llama.cpp':'46ca246de9bb1c35269722a6240d37d9dfd79cad','emscripten':'4.0.20'},
                'models':[{k:m[k] for k in ['id','repo','revision','files']} for m in catalog],
                'files':{}}
    files = [p for p in OUT.rglob('*') if p.is_file() and p.name != 'release-manifest.json']
    if len(files)>20000:
        raise RuntimeError('Pages file count exceeded')
    for p in files:
        if p.stat().st_size>25*1024**2 or p.suffix in ['.gguf','.safetensors','.map','.db','.vault'] or p.name.startswith('.env'):
            raise RuntimeError('Oversized/private/model asset in Pages output: '+p.name)
        manifest['files'][p.relative_to(OUT).as_posix()]=hashlib.sha256(p.read_bytes()).hexdigest()
    (OUT/'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'precache_assets_verified':len(integrity),'pages_files':len(files)+1,'max_file_bytes':max(p.stat().st_size for p in files),
                      'source_sha256':manifest['source_sha256'],'models':len(catalog)}))


if __name__ == '__main__':
    main()
