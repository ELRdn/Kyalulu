"""Pinned upstream texts supplement missing package texts without guessing licenses."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

import pytest


@pytest.fixture
def renderer(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / 'scripts/collect_release_sources.py'
    spec = importlib.util.spec_from_file_location('renderer_sources', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, 'ROOT', tmp_path / 'repo')
    package = module.ROOT / 'node_modules/.pnpm/fixture@1/node_modules/fixture'
    package.mkdir(parents=True)
    metadata = package / 'package.json'
    metadata.write_text(json.dumps({'name': 'fixture', 'version': '1', 'license': 'MIT'}))
    source = module.ROOT / 'docs/licenses/pinned.txt'
    source.parent.mkdir(parents=True)
    source.write_bytes(b'Fictional complete upstream license\n')
    manifest = source.parent / 'renderer-license-sources.json'
    entry = {'packages': ['fixture@1'], 'license': 'MIT', 'texts': [{
        'path': 'docs/licenses/pinned.txt', 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'url': 'https://example.invalid/upstream/' + 'a' * 40 + '/LICENSE'}]}
    manifest.write_text(json.dumps([entry]))
    return module, package, source, manifest, entry, tmp_path / 'output'


def test_renderer_supplement_preserves_bytes_and_provenance(renderer):
    module, _, source, _, entry, output = renderer
    module.collect_renderer_licenses(output)
    notice, = json.loads((output / 'renderer-licenses.json').read_text())
    assert notice['package'] == 'fixture@1' and notice['license'] == 'MIT'
    assert notice['sources'] == entry['texts']
    assert len(notice['texts']) == 1
    assert (output / notice['texts'][0]).read_bytes() == source.read_bytes()


@pytest.mark.parametrize('mode', ['new-version', 'published-text', 'unknown-package'])
def test_renderer_never_guesses_a_supplement_for_another_version_or_existing_text(renderer, mode):
    module, package, _, _, _, output = renderer
    if mode == 'new-version':
        (package / 'package.json').write_text('{"name":"fixture","version":"2","license":"MIT"}')
    elif mode == 'unknown-package':
        (package / 'package.json').write_text('{"name":"unknown","version":"1","license":"MIT"}')
    else:
        (package / 'LICENSE').write_bytes(b'Published license takes precedence\n')
    module.collect_renderer_licenses(output)
    notice, = json.loads((output / 'renderer-licenses.json').read_text())
    assert 'sources' not in notice
    if mode == 'published-text':
        assert (output / notice['texts'][0]).read_bytes() == (package / 'LICENSE').read_bytes()
    else:
        assert notice['texts'] == []


@pytest.mark.parametrize('fault', ['hash', 'empty', 'escape', 'source-link', 'manifest-link',
                                  'destination-link', 'declaration', 'duplicate', 'no-texts', 'empty-published'])
def test_renderer_rejects_invalid_provenance_before_writing_a_license(renderer, monkeypatch, fault):
    module, package, source, manifest, entry, output = renderer
    if fault == 'hash':
        source.write_bytes(b'Changed upstream content')
    elif fault == 'empty':
        source.write_bytes(b' ')
    elif fault == 'escape':
        entry['texts'][0]['path'] = 'docs/licenses/../private.txt'
    elif fault in {'source-link', 'manifest-link', 'destination-link'}:
        linked = source if fault == 'source-link' else manifest if fault == 'manifest-link' else output / 'licenses/renderer'
        original = Path.is_symlink
        monkeypatch.setattr(Path, 'is_symlink', lambda self: self == linked or original(self))
    elif fault == 'declaration':
        (package / 'package.json').write_text('{"name":"fixture","version":"1","license":"ISC"}')
    elif fault == 'no-texts':
        entry['texts'] = []
    elif fault == 'empty-published':
        (package / 'LICENSE').write_bytes(b' ')
    manifest.write_text(json.dumps([entry, entry] if fault == 'duplicate' else [entry]))
    with pytest.raises(ValueError):
        module.collect_renderer_licenses(output)
    assert not list(output.glob('licenses/renderer/*/*'))
    assert not (output / 'renderer-licenses.json').exists()


@pytest.mark.parametrize('destination', ['output', 'inventory'])
def test_renderer_rejects_linked_output_or_inventory_before_overwriting(renderer, monkeypatch, destination):
    module, _, _, _, _, output = renderer
    linked = output if destination == 'output' else output / 'renderer-licenses.json'
    original = Path.is_symlink
    monkeypatch.setattr(Path, 'is_symlink', lambda path: path == linked or original(path))
    with pytest.raises(ValueError, match='destination is a symlink'):
        module.collect_renderer_licenses(output)
    assert not (output / 'renderer-licenses.json').exists()


def test_committed_license_texts_keep_upstream_checksums_in_windows_git_export(tmp_path):
    root = Path(__file__).resolve().parents[1]
    entries = json.loads((root / 'docs/licenses/renderer-license-sources.json').read_text(encoding='utf-8'))
    identities = [identity for entry in entries for identity in entry['packages']]
    assert len(identities) == len(set(identities))
    texts = {text['path']: text['sha256'] for entry in entries for text in entry['texts']}
    texts.update({'docs/licenses/noise-c-MIT.txt': 'f2c0cc36aa63c383fd1669b63eff210ee8cabb304dd818a9f442d93906eff587',
                  'docs/licenses/stackback-V8-notice.txt': '50e3a58083f6fa4aa476c27ebc77b9ed03f38be59fc4127754999c5689b85152'})
    for name, expected in texts.items():
        assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected
    for entry in entries:
        for text in entry['texts']:
            assert re.fullmatch(r'https://raw\.githubusercontent\.com/[^/]+/[^/]+/[0-9a-f]{40}/.+', text['url'])
            assert hashlib.sha256((root / text['path']).read_bytes()).hexdigest() == text['sha256']
    for name in ['.gitattributes', *texts]:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((root / name).read_bytes())
    def git(*args):
        return subprocess.check_output(['git', '-c', 'core.autocrlf=true', *args], cwd=tmp_path, stderr=subprocess.PIPE)
    git('init', '--quiet')
    git('add', '--', '.gitattributes', *texts)
    git('-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Fictional license bytes')
    with tarfile.open(fileobj=io.BytesIO(git('archive', '--format=tar', 'HEAD'))) as archive:
        for name, expected in texts.items():
            assert hashlib.sha256(archive.extractfile(name).read()).hexdigest() == expected
