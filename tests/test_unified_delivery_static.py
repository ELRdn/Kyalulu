"""Canonical static delivery uses disposable files and no production/provider access."""
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.config import CloudConfig


@pytest.fixture
def hosted(tmp_path):
    dist = tmp_path / 'web'
    for name, body in {'index.html': '<html>main</html>', 'device/index.html': '<html>device</html>',
                       'migration/index.html': '<html>migration</html>', 'sw.js': '// fixture worker',
                       'main.js': '// fixture asset', 'assets/runtime.worker-fixture.js': '// fixture worker module',
                       '.env': 'fictional-secret'}.items():
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding='utf-8')
    config = CloudConfig(root=tmp_path / 'control', origin='https://app.test', secret='s' * 32, web_dist=dist)
    app = create_app(config, transport=httpx.MockTransport(lambda _: pytest.fail('No providers or auth services')))
    return app, dist


@pytest.mark.asyncio
async def test_cloud_documents_keep_isolation_worker_scope_and_no_transform(hosted):
    app, _ = hosted
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://app.test') as client:
        for path in ('/', '/index.html', '/chats/fixture'):
            response = await client.get(path, headers={'Accept': 'text/html'})
            assert response.status_code == 200 and response.text == '<html>main</html>'
            assert response.headers['cache-control'] == 'no-store, no-transform'
            assert 'cross-origin-embedder-policy' not in response.headers
        for name in ('device', 'migration'):
            for path in (f'/{name}', f'/{name}/', f'/{name}/index.html'):
                response = await client.get(path)
                assert response.status_code == 200 and response.text == f'<html>{name}</html>'
                assert response.headers['cache-control'] == 'no-store, no-transform'
                assert response.headers['cross-origin-opener-policy'] == ('same-origin' if name == 'device' else 'unsafe-none')
                assert response.headers['cross-origin-embedder-policy'] == ('require-corp' if name == 'device' else 'unsafe-none')
                assert len(response.headers.get_list('content-security-policy')) == 1
        worker = await client.get('/sw.js')
        assert worker.status_code == 200 and 'javascript' in worker.headers['content-type']
        assert worker.headers['service-worker-allowed'] == '/'
        assert worker.headers['cache-control'] == 'no-store, no-transform'
        inference = await client.get('/assets/runtime.worker-fixture.js')
        assert inference.status_code == 200 and 'javascript' in inference.headers['content-type']
        assert inference.headers['cross-origin-embedder-policy'] == 'require-corp'
        assert "frame-src 'none'" in inference.headers['content-security-policy']
        assert 'huggingface.co' in inference.headers['content-security-policy']


@pytest.mark.asyncio
async def test_missing_assets_private_paths_and_isolated_subpaths_never_receive_main_html(hosted):
    app, _ = hosted
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://app.test') as client:
        for path in ('/missing.js', '/assets/missing.png', '/.env', '/%2eenv', '/device/missing', '/migration/missing'):
            response = await client.get(path, headers={'Accept': 'text/html'})
            assert response.status_code == 404 and 'fictional-secret' not in response.text and '<html>main' not in response.text
        assert (await client.get('/missing', headers={'Accept': 'application/json'})).status_code == 404
        response = await client.get('/api/missing', headers={'Accept': 'text/html'})
        assert response.status_code == 401 and '<html>main' not in response.text
        status = await client.get('/api/cloud/status')
        assert status.status_code == 200 and status.headers['cache-control'] == 'no-store'
        assert status.json()['billing_available'] is False and status.json()['ads_available'] is False
        assert (await client.post('/api/cloud/app/eligibility', headers={'Origin': 'https://app.test'}, json={})).status_code == 503
        assert (await client.get('/api/cloud/status', headers={'Host': 'cloud.test'})).status_code == 400


@pytest.mark.asyncio
async def test_missing_document_builds_remain_closed(hosted):
    app, dist = hosted
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://app.test') as client:
        for name in ('device', 'migration'):
            (dist / name / 'index.html').unlink()
            response = await client.get(f'/{name}/', headers={'Accept': 'text/html'})
            assert response.status_code == 503 and response.json()['error'] == name + '_shell_not_built'


@pytest.mark.asyncio
async def test_public_routes_render_metadata_and_text_for_crawlers(hosted):
    app, dist = hosted
    (dist / 'index.html').write_text('<html><head><title>Kyalulu</title><meta name="description" content="generic">'
                                     '<meta property="og:title" content="Kyalulu"></head><body><div id="root"></div></body></html>', encoding='utf-8')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='https://app.test') as client:
        page = await client.get('/characters/butler', headers={'Accept': 'text/html'})
        assert page.status_code == 200 and page.text.count('<title>') == 1 and '<title>シオン執事 | Kyalulu</title>' in page.text
        assert '<link rel="canonical" href="https://app.test/characters/butler">' in page.text
        assert 'content="https://app.test/icons/shion-butler-1.png"' in page.text and 'content="generic"' not in page.text
        assert '<div id="root"><main><article><h1>シオン執事</h1>' in page.text
        listing = await client.get('/discover', headers={'Accept': 'text/html'})
        assert 'href="/characters/butler"' in listing.text and 'href="/characters/mocha_sfw"' in listing.text
        assert 'href="/characters/mocha"' not in listing.text  # NSFW characters stay out of public pages
        for path in ('/characters/mocha', '/characters/private-library-id', '/'):
            response = await client.get(path, headers={'Accept': 'text/html'})
            assert response.status_code == 200 and '<div id="root"></div>' in response.text
