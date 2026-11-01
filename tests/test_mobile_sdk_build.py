"""The SDK build stays isolated and binds its public output to both asset sets."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def sdk(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'scripts/mobile_wasm/build_sdk.py'
    spec = importlib.util.spec_from_file_location('mobile_sdk_build', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, 'ROOT', tmp_path)
    compiler = tmp_path / 'apps/web/node_modules/typescript/bin/tsc'
    compiler.parent.mkdir(parents=True)
    compiler.write_text('fictional compiler')
    work = tmp_path / '.artifacts/work'
    source = work / 'wllama'
    for name, content in {
        'src/wllama.ts': 'async countChatTokens(',
        'cpp/wllama-context.h': 'action_count_chat_tokens(',
        'src/workers-code/llama-cpp.js': 'fictional worker',
        'src/workers-code/opfs-utils.js': 'fictional opfs',
    }.items():
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    for name in module.SDK_FIXED_INPUTS:
        target = source / name
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('fictional public input')
    for variant in ('standard', 'compat'):
        target = work / ('build-' + variant)
        target.mkdir()
        (target / 'wllama.js').write_text('fictional ' + variant)
        (target / 'wllama.wasm').write_bytes(b'\0asmctok_req\0ctok_res\0' + variant.encode())
    calls = []

    def run(args, *, cwd, check):
        assert cwd == source and check
        calls.append(args)
        if str(compiler) in args:
            output = work / 'sdk'
            output.mkdir()
            (output / 'index.js').write_text("export * from './wllama';\nimport { value } from './worker';\n")
            (output / 'worker.js').write_text('import {\n value,\n} from "./glue/glue";\nexport { value } from "./already.js";\n')
            (output / 'workers-code').mkdir()
            (output / 'workers-code/generated.js').write_text('export const RAW = "import { value } from \'./raw\';";\n')
            (output / 'wllama.d.ts').write_text('countChatTokens(options: unknown): Promise<number>')
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(module.subprocess, 'run', run)
    monkeypatch.setattr(module.shutil, 'which', lambda name: 'fictional-node')
    return module, work, calls


def test_sdk_uses_real_generators_then_compiler_and_records_assets(sdk):
    module, work, calls = sdk
    result = module.build(work)
    assert [args[1] for args in calls[:2]] == ['cpp/generate_glue_prototype.js', 'scripts/generate_wasm_from_cdn.js']
    assert calls[2][-2:] == ['--outDir', str(work / 'sdk')]
    assert (work / 'sdk/index.js').read_text() == "export * from './wllama.js';\nimport { value } from './worker.js';\n"
    assert (work / 'sdk/worker.js').read_text() == 'import {\n value,\n} from "./glue/glue.js";\nexport { value } from "./already.js";\n'
    assert (work / 'sdk/workers-code/generated.js').read_text() == 'export const RAW = "import { value } from \'./raw\';";\n'
    assert json.loads((work / 'sdk/package.json').read_text()) == {'type': 'module'}
    assert (work / 'sdk/LICENCE').read_text() == 'fictional public input'
    assert set(result['runtime_assets']) == {f'{variant}/{name}' for variant in ('standard', 'compat')
                                           for name in ('wllama.js', 'wllama.wasm')}
    assert result['source_files']['src/wllama.ts'] and result['sdk_files']['wllama.d.ts']
    assert not result['native_count_verified'] and not result['release_accepted']
    assert json.loads((work / 'sdk-build.json').read_text()) == result
    with pytest.raises(ValueError, match='Fresh SDK'):
        module.build(work)


@pytest.mark.parametrize('fault', ['outside', 'missing-patch', 'bad-wasm', 'linked-source', 'old-wasm', 'diagnostic-source', 'diagnostic-standard', 'diagnostic-compat'])
def test_sdk_rejects_bad_inputs_before_running_or_writing(sdk, monkeypatch, fault):
    module, work, calls = sdk
    message = 'workspace artifacts'
    if fault == 'outside':
        work = module.ROOT / 'outside'
    elif fault == 'missing-patch':
        (work / 'wllama/src/wllama.ts').write_text('unpatched')
        message = 'chat-count patch'
    elif fault == 'bad-wasm':
        (work / 'build-compat/wllama.wasm').write_bytes(b'wrong')
        message = 'matched WASM'
    elif fault == 'old-wasm':
        (work / 'build-standard/wllama.wasm').write_bytes(b'\0asmold')
        message = 'Rebuild both WASM'
    elif fault == 'diagnostic-source':
        (work / 'wllama/cpp/wllama-context.h').write_text('action_count_chat_tokens( count_probe_snapshot')
        message = 'Diagnostic count probes'
    elif fault.startswith('diagnostic-'):
        (work / ('build-' + fault.removeprefix('diagnostic-')) / 'wllama.wasm').write_bytes(b'\0asmctok_req\0ctok_res\0countProbe')
        message = 'Diagnostic count probes'
    else:
        linked = work / 'wllama/src/wllama.ts'
        original = Path.is_symlink
        monkeypatch.setattr(Path, 'is_symlink', lambda path: path == linked or original(path))
        message = 'source escaped'
    with pytest.raises(ValueError, match=message):
        module.build(work)
    assert not calls and not (work / 'sdk-build.json').exists()


def test_input_manifest_covers_generators_and_public_sources_without_node(sdk):
    module, work, calls = sdk
    source = work / 'wllama'
    (source / 'src/unrelated.test.ts').write_text('not a production input')
    (source / 'src/workers-code/generated.ts').write_text('overwritten')
    result = module.input_manifest(work)
    assert 'wllama/cpp/glue.hpp' in result
    assert 'wllama/cpp/generate_glue_prototype.js' in result
    assert 'wllama/src/unrelated.test.ts' not in result
    assert 'wllama/src/workers-code/generated.ts' not in result
    assert module.input_manifest(work, verify=True) == result
    assert not calls
    (source / 'src/wllama.ts').write_text('tampered')
    with pytest.raises(ValueError, match='manifest differs'):
        module.input_manifest(work, verify=True)


@pytest.mark.parametrize('fault', ['missing', 'extra', 'escape', 'linked'])
def test_input_manifest_rejects_incomplete_or_unsafe_inputs(sdk, monkeypatch, fault):
    module, work, _ = sdk
    module.input_manifest(work)
    if fault == 'missing':
        (work / 'wllama/package.json').unlink()
        error = FileNotFoundError
    elif fault == 'extra':
        (work / 'wllama/src/extra.ts').write_text('unhashed input')
        error = ValueError
    elif fault == 'escape':
        manifest = json.loads((work / 'SDK_INPUTS.json').read_text())
        manifest['../outside'] = '0' * 64
        (work / 'SDK_INPUTS.json').write_text(json.dumps(manifest))
        error = ValueError
    else:
        original = Path.is_symlink
        monkeypatch.setattr(Path, 'is_symlink', lambda path: path == work / 'wllama/src' or original(path))
        error = ValueError
    with pytest.raises(error):
        module.input_manifest(work, verify=True)
