"""Inspect the actual tar output; never connect to production or resolve packages."""
import importlib.util
import shutil
import tarfile
from pathlib import Path

import pytest


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    scripts = Path(__file__).resolve().parents[1] / 'scripts'
    monkeypatch.syspath_prepend(str(scripts))
    spec = importlib.util.spec_from_file_location('unified_bundle', scripts / 'prepare_cloud_bundle.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    root = tmp_path / 'repo'; root.mkdir()
    for folder in ('runtime/python', 'characters', 'personas', 'worlds', 'prompts', 'scenarios'):
        path = root / folder / 'fixture.txt'; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('fixture')
    for name in ('LICENSE', 'scripts/cloud_admin.py', 'deploy/cloud/compose.yml', 'deploy/cloud/compose.vps.yml',
                 'deploy/cloud/Caddyfile.example', 'deploy/cloud/Caddyfile.unified.example', 'deploy/cloud/Dockerfile.prebuilt',
                 'apps/web/dist/index.html', '.artifacts/unified-app/index.html', '.artifacts/unified-app/device/index.html'):
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(name)
    monkeypatch.setattr(module, 'ROOT', root)
    monkeypatch.setattr(module, 'collect', lambda destination: shutil.copytree(root, destination))
    def pinned_requirements(arguments, **_):
        Path(arguments[-1]).write_text('fixture==1.0\n')
    monkeypatch.setattr(module.subprocess, 'run', pinned_requirements)
    return module, root, tmp_path / 'output'


def test_unified_bundle_uses_device_build_and_preserves_corresponding_source(bundle):
    module, root, output = bundle
    module.prepare(output, unified=True)
    with tarfile.open(output / 'kyalulu-cloud.tar.gz') as archive:
        assert archive.extractfile('web/index.html').read().decode() == '.artifacts/unified-app/index.html'
        assert archive.extractfile('web/device/index.html').read().decode() == '.artifacts/unified-app/device/index.html'
        assert archive.extractfile('scenarios/fixture.txt').read() == b'fixture'
        assert archive.extractfile('kyalulu-source.tar.gz')
        assert 'web/index.html' in archive.extractfile('SHA256SUMS').read().decode()
        assert archive.extractfile('deploy/cloud/Caddyfile.unified.example').read().decode() == 'deploy/cloud/Caddyfile.unified.example'


def test_unified_bundle_rejects_missing_build_and_linked_assets(bundle, monkeypatch):
    module, root, output = bundle
    index = root / '.artifacts/unified-app/index.html'
    is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == index or is_symlink(path))
    with pytest.raises(ValueError, match='escaped'):
        module.prepare(output, unified=True)
    assert not (output / 'kyalulu-cloud.tar.gz').exists()
    monkeypatch.setattr(Path, 'is_symlink', is_symlink)
    index.unlink()
    with pytest.raises(ValueError, match='Build Web'):
        module.prepare(output, unified=True)


def test_legacy_bundle_keeps_its_original_build_and_proxy_selection(bundle):
    module, root, output = bundle
    module.prepare(output)
    with tarfile.open(output / 'kyalulu-cloud.tar.gz') as archive:
        assert archive.extractfile('web/index.html').read().decode() == 'apps/web/dist/index.html'
        assert 'deploy/cloud/Caddyfile.example' in archive.getnames()
        assert 'deploy/cloud/Caddyfile.unified.example' not in archive.getnames()
