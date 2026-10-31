"""Corresponding source must not collect private files or follow external links."""

import importlib.util
import io
import os
from pathlib import Path
import json
import re
import stat
import subprocess
import tarfile
import zipfile

import pytest


def test_wasm_bootstrap_preserves_zip_executables(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'scripts/mobile_wasm/bootstrap.py'
    spec = importlib.util.spec_from_file_location('wasm_bootstrap', path)
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w') as archive:
        for name, mode, content in [('emsdk', 0o6755, b'#!/bin/sh\necho fixture\n'),
                                    ('README', 0o644, b'offline fixture\n')]:
            item = zipfile.ZipInfo('sdk-root/' + name)
            item.create_system = 3
            item.external_attr = (stat.S_IFREG | mode) << 16
            archive.writestr(item, content)
    work = tmp_path / 'wasm'
    cmake = work / 'cmake-3.31.6-linux-x86_64/bin/cmake'
    cmake.parent.mkdir(parents=True)
    cmake.write_bytes(b'offline cmake marker')
    url = 'https://example.invalid/emsdk.zip'
    monkeypatch.setattr(bootstrap, 'WORK', work)
    monkeypatch.setattr(bootstrap, 'SOURCES', [(url, 'emsdk', True)])

    def urlopen(requested_url, timeout):
        assert requested_url == url and timeout == 180
        return io.BytesIO(data.getvalue())

    monkeypatch.setattr(bootstrap.urllib.request, 'urlopen', urlopen)
    chmod_calls = []
    original_chmod = Path.chmod

    def chmod(target, mode):
        chmod_calls.append((target, mode))
        original_chmod(target, mode)

    monkeypatch.setattr(Path, 'chmod', chmod)
    bootstrap.main()
    executable = work / 'emsdk/emsdk'
    readme = work / 'emsdk/README'
    assert executable.read_bytes() == b'#!/bin/sh\necho fixture\n'
    assert readme.read_bytes() == b'offline fixture\n'
    assert chmod_calls == [(executable, 0o755)]
    if os.name == 'posix':
        assert stat.S_IMODE(executable.stat().st_mode) == 0o755
        assert not readme.stat().st_mode & 0o111


def test_wasm_builder_keeps_unix_lines_in_windows_git_export(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import collect_release_sources as sources

    assert '.gitattributes' in sources.FILES
    builder = 'scripts/mobile_wasm/build.sh'
    for name in ('.gitattributes', builder):
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / name).read_bytes().replace(b'\r\n', b'\n'))
    def git(*args):
        return subprocess.check_output(['git', '-c', 'core.autocrlf=true', *args], cwd=tmp_path, stderr=subprocess.PIPE)
    git('init', '--quiet')
    git('add', '.gitattributes', builder)
    git('-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fictional release source')
    with tarfile.open(fileobj=io.BytesIO(git('archive', '--format=tar', 'HEAD'))) as archive:
        script = archive.extractfile(builder).read()
    assert b'\n' in script and b'\r\n' not in script


def test_source_contains_browser_fixture_imports(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import collect_release_sources as sources

    # tsc includes tests under src, including file-URL fixtures used at runtime.
    required = set()
    for file in (root / 'apps/web/src').rglob('*'):
        if file.suffix in {'.ts', '.tsx'}:
            for name in re.findall(r'''["']([^"']*tests/fixtures/[^"']+\.json)["']''', file.read_text(encoding='utf-8')):
                required.add((file.parent / name).resolve().relative_to(root).as_posix())
    assert required
    assert required <= set(sources.FILES)
    monkeypatch.setattr(sources, 'DIRECTORIES', ())
    monkeypatch.setattr(sources, 'FILES', tuple(sorted(required)))
    sources.collect(tmp_path / 'source')
    for name in required:
        assert (tmp_path / 'source' / name).read_bytes() == (root / name).read_bytes()


def test_source_contains_fixture_module_imports(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import collect_release_sources as sources

    required = {'tests/fixtures/segmented-storage.html', 'tests/fixtures/research-language.html'}
    # Only static from/side-effect imports and literal dynamic imports are used here.
    pattern = r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.\.?/[^"']+)["']'''
    for name in sources.FILES:
        file = root / name
        if name.startswith('tests/fixtures/') and file.suffix in {'.html', '.ts', '.tsx'}:
            for module in re.findall(pattern, file.read_text(encoding='utf-8')):
                target = (file.parent / module).resolve()
                if not target.suffix:
                    target = next((path for suffix in ('.ts', '.tsx')
                                   if (path := target.with_suffix(suffix)).is_file()), target)
                assert target.is_file(), f'{name}: missing import {module}'
                required.add(target.relative_to(root).as_posix())
    assert {'tests/fixtures/storage-fixture.ts', 'tests/fixtures/session-policy.tsx',
            'apps/web/src/components/SessionPolicy.tsx'} <= required
    missing = {name for name in required if name not in sources.FILES
               and not any((root / name).is_relative_to(root / directory)
                           for directory in sources.DIRECTORIES)}
    assert not missing, f'Uncollected fixture imports: {sorted(missing)}'
    monkeypatch.setattr(sources, 'DIRECTORIES', ())
    monkeypatch.setattr(sources, 'FILES', tuple(sorted(required)))
    sources.collect(tmp_path / 'source')
    for name in required:
        assert (tmp_path / 'source' / name).read_bytes() == (root / name).read_bytes()


def test_source_contains_local_python_helpers(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import collect_release_sources as sources

    required = {'tests/e2e_segmented_storage.py', 'tests/conftest.py',
                'tests/e2e_device_benchmarks.py', 'tests/test_benchmark.py',
                'tests/test_json_stream.py', 'tests/test_native_outbox_guard.py',
                'tests/e2e_research_language.py', 'tests/test_chat_storage.py'}
    # Only simple imports of sibling Python modules are used by these tests.
    for name in sources.FILES:
        if name.startswith('tests/') and name.endswith('.py'):
            file = root / name
            for module in re.findall(r'^\s*(?:from|import) (\w+)\b', file.read_text(encoding='utf-8'), re.M):
                helper = file.with_name(module + '.py')
                if helper.is_file():
                    required.add(helper.relative_to(root).as_posix())
    assert {'tests/browser_fixture_server.py', 'tests/browser_storage.py'} <= required
    assert required <= set(sources.FILES)
    monkeypatch.setattr(sources, 'DIRECTORIES', ())
    monkeypatch.setattr(sources, 'FILES', tuple(sorted(required)))
    sources.collect(tmp_path / 'source')
    for name in required:
        assert (tmp_path / 'source' / name).read_bytes() == (root / name).read_bytes()


def test_mobile_packages_shared_corresponding_source(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import mobile_release as mobile

    monkeypatch.setattr(mobile, 'ROOT', tmp_path / 'repo')
    monkeypatch.setattr(mobile, 'OUT', mobile.ROOT / '.artifacts/mobile-pages')
    mobile.OUT.mkdir(parents=True)
    (mobile.OUT / 'sw.js').write_text('const INTEGRITY = {};\nconst COMPRESSED = {};', encoding='utf-8')
    (mobile.OUT / 'index.html').write_text('Kyalulu Mobile', encoding='utf-8')
    catalog = mobile.ROOT / 'apps/web/src/mobile/catalog.generated.json'
    catalog.parent.mkdir(parents=True)
    catalog.write_text(json.dumps([{'id': str(i), 'repo': 'fixture', 'revision': 'fixed', 'files': ['model']} for i in range(4)]), encoding='utf-8')
    for name in (
        '.artifacts/mobile-wasm/wllama/LICENCE', '.artifacts/mobile-wasm/wllama/llama.cpp/LICENSE',
        'apps/web/node_modules/@huggingface/transformers/LICENSE', 'docs/licenses/onnxruntime-MIT.txt',
        'docs/licenses/onnxruntime-ThirdPartyNotices.txt', 'docs/licenses/noise-c-MIT.txt',
        '.artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu/src/LICENSE',
        '.artifacts/mobile-wasm/emdawn/emdawnwebgpu_pkg/webgpu_cpp/LICENSE',
        '.artifacts/mobile-wasm/wllama/llama.cpp/licenses/LICENSE-jsonhpp', 'LICENSE',
    ):
        file = mobile.ROOT / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('fixture license', encoding='utf-8')

    def corresponding_source(destination):
        destination.mkdir()
        (destination / 'BUILD.md').write_text('shared collector fixture', encoding='utf-8')
    monkeypatch.setattr(mobile, 'collect', corresponding_source)
    mobile.main()
    with zipfile.ZipFile(mobile.OUT / 'source/kyalulu-mobile-source.zip') as archive:
        assert archive.namelist() == ['BUILD.md']
        assert archive.read('BUILD.md') == b'shared collector fixture'
    manifest = json.loads((mobile.OUT / 'release-manifest.json').read_text(encoding='utf-8'))
    assert 'source/kyalulu-mobile-source.zip' in manifest['files']
    assert sorted(p.name for p in mobile.OUT.iterdir()) == ['index.html', 'licenses', 'release-manifest.json', 'source', 'sw.js']


@pytest.mark.parametrize('failure', ['missing', 'empty', 'source-link', 'destination-link'])
def test_runtime_licenses_fail_before_writing_any_text(tmp_path, monkeypatch, failure):
    root = Path(__file__).resolve().parents[1]
    monkeypatch.syspath_prepend(str(root / 'scripts'))
    import collect_release_sources as sources

    original = tmp_path / 'repo'
    for relative in sources.RUNTIME_LICENSES.values():
        file = original / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b'fictional license')
    name, relative = list(sources.RUNTIME_LICENSES.items())[-1]
    origin, destination = original / relative, tmp_path / 'output'
    if failure == 'missing':
        origin.unlink()
    elif failure == 'empty':
        origin.write_bytes(b'   ')
    else:
        linked = origin if failure == 'source-link' else destination / 'licenses' / name
        is_symlink = Path.is_symlink
        monkeypatch.setattr(Path, 'is_symlink', lambda path: path == linked or is_symlink(path))
    with pytest.raises((ValueError, FileNotFoundError)):
        sources.copy_runtime_licenses(original, destination)
    assert not list(destination.rglob('*.txt'))


def test_corresponding_source_boundaries(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts/collect_release_sources.py"
    spec = importlib.util.spec_from_file_location("release_sources", path)
    sources = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sources)
    monkeypatch.setattr(sources, "ROOT", tmp_path / "repo")
    monkeypatch.setattr(sources, "DIRECTORIES", ("runtime/python",))
    monkeypatch.setattr(sources, "FILES", ())
    tree = sources.ROOT / "runtime/python"
    tree.mkdir(parents=True)
    (tree / "main.py").write_text("print('fixture')", encoding="utf-8")
    private = [".env", "data.sqlite3", "data.sqlite3-wal", "data.db-wal", "identity.vault",
               "private.pem", "private.key", "model.gguf", "requests.log"]
    for name in private:
        (tree / name).write_text("synthetic private fixture", encoding="utf-8")
    output = tmp_path / "output"
    sources.collect(output)
    assert (output / "runtime/python/main.py").is_file()
    assert not any((output / "runtime/python" / name).exists() for name in private)
    outside = tmp_path / "outside.py"
    outside.write_text("synthetic outside fixture", encoding="utf-8")
    with pytest.raises(ValueError, match="escaped workspace"):
        sources.check_source(outside)
    try:
        (tree / "linked.py").symlink_to(outside)
    except OSError:
        pass  # Windows may require privileges; the path-boundary check above still runs.
    else:
        with pytest.raises(ValueError, match="symlink"):
            sources.collect(tmp_path / "linked-output")
        (tree / "linked.py").unlink()
    model = sources.ROOT / "models/example.yaml"
    model.parent.mkdir()
    model.write_text("provider:\n  api_key: synthetic-secret\n", encoding="utf-8")
    monkeypatch.setattr(sources, "FILES", ("models/example.yaml",))
    with pytest.raises(ValueError, match="credentials"):
        sources.collect(tmp_path / "credential-output")


@pytest.mark.parametrize('linked_name', ['LICENSE', 'package.json'])
def test_renderer_licenses_and_metadata_reject_links_before_collection(tmp_path, monkeypatch, linked_name):
    path = Path(__file__).resolve().parents[1] / 'scripts/collect_release_sources.py'
    spec = importlib.util.spec_from_file_location('release_sources', path)
    sources = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sources)
    monkeypatch.setattr(sources, 'ROOT', tmp_path / 'repo')
    monkeypatch.setattr(sources, 'DIRECTORIES', ())
    monkeypatch.setattr(sources, 'FILES', ())
    package = sources.ROOT / 'node_modules/.pnpm/fixture@1/node_modules/fixture'
    package.mkdir(parents=True)
    (package / 'package.json').write_text('{"name":"fixture","version":"1","license":"MIT"}', encoding='utf-8')
    (package / 'LICENSE').write_text('synthetic private sentinel', encoding='utf-8')
    # Model a link without requiring Windows symlink privileges.
    is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda self: self == package / linked_name or is_symlink(self))
    output = tmp_path / 'output'
    with pytest.raises(ValueError, match='symlink'):
        sources.collect(output)
    assert not list(output.rglob('LICENSE'))
