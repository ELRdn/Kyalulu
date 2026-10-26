"""Corresponding source must not collect private files or follow external links."""

import importlib.util
from pathlib import Path
import json
import re
import zipfile

import pytest


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
