"""Build the patched public SDK beside its matching standard/compat WASM."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
LLAMA_REVISION = '46ca246de9bb1c35269722a6240d37d9dfd79cad'
SDK_FIXED_INPUTS = ('LICENCE', 'package.json', 'tsconfig.build.json', 'cpp/glue.hpp',
                    'cpp/wllama.cpp', 'cpp/wllama-context.h',
                    'cpp/generate_glue_prototype.js', 'scripts/generate_wasm_from_cdn.js',
                    'src/index.ts', 'src/wllama.ts',
                    'src/workers-code/llama-cpp.js', 'src/workers-code/opfs-utils.js')
SDK_GENERATED = {'src/workers-code/generated.ts', 'src/glue/messages.ts', 'src/wasm-from-cdn.ts'}


def input_manifest(work, *, verify=False):
    """Hash only the public SDK inputs transferred by the WASM producer (no Node needed)."""
    work = Path(work).resolve()
    source = work / 'wllama'
    names = set(SDK_FIXED_INPUTS)
    for path in (source / 'src').rglob('*'):
        name = path.relative_to(source).as_posix()
        if path.suffix == '.ts' and not name.endswith('.test.ts') and name not in SDK_GENERATED:
            names.add(name)
    files = {}
    for name in sorted(names):
        path = source / name
        if any(parent.is_symlink() for parent in (path, *path.parents)) or not path.resolve().is_relative_to(work):
            raise ValueError('SDK input escaped work directory')
        files['wllama/' + name] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = work / 'SDK_INPUTS.json'
    if manifest.is_symlink():
        raise ValueError('SDK manifest must not be linked')
    if verify:
        if json.loads(manifest.read_text(encoding='utf-8')) != files:
            raise ValueError('SDK input manifest differs from public source inputs')
    else:
        manifest.write_text(json.dumps(files, indent=2) + '\n', encoding='utf-8')
    return files


def build(work):
    work = Path(work).resolve()
    if not work.is_relative_to(ROOT / '.artifacts'):
        raise ValueError('SDK work directory must stay inside workspace artifacts')
    source, output = work / 'wllama', work / 'sdk'
    if output.exists() or output.is_symlink():
        raise ValueError('Fresh SDK output required')
    for path in (source, *source.rglob('*')):
        if path.is_symlink() or not path.resolve().is_relative_to(work):
            raise ValueError('SDK source escaped work directory')
    for name, marker in (('src/wllama.ts', 'async countChatTokens('),
                         ('cpp/wllama-context.h', 'action_count_chat_tokens(')):
        if marker not in (source / name).read_text(encoding='utf-8'):
            raise ValueError('Apply the pinned chat-count patch before building the SDK')
    if 'count_probe_' in (source / 'cpp/wllama-context.h').read_text(encoding='utf-8'):
        raise ValueError('Diagnostic count probes must not enter the application SDK')
    inputs_before = input_manifest(work, verify=(work / 'SDK_INPUTS.json').exists())
    assets = {}
    for variant in ('standard', 'compat'):
        for name in ('wllama.js', 'wllama.wasm'):
            path = work / ('build-' + variant) / name
            if path.is_symlink() or not path.resolve().is_relative_to(work):
                raise ValueError('SDK asset escaped work directory')
            data = path.read_bytes()
            if not data or name.endswith('.wasm') and data[:4] != b'\0asm':
                raise ValueError('Both matched WASM variants are required')
            # shortcut: wire markers catch stale binaries, real model proof remains a separate gate.
            if name.endswith('.wasm') and not all(marker in data for marker in (b'ctok_req', b'ctok_res')):
                raise ValueError('Rebuild both WASM variants with the native chat-count patch')
            if name.endswith('.wasm') and b'countProbe' in data:
                raise ValueError('Diagnostic count probes must not enter the application SDK')
            assets[f'{variant}/{name}'] = hashlib.sha256(data).hexdigest()
    node = shutil.which('node')
    compiler = ROOT / 'apps/web/node_modules/typescript/bin/tsc'
    if not node or not compiler.is_file():
        raise RuntimeError('Use the locked workspace Node/TypeScript installation')
    subprocess.run([node, 'cpp/generate_glue_prototype.js'], cwd=source, check=True)
    subprocess.run([node, 'scripts/generate_wasm_from_cdn.js'], cwd=source, check=True)
    embedded = {'LIBLLAMA_VERSION': LLAMA_REVISION + '+kyalulu-chat-count',
                'LLAMA_CPP_WORKER_CODE': (source / 'src/workers-code/llama-cpp.js').read_text(encoding='utf-8'),
                'OPFS_UTILS_WORKER_CODE': (source / 'src/workers-code/opfs-utils.js').read_text(encoding='utf-8'),
                'WLLAMA_EMSCRIPTEN_CODE': (work / 'build-standard/wllama.js').read_text(encoding='utf-8')}
    generated = source / 'src/workers-code/generated.ts'
    generated.write_text(''.join(f'export const {name} = {json.dumps(value)};\n'
                                 for name, value in embedded.items()), encoding='utf-8', newline='\n')
    subprocess.run([node, str(compiler), '-p', 'tsconfig.build.json', '--outDir', str(output)],
                   cwd=source, check=True)
    # Match upstream post_build.sh without needing a platform-specific shell.
    for path in output.rglob('*.js'):
        if path == output / 'workers-code/generated.js':
            continue  # Embedded raw worker/glue strings must remain byte-for-byte intact.
        text = path.read_text(encoding='utf-8')
        text = re.sub(r"(\bfrom\s+['\"])(\.[^'\"\n]+)(['\"])",
                      lambda match: match[1] + match[2] + ('' if match[2].endswith('.js') else '.js') + match[3], text)
        path.write_text(text, encoding='utf-8', newline='\n')
    (output / 'package.json').write_text('{"type":"module"}\n', encoding='utf-8')
    shutil.copyfile(source / 'LICENCE', output / 'LICENCE')
    if 'countChatTokens(' not in (output / 'wllama.d.ts').read_text(encoding='utf-8'):
        raise ValueError('Public count declaration missing')
    files = {path.relative_to(output).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in sorted(output.rglob('*')) if path.is_file()}
    inputs = {path.relative_to(source).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(source.rglob('*')) if path.is_file()}
    record = {'llama_revision': LLAMA_REVISION, 'runtime_assets': assets, 'sdk_files': files,
              'source_files': inputs, 'sdk_inputs': inputs_before,
              'native_count_verified': False, 'release_accepted': False}
    (work / 'sdk-build.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--record-inputs', '--verify-inputs'):
        input_manifest(ROOT / '.artifacts/mobile-wasm', verify=sys.argv[1] == '--verify-inputs')
    else:
        build(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.artifacts/mobile-wasm')
