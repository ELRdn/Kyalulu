"""Cloud CI uses the same WASM and checks only files copied into its isolated image."""
import hashlib
import itertools
import json
from pathlib import Path
import shlex
import subprocess
import sys
from types import SimpleNamespace

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
JOBS = yaml.safe_load((ROOT / '.github/workflows/npm-beta-artifacts.yml').read_text())['jobs']
CLOUD = JOBS['cloud']


def test_same_run_wasm_checks_and_pinned_build():
    assert JOBS['bundle']['strategy']['fail-fast'] is False
    for job, cache in (('wasm', False), ('bundle', None), ('cloud', None)):
        setup = next(step for step in JOBS[job]['steps'] if step.get('uses') == 'astral-sh/setup-uv@v6')
        assert setup['with'] == {'version': '0.8.22', 'python-version': '3.13.7',
                                 **({'enable-cache': cache} if cache is False else {})}
    assert CLOUD['needs'] == 'wasm' and CLOUD['runs-on'] == 'ubuntu-latest'
    steps = CLOUD['steps']
    for label in ('Verify Native WASM and license inputs', 'Match compiled patch to corresponding source'):
        assert next(step for step in steps if step.get('name') == label) == next(
            step for step in JOBS['bundle']['steps'] if step.get('name') == label)
    download = next(step for step in steps if step.get('uses') == 'actions/download-artifact@v4')
    assert download['with'] == {'name': 'native-wasm-inputs', 'path': '.artifacts/mobile-wasm'}
    assert next(step for step in steps if step.get('uses') == 'actions/setup-node@v4')['with']['node-version'] == '22'
    runs = [step['run'] for step in steps if 'run' in step]
    for command in ('pnpm install --frozen-lockfile',
                    'uv sync --frozen --all-packages --all-extras --no-install-workspace',
                    'uv run --no-sync python scripts/build_app_catalog.py',
                    'uv run --no-sync python scripts/prepare_cloud_bundle.py --unified --output .artifacts/cloud-vps'):
        assert command in runs
    web = next(step for step in steps if step.get('run') == 'pnpm --filter web build:app')
    assert web['env'] == {'VITE_RELAY_ORIGIN': 'https://relay.kyalulu.com'}
    patch_check = next(step['run'] for step in steps if step.get('name') == 'Match compiled patch to corresponding source')
    assert runs.index(patch_check) < runs.index(web['run'])
    build = next(run for run in runs if 'docker build ' in run)
    assert build.index('tar -xzf kyalulu-cloud.tar.gz -C context') < build.index('sha256sum -c SHA256SUMS') < build.index('docker build ')
    assert 'sha256sum -c kyalulu-cloud.tar.gz.sha256' in build
    assert 'docker build --file context/Dockerfile --tag "$CLOUD_IMAGE" context' in build
    assert not any(word in '\n'.join(runs) for word in ('docker push', 'docker save', 'pnpm publish', 'npm publish'))


def test_native_acceptance_retains_only_explicit_fictional_evidence():
    upload, = (step for step in JOBS['bundle']['steps']
               if step.get('uses') == 'actions/upload-artifact@v4'
               and step.get('with', {}).get('name') == 'acceptance-${{ matrix.target }}')
    assert upload['if'] == 'always()'
    assert upload['with']['include-hidden-files'] is True
    assert upload['with']['path'].splitlines() == [
        '.artifacts/npm-verify-*/acceptance.json',
        '.artifacts/native-entry-acceptance/result.json',
        '.artifacts/native-entry-acceptance/local-chat.png',
    ]


def test_container_sandbox_and_evidence_allowlist():
    runs = [step['run'] for step in CLOUD['steps'] if 'run' in step]
    containers = [shlex.split(run.split("<<'PY'", 1)[0]) for run in runs if run.startswith('docker run ')]
    default = next(step for step in CLOUD['steps'] if step.get('name') == 'Exercise the unmodified Cloud default command')
    script = default['run']
    containers.append(shlex.split(script.split('container_id=$(', 1)[1].split(')\n', 1)[0]))
    assert len(containers) == 3
    for index, arguments in enumerate(containers):
        assert '--rm' in arguments and '--read-only' in arguments
        for option, value in {'--network': 'none', '--user': '10002:10002', '--cap-drop': 'ALL',
                              '--security-opt': 'no-new-privileges', '--pids-limit': '64',
                              '--memory': '384m', '--cpus': '0.5',
                              '--tmpfs': '/tmp:rw,nosuid,nodev,mode=1777,size=256m'}.items():
            assert arguments[arguments.index(option) + 1] == value
        mounts = [arguments[index + 1] for index, argument in enumerate(arguments) if argument == '--mount']
        assert len(mounts) == (0 if index == 2 else 1)
        assert all(mount.endswith(',readonly') for mount in mounts)
        assert not any(option in arguments for option in ('-e', '--env-file', '--volume', '-v', '--publish', '-p', '--privileged', '--entrypoint'))
        environment = dict(arguments[position + 1].split('=', 1) for position, argument in enumerate(arguments) if argument == '--env')
        assert environment == ({
            'KYALULU_CLOUD_MODE': '1', 'KYALULU_CLOUD_DATA_DIR': '/tmp/cloud',
            'KYALULU_CLOUD_BACKUP_DIR': '/tmp/backups',
            'KYALULU_CLOUD_ORIGIN': 'https://container.kyalulu.invalid',
            'KYALULU_CLOUD_SECRET': 'FICTIONAL-DEFAULT-COMMAND-ONLY-0123456789',
            'KYALULU_UNIFIED_APP_ENABLED': '1', 'KYALULU_CLOUD_SIGNUP_LIMIT': '0',
            'KYALULU_CLOUD_TRIAL_CREDITS': '0', 'KYALULU_MONTHLY_SUBSIDY_JPY': '0',
        } if index == 2 else {})
        assert not any('/data' in argument for argument in arguments)
    assert default['shell'] == 'bash'
    assert '--detach' in containers[2] and containers[2][-1] == '$CLOUD_IMAGE'
    assert 'timeout 30s docker exec -i "$container_id" python -' in script
    assert 'trap cleanup EXIT' in script and 'docker rm --force "$container_id" > /dev/null' in script
    assert script.index('\ncleanup\n') < script.index("container_id=''\ntrap - EXIT") < script.index("report['default_command'] = True")
    assert 'src=$PWD/tests/fixtures/unified-container.py,dst=/tmp/unified-container.py,readonly' in containers[1][containers[1].index('--mount') + 1]
    upload, = (step for step in CLOUD['steps'] if step.get('uses') == 'actions/upload-artifact@v4')
    assert upload['with']['path'].splitlines() == [
        '.artifacts/cloud-vps/image-id.txt', '.artifacts/cloud-vps/kyalulu-cloud.tar.gz',
        '.artifacts/cloud-vps/kyalulu-cloud.tar.gz.sha256',
        '.artifacts/cloud-vps/check-report.json']


@pytest.mark.parametrize('case', ['ready', 'transport-failure', 'bad-status'])
def test_default_command_health_probe_is_bounded_and_uses_container_loopback(monkeypatch, case):
    import httpx
    import time

    run = next(step['run'] for step in CLOUD['steps'] if step.get('name') == 'Exercise the unmodified Cloud default command')
    script = run.split("<<'PY'", 1)[1].split('\n', 1)[1].split('\nPY', 1)[0]
    ticks, requests = itertools.count(0, 10), []
    monkeypatch.setattr(time, 'monotonic', lambda: next(ticks))
    monkeypatch.setattr(time, 'sleep', lambda seconds: None)

    class Client:
        def __init__(self, **options):
            assert options == {'trust_env': False, 'timeout': 1, 'headers': {'Host': 'container.kyalulu.invalid'}}

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def get(self, url):
            assert url == 'http://127.0.0.1:8000/api/health'
            requests.append(url)
            if case == 'transport-failure' or len(requests) == 1:
                raise httpx.ConnectError('Startup is not ready')
            return SimpleNamespace(status_code=200 if case == 'ready' else 503)

    monkeypatch.setattr(httpx, 'Client', Client)
    if case == 'ready':
        exec(compile(script, '<default-command-probe>', 'exec'))
    else:
        with pytest.raises(AssertionError, match='did not become healthy within 30 seconds'):
            exec(compile(script, '<default-command-probe>', 'exec'))
    assert len(requests) == 2


@pytest.mark.parametrize('case', ['valid', 'tampered', 'missing', 'escape', 'empty'])
def test_image_manifest_verifier_executes_and_fails_closed(tmp_path, case):
    run = next(step['run'] for step in CLOUD['steps'] if step.get('name') == 'Verify copied image files against the context manifest')
    script = run.split("<<'PY'", 1)[1].split('\n', 1)[1].rsplit('\nPY', 1)[0]
    dockerfile = (ROOT / 'deploy/cloud/Dockerfile.prebuilt').read_text()
    names = []
    for line in dockerfile.splitlines():
        if line.startswith('COPY ') and '--from=' not in line:
            name = line.split()[1]
            if name != 'requirements.txt':
                names.append(name if Path(name).suffix or name == 'LICENSE' else name + '/fixture.txt')
    manifest = tmp_path / 'SHA256SUMS'
    lines = []
    for name in names:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode())
        lines.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {name}')
    # These context-only files deliberately do not exist in the image.
    lines.extend(f'{"0" * 64}  {name}' for name in ('scenarios/absent.yaml', 'Dockerfile', 'requirements.txt'))
    if case == 'tampered':
        (tmp_path / 'runtime/python/fixture.txt').write_bytes(b'tampered')
    elif case == 'missing':
        (tmp_path / 'LICENSE').unlink()
    elif case == 'escape':
        lines.append(f'{"0" * 64}  runtime/python/../../../outside')
    elif case == 'empty':
        lines = []
    manifest.write_text('\n'.join(lines))
    result = subprocess.run([sys.executable, '-', str(manifest)], input=script, text=True,
                            cwd=tmp_path, capture_output=True)
    if case == 'valid':
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout) == {'ok': True, 'checked_files': len(names)}
    else:
        assert result.returncode != 0 and not result.stdout, result.stderr
