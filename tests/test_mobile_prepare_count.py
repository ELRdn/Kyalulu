"""Fictional source trees exercise git apply inside an enclosing checkout."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess

import pytest


@pytest.mark.parametrize('invalid', [False, True])
def test_prepare_applies_count_after_ple_and_is_idempotent(tmp_path, monkeypatch, invalid):
    script = Path(__file__).resolve().parents[1] / 'scripts/mobile_wasm/prepare.py'
    spec = importlib.util.spec_from_file_location('mobile_prepare_count', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # A real but fictional Git directory catches git apply's enclosing-root behavior.
    subprocess.run(['git', 'init', '--quiet', str(tmp_path)], check=True, capture_output=True)
    work = tmp_path / '.artifacts/work'
    source = work / 'wllama'
    source.mkdir(parents=True)
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    patch = scripts / 'chat-count.patch'
    patch.write_text('--- a/public.txt\n+++ b/public.txt\n@@ -1,3 +1,3 @@\n'
                     ' before\n-old count\n+new count\n after\n', encoding='utf-8')
    (source / 'public.txt').write_text('before\nwrong count\nafter\n' if invalid else 'before\nold count\nafter\n')
    (tmp_path / 'public.txt').write_text('enclosing checkout must stay untouched\n')
    (source / 'CMakeLists.txt').write_text('option(WLLAMA_TEST_BACKEND\n')
    monkeypatch.setattr(module, '__file__', str(scripts / 'prepare.py'))
    monkeypatch.setattr(module, 'WORK', work)
    monkeypatch.setattr(module, 'W', source)
    monkeypatch.setattr(module, 'L', source / 'llama.cpp')
    edit = module.edit

    def only_ple_fixture(name, old, new):
        if name == 'CMakeLists.txt':
            edit(name, old, new)

    monkeypatch.setattr(module, 'edit', only_ple_fixture)
    if invalid:
        with pytest.raises(subprocess.CalledProcessError):
            module.main()
        assert not (work / 'chat-count.patch').exists()
    else:
        module.main()
        assert (source / 'public.txt').read_text() == 'before\nnew count\nafter\n'
        ple = scripts / 'ple.patch'
        ple_hash = hashlib.sha256(ple.read_bytes()).hexdigest()
        assert 'public.txt' not in ple.read_text()
        assert (work / 'chat-count.patch').read_bytes() == patch.read_bytes()
        module.main()
        assert hashlib.sha256(ple.read_bytes()).hexdigest() == ple_hash
        assert not module.originals
    assert (tmp_path / 'public.txt').read_text() == 'enclosing checkout must stay untouched\n'
