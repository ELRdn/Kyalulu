"""Disposable image checks: no production configuration, volumes or network."""
import asyncio
import errno
import hashlib
import json
import os
from pathlib import Path
import tempfile

import httpx
from python.cloud.app import create_app
from python.cloud.config import CloudConfig


async def main():
    checks, external = [], []
    uid = os.getuid() if hasattr(os, 'getuid') else None
    if uid is not None:
        assert uid == 10002, 'Wrong container user'
        assert {path.name for path in Path('/sys/class/net').iterdir()} == {'lo'}, 'Container network is enabled'
        try:
            Path('/data/.validation-readonly-check').write_text('fictional')
        except OSError as error:
            assert error.errno == errno.EROFS, 'Root filesystem is not read-only'
        else:
            raise AssertionError('Root filesystem is writable')
        checks.extend(['uid-10002', 'network-none', 'rootfs-readonly'])
    dist = Path(os.environ['KYALULU_WEB_DIST'])
    source = Path(os.environ['KYALULU_SOURCE_ARCHIVE'])
    assert dist.is_dir() and source.is_file()
    with source.open('rb') as stream:
        source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    def forbidden(request):
        external.append(str(request.url))
        raise AssertionError('External access forbidden')
    with tempfile.TemporaryDirectory(prefix='kyalulu-image-fixture-') as temporary:
        root = Path(temporary)
        config = CloudConfig(root=root/'data', backup_root=root/'backups',
            origin='https://container.kyalulu.invalid', secret='FICTIONAL-FIXTURE-ONLY-'+'x'*40,
            web_dist=dist, unified_enabled=True, signup_limit=0, trial_credits=0,
            monthly_subsidy_jpy=0, region_policies=())
        app = create_app(config, transport=httpx.MockTransport(forbidden))
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url=config.origin) as client:
                assert (await client.get('/api/health')).status_code == 200
                checks.append('health')
                for path, name in [('/', 'index.html'),('/device/', 'device/index.html'),('/migration/', 'migration/index.html')]:
                    response = await client.get(path)
                    assert response.status_code == 200 and response.content == (dist/name).read_bytes(), path
                    assert 'no-transform' in response.headers['cache-control'], path
                    if name.startswith('device/'):
                        assert response.headers['cross-origin-opener-policy'] == 'same-origin'
                        assert response.headers['cross-origin-embedder-policy'] == 'require-corp'
                        assert len(response.headers.get_list('content-security-policy')) == 1
                    elif name.startswith('migration/'):
                        assert response.headers['cross-origin-opener-policy'] == 'unsafe-none'
                        assert response.headers['cross-origin-embedder-policy'] == 'unsafe-none'
                        assert len(response.headers.get_list('content-security-policy')) == 1
                    checks.append(path+'-bytes-and-policy')
                response = await client.get('/sw.js')
                assert response.status_code == 200 and response.content == (dist/'sw.js').read_bytes()
                assert response.headers['service-worker-allowed'] == '/' and 'no-transform' in response.headers['cache-control']
                checks.append('service-worker-scope-and-bytes')
                worker, = (dist/'assets').glob('runtime.worker-*.js')
                response = await client.get('/assets/'+worker.name)
                assert response.status_code == 200 and response.content == worker.read_bytes()
                assert response.headers['cross-origin-embedder-policy'] == 'require-corp'
                assert "frame-src 'none'" in response.headers['content-security-policy']
                checks.append('inference-worker-bytes-and-policy')
                for path in ('/.env','/missing.js','/device/missing','/migration/missing'):
                    response = await client.get(path,headers={'Accept':'text/html'})
                    assert response.status_code == 404 and response.content != (dist/'index.html').read_bytes(), path
                checks.append('missing-and-private-static-closed')
                assert (await client.get('/api/chat/history')).status_code == 401
                assert (await client.get('/api/cloud/app/status')).status_code == 401
                assert (await client.get('/api/cloud/status',headers={'Host':'wrong.invalid'})).status_code == 400
                response = await client.post('/api/cloud/app/eligibility',headers={'Origin':config.origin},json={'country':'JP','age':25})
                assert response.status_code == 403 and response.json()['error'] == 'region_policy_pending'
                status = (await client.get('/api/cloud/status')).json()
                assert status['billing_available'] is False and status['ads_available'] is False
                checks.append('auth-host-region-billing-and-ads-closed')
                response = await client.get('/source.tar.gz')
                assert response.status_code == 200 and int(response.headers['content-length']) == source.stat().st_size
                assert hashlib.sha256(response.content).hexdigest() == source_hash
                checks.append('corresponding-source-offer')
                del response
            with app.state.store.transaction() as db:
                assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
                assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0
        assert not external
    print(json.dumps({'ok':True,'checks':checks,'uid':uid,'external_requests':len(external),
        'production_data_used':False,'source_sha256':source_hash}))


asyncio.run(main())
