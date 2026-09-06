"""Hub transport/adapters and transactional URL imports using simulated public HTTP."""
import asyncio
import hashlib
import json
import socket
import httpx
import pytest
from python.core.hub_http import HubHTTP, resolve_public, allowed_url
from python.core.hub_schema import HubError, UrlImport
from python.core.hubs import Hubs, sfw_manifest
from python.api import hubs as api
from python.api.main import app
from python.core.portable_formats import parse_import
from python.core.portable_binary import PNG_MAGIC, neutral_png, parse_png_chunks, _png_chunk, build_png_with_text

pytestmark = pytest.mark.asyncio
ID = '12c021b3-7efb-4157-85c7-134178fa6d81'
SHA = 'a' * 40
CARD = {'spec': 'chara_card_v3', 'spec_version': '3.0', 'future': {'keep': 1}, 'data': {
    'name': 'Hub案内人', 'description': '静かな図書館の案内人', 'creator': 'Author',
    'character_book': {'entries': [{'keys': ['鍵'], 'content': '鍵は青色です。', 'enabled': True}]}}}
RAW = json.dumps(CARD, ensure_ascii=False).encode()


async def test_stream_encoded_png_many_idat_chunks_and_bounded_count():
    import base64
    chunks = parse_png_chunks(neutral_png())
    image = PNG_MAGIC + _png_chunk(b'IHDR', chunks[0][1])
    image += _png_chunk(b'IDAT', chunks[1][1]) + _png_chunk(b'IDAT', b'') * 741 + _png_chunk(b'IEND', b'')
    card = build_png_with_text(image, {'chara': base64.b64encode(RAW).decode()})
    docs, assets = parse_import('stream-encoded.png', card)
    assert docs[0].name == CARD['data']['name'] and len(assets) == 1
    excessive = PNG_MAGIC + _png_chunk(b'IHDR', chunks[0][1]) + _png_chunk(b'IDAT', b'') * 8192 + _png_chunk(b'IEND', b'')
    with pytest.raises(ValueError, match='Too many'): parse_png_chunks(excessive)


class FixtureHTTP:
    def __init__(self): self.calls = []
    async def json(self, url, family):
        self.calls.append(url)
        if '/api/cards/' in url:
            return {'card': {'id': ID, 'name': '案内人', 'is_nsfw': False, 'character_data': CARD}}
        if '/api/cards?' in url or '/api/search?' in url:
            return {'cards': [{'id': ID, 'name': '案内人', 'is_nsfw': False},
                             {'id': ID, 'name': 'Excluded', 'is_nsfw': True},
                             {'id': ID, 'name': 'Unknown'}], 'hasMore': True, 'total': 100}
        if '/commits/' in url or '/revision/' in url:
            return {'sha': SHA}
        raise AssertionError(url)
    async def get(self, url, family):
        self.calls.append(url)
        return RAW


async def test_list_search_detail_filter_and_shapes():
    h = Hubs(FixtureHTTP())
    for q in ('', '日本語'):
        result = await h.items('taverncard', q, 2)
        assert [i.name for i in result.items] == ['案内人']
        assert result.has_more and result.total is None
        assert 'nsfw=false' in h.http.calls[-1] and 'page=2' in h.http.calls[-1]
    assert (await h.detail('taverncard', ID)).author == 'Author'
    resolved = await h.resolve(UrlImport(url=f'https://www.taverncard.com/ja/character/{ID}/guide'))
    assert resolved.content_rating == 'sfw' and resolved.transport == 'server'
    assert await h.download(resolved) == RAW


@pytest.mark.parametrize('url', ['http://127.0.0.1/x.json', 'https://evil.example/x.json',
    'https://github.com@evil.example/o/r/blob/main/a.json', 'https://github.com/o/r',
    'https://github.com/o/r/blob/main/model.gguf', 'https://github.com/o/r/blob/main/a.json?token=secret',
    'https://github.com:8443/o/r/blob/main/a.json', 'https://github.com/o/r/blob/main/%2e%2e/a.json',
    'https://realm.risuai.net/api/v1/download/module-v1/' + ID])
async def test_reject_unsupported_urls_without_network(url):
    h = Hubs(FixtureHTTP())
    with pytest.raises(HubError): await h.resolve(UrlImport(url=url))
    assert not h.http.calls


@pytest.mark.parametrize('fmt', ['png-v3', 'json-v3', 'lorebook-v2', 'lorebook-v3', 'preset-st-chat'])
async def test_risu_browser_only_no_assumed_noncommercial(fmt):
    h = Hubs(FixtureHTTP())
    r = await h.resolve(UrlImport(url=f'https://realm.risuai.net/character/{ID}', format=fmt))
    assert r.transport == 'browser' and 'cors=true' in r.download_url and 'non_commercial' not in r.download_url
    with pytest.raises(HubError, match='ブラウザー'): await h.download(r)
    assert not h.http.calls
    r = await h.resolve(UrlImport(url=r.source_url, format=fmt, non_commercial=True))
    assert 'non_commercial=true' in r.download_url
    old = await h.resolve(UrlImport(url='https://realm.risuai.net/character/' + 'a' * 64, format=fmt))
    assert old.source_id == 'a' * 64 and old.transport == 'browser'


@pytest.mark.parametrize('url,kind', [('https://github.com/author/cards/blob/main/a.json', 'github'),
    ('https://raw.githubusercontent.com/author/cards/main/a.json', 'github'),
    ('https://huggingface.co/datasets/author/cards/blob/main/a.json', 'huggingface'),
    ('https://huggingface.co/spaces/author/cards/resolve/main/a.png', 'huggingface')])
async def test_repository_pin(url, kind):
    h = Hubs(FixtureHTTP()); r = await h.resolve(UrlImport(url=url))
    assert r.source == kind and r.revision == SHA and SHA in r.download_url
    assert r.content_rating == 'unknown'


async def test_dns_all_addresses_checked(monkeypatch):
    async def resolve(*a, **kw): return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))]
    monkeypatch.setattr(asyncio.get_running_loop(), 'getaddrinfo', resolve)
    with pytest.raises(HubError, match='プライベート'): await resolve_public('github.com')


async def test_transport_pins_dns_keeps_tls_host_and_no_credentials():
    requests = []
    async def resolver(host): return '93.184.216.34'
    def handler(request):
        requests.append(request)
        assert request.url.host == '93.184.216.34'
        assert request.headers['host'] == 'raw.githubusercontent.com'
        assert request.extensions['sni_hostname'] == 'raw.githubusercontent.com'
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        return httpx.Response(200, content=RAW)
    h = HubHTTP(httpx.MockTransport(handler), resolver)
    assert await h.get('https://raw.githubusercontent.com/a/b/main/a.json', 'github') == RAW
    assert len(requests) == 1


@pytest.mark.parametrize('status,headers,code', [(403, {}, 'forbidden'), (404, {}, 'not_found'),
    (429, {'Retry-After': '30'}, 'rate_limited'), (500, {}, 'upstream_error'),
    (200, {'Content-Length': '999999999'}, 'too_large'),
    (302, {'Location': 'https://127.0.0.1/a.json'}, 'blocked_target')])
async def test_http_failures_and_redirects(status, headers, code):
    async def resolver(host): return '93.184.216.34'
    h = HubHTTP(httpx.MockTransport(lambda req: httpx.Response(status, headers=headers)), resolver)
    with pytest.raises(HubError) as error:
        await h.get('https://raw.githubusercontent.com/a/b/main/a.json', 'github')
    assert error.value.code == code
    if status == 429: assert error.value.retry_after == '30'


async def test_stream_limit_timeout_cancel_and_hf_redirect():
    async def resolver(host): return '93.184.216.34'
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'x' * 5
            yield b'x' * 5
    h = HubHTTP(httpx.MockTransport(lambda req: httpx.Response(200, stream=Stream())), resolver)
    with pytest.raises(HubError) as err: await h.get('https://raw.githubusercontent.com/a/b/main/a.json', 'github', limit=8)
    assert err.value.code == 'too_large'
    async def slow(req): raise httpx.ReadTimeout('test')
    h.transport = httpx.MockTransport(slow)
    with pytest.raises(HubError) as err: await h.get('https://raw.githubusercontent.com/a/b/main/a.json', 'github')
    assert err.value.code == 'timeout'
    started = asyncio.Event()
    async def waiting(req):
        started.set(); await asyncio.Future()
    h.transport = httpx.MockTransport(waiting)
    task = asyncio.create_task(h.get('https://raw.githubusercontent.com/a/b/main/a.json', 'github'))
    await started.wait(); task.cancel()
    with pytest.raises(asyncio.CancelledError): await task
    assert allowed_url('https://cas-bridge.xethub.hf.co/a?signature=x', 'huggingface')
    with pytest.raises(HubError): allowed_url('https://evil.hf.co/a', 'huggingface')


async def test_sfw_hash_pinned_and_no_new_index_entries(monkeypatch):
    manifest = sfw_manifest(); rev = manifest['revision']; approved = manifest['cards'][0]
    class HTTP(FixtureHTTP):
        async def json(self, url, family):
            if '/commits/' in url: return {'sha': rev}
            assert rev in url
            return [{'id': approved['id'], 'name': 'Coding Sensei', 'type': 'character'},
                    {'id': 'new.png', 'name': 'Unchecked', 'type': 'character'},
                    {'id': 'extension', 'type': 'extension'}]
    h = Hubs(HTTP()); result = await h.items('sillytavern')
    assert [i.name for i in result.items] == ['Coding Sensei']
    r = await h.resolve(UrlImport(url=result.items[0].source_url))
    assert r.source == 'sillytavern' and r.expected_hash == approved['sha256']
    with pytest.raises(HubError) as err: await h.download(r)
    assert err.value.code == 'hash_mismatch'


async def test_remote_api_restore_commit_duplicate_revision_backup(isolated, monkeypatch):
    monkeypatch.setattr(api, 'service', Hubs(FixtureHTTP()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver') as cli:
        for origin in ('https://evil.example', 'null', 'http://localhost:9999'):
            r = await cli.post('/api/imports/url/preview', json={'url': f'https://www.taverncard.com/character/{ID}'}, headers={'Origin': origin})
            assert r.status_code == 403
        r = await cli.post('/api/imports/url/preview', json={'url': f'https://www.taverncard.com/character/{ID}'}, headers={'Origin': 'http://127.0.0.1:5174'})
        assert r.status_code == 200, r.text
        p = r.json(); doc = p['documents'][0]
        assert doc['source']['remote']['sha256'] == hashlib.sha256(RAW).hexdigest()
        assert (await cli.get('/api/imports/' + p['preview_id'])).json() == p
        doc['source']['remote']['author'] = 'FORGED'
        body = {'request_id': 'hub-once', 'selections': [{'index': 0, 'document': doc}]}
        url = '/api/imports/' + p['preview_id'] + '/commit'
        first = await cli.post(url, json=body)
        assert first.status_code == 200, first.text
        item = first.json()['items'][0]
        assert item['document']['source']['remote']['author'] == 'Author'
        assert (await cli.post(url, json=body)).json() == first.json()
        p2 = (await cli.post('/api/imports/url/preview', json={'url': f'https://www.taverncard.com/character/{ID}'})).json()
        assert p2['duplicates']['0'][0]['id'] == item['id']
        body['request_id'] = 'hub-second'; url2 = '/api/imports/' + p2['preview_id'] + '/commit'
        assert (await cli.post(url2, json=body)).status_code == 409
        await cli.put('/api/chat/settings', json={'session_id': 'hub-session', 'character_id': item['id']})
        body['selections'][0].update(target_id=item['id'], expected_revision=1)
        second = await cli.post(url2, json=body)
        assert second.status_code == 200 and second.json()['items'][0]['revision'] == 2
        debug = (await cli.get('/api/chat/debug?session_id=hub-session')).json()
        assert debug['settings']['library_binding']['character']['revision'] == 1
        assert 'FORGED' not in debug['compiled']['system_prompt'] and 'source_url' not in debug['compiled']['system_prompt']
        backup = await cli.get(f'/api/library/{item["id"]}/export?format=backup&download=true')
        docs, _ = parse_import('backup.zip', backup.content)
        assert docs[0].source['remote']['source_id'] == ID and docs[0].source['original']['future']['keep'] == 1


async def test_risu_claimed_origin_unknown_rating_and_presets(isolated, monkeypatch):
    h = Hubs(FixtureHTTP()); monkeypatch.setattr(api, 'service', h)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://testserver') as cli:
        for fmt, raw, kind in [('json-v3', RAW, 'character'), ('lorebook-v3', b'{"entries":[{"keys":["key"],"content":"blue","enabled":true}]}', 'lorebook'), ('preset-st-chat', b'{"temperature":0.5,"name":"preset"}', 'profile')]:
            r = await cli.post('/api/imports/preview', files={'file': ('a.json', raw)}, data={'remote': json.dumps({'url': f'https://realm.risuai.net/character/{ID}', 'format': fmt})})
            assert r.status_code == 200, r.text
            p = r.json(); doc = p['documents'][0]
            assert doc['kind'] == kind and doc['source']['remote']['origin_verified'] is False
            body = {'request_id': fmt, 'selections': [{'index': 0, 'document': doc}]}
            url = '/api/imports/' + p['preview_id'] + '/commit'
            assert (await cli.post(url, json=body)).status_code == 400
            body['selections'][0]['content_rating'] = 'sfw'
            assert (await cli.post(url, json=body)).status_code == 200
        assert not h.http.calls
