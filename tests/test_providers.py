import json
import httpx
import pytest
from python.providers.ollama import OllamaProvider
from python.providers.lmstudio import LMStudioProvider
from python.providers.openai_compat import OpenAICompatibleProvider
from python.providers.responses import ResponsesProvider
from python.providers.factory import get_provider, get_provider_for_model
from python.providers.le import LEProvider


def sse(*objects):
    return ''.join('data: ' + (x if isinstance(x, str) else json.dumps(x)) + '\n\n' for x in objects)


@pytest.mark.asyncio
@pytest.mark.parametrize('cls', [LMStudioProvider, OpenAICompatibleProvider])
async def test_chat_adapters(cls):
    def handle(req):
        body = json.loads(req.content)
        assert body['seed'] == 42 and body['temperature'] == .3 and body['top_p'] == .8
        assert body['messages'][0]['role'] == 'system'
        assert body['response_format']['json_schema']['schema'] == {'type': 'object'}
        return httpx.Response(200, text=sse(
            {'choices': [{'delta': {'content': 'hi'}, 'finish_reason': None}]},
            {'choices': [{'delta': {}, 'finish_reason': 'stop'}]},
            {'choices': [], 'usage': {'prompt_tokens': 7, 'completion_tokens': 2}}, '[DONE]'))
    provider = cls(base_url='http://local/v1', transport=httpx.MockTransport(handle), supports_structured_output=True)
    requested = {'seed': 42, 'temperature': .3, 'top_p': .8, 'reasoning': 'high'}
    assert provider.generation_config(requested)['unsupported'] == ['reasoning']
    events = [e async for e in provider.stream_events(model='chosen', messages=[{'role': 'system', 'content': 'role'}],
              response_schema={'type': 'object'}, **requested)]
    assert events[0]['type'] == 'chunk'
    assert next(e['text'] for e in events if e['type'] == 'delta') == 'hi'
    assert events[-1]['usage']['completion_tokens'] == 2


@pytest.mark.asyncio
async def test_ollama_options_and_usage():
    def handle(req):
        body = json.loads(req.content)
        assert body['options'] == {'temperature': .3, 'top_p': .8, 'seed': 42, 'num_predict': 100, 'num_ctx': 4096}
        assert body['think'] is False
        assert body['format'] == {'type': 'object'}
        return httpx.Response(200, text=json.dumps({'message': {'content': 'hi'}, 'done': False}) + '\n' + json.dumps({'done': True, 'prompt_eval_count': 5, 'eval_count': 2}))
    p = OllamaProvider(transport=httpx.MockTransport(handle))
    events = [e async for e in p.stream_events(model='chosen', temperature=.3, top_p=.8, seed=42, max_tokens=100, think=False, num_ctx=4096, response_schema={'type': 'object'})]
    assert events[-1]['usage']['prompt_tokens'] == 5


@pytest.mark.asyncio
async def test_responses_roles_params_usage():
    def handle(req):
        body = json.loads(req.content)
        assert [m['role'] for m in body['input']] == ['system', 'user', 'assistant', 'user']
        assert body['model'] == 'explicit'
        assert 'temperature' not in body and 'seed' not in body
        assert body['max_output_tokens'] == 128
        return httpx.Response(200, text=sse({'type': 'response.output_text.delta', 'delta': 'hi'},
            {'type': 'response.completed', 'response': {'usage': {'input_tokens': 8, 'output_tokens': 5, 'output_tokens_details': {'reasoning_tokens': 3}}}}))
    p = ResponsesProvider(base_url='http://local/v1', transport=httpx.MockTransport(handle))
    events = [e async for e in p.stream_events(model='explicit', temperature=.3, seed=1, max_tokens=128,
        messages=[{'role': role, 'content': 'x'} for role in ['system', 'user', 'assistant', 'user']])]
    assert events[-1]['usage']['thinking_tokens'] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize('cls,content', [
    (OllamaProvider, '{bad'), (OllamaProvider, '{"done":false,"message":{"content":"x"}}'),
    (LMStudioProvider, 'data: {bad\n\n'), (LMStudioProvider, sse({'choices':[{'delta':{'content':'x'}}]})),
    (ResponsesProvider, sse({'type':'response.output_text.delta','delta':'x'})),
    (ResponsesProvider, sse({'type':'response.failed'})),
])
async def test_malformed_and_truncated(cls, content):
    p = cls(base_url='http://local/v1', transport=httpx.MockTransport(lambda r: httpx.Response(200, text=content)))
    with pytest.raises((ValueError, RuntimeError)):
        _ = [e async for e in p.stream_events(model='test')]


@pytest.mark.parametrize('name', ['le', 'ollama','lm_studio','openai_compatible','responses','mock'])
def test_factory(name):
    assert get_provider_for_model({'provider': {'type': name, 'model': 'explicit'}}) is not None


def test_no_mock_fallback():
    with pytest.raises(ValueError): get_provider('typo')
    with pytest.raises(ValueError): get_provider_for_model({'provider': {'type': 'ollama'}})


@pytest.mark.asyncio
async def test_le_provider_routes_and_auth():
    seen = []
    def handle(req):
        seen.append((req.url.path, req.headers.get('authorization')))
        if req.url.path == '/le/v1/health':
            return httpx.Response(200, json={'status': 'ok'})
        body = json.loads(req.content)
        assert body['model'] == 'ollama/qwen3:8b'
        return httpx.Response(200, text=sse({'choices': [{'delta': {'content': 'hi'}, 'finish_reason': 'stop'}]},
            {'choices': [], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1}}, '[DONE]'))
    p = LEProvider(base_url='http://le:8130/v1', api_key='tok', transport=httpx.MockTransport(handle))
    assert (await p.health_check())['status'] == 'ok'
    text = await p.generate(model='ollama/qwen3:8b', messages=[{'role': 'user', 'content': 'x'}])
    assert text == 'hi'
    assert seen == [('/le/v1/health', 'Bearer tok'), ('/v1/chat/completions', 'Bearer tok')]


@pytest.mark.asyncio
async def test_le_provider_reports_unauthorized_and_missing_token(monkeypatch):
    p = LEProvider(base_url='http://le:8130', api_key='bad', transport=httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    assert (await p.health_check())['status'] == 'unauthorized'
    monkeypatch.setattr('python.providers.le.resolve_le_token', lambda: '')
    assert (await LEProvider(base_url='http://le:8130').health_check())['status'] == 'offline'


def test_find_model_falls_through_to_le():
    from python.core.registry import find_model
    cfg = find_model('le:ollama/qwen3:8b')
    assert cfg['provider'] == {'type': 'le', 'model': 'ollama/qwen3:8b', 'structured_output': True}
    assert 'response_schema' in get_provider_for_model(cfg).generation_config({'response_schema': {}})['applied']
    assert find_model('le:') is None and find_model('nope') is None
    assert isinstance(get_provider_for_model(cfg), LEProvider)


def _fake_le(monkeypatch, handle, token='tok'):
    real = LEProvider
    def make(**kw):
        return real(base_url='http://le:8130', api_key=token, transport=httpx.MockTransport(handle), **kw)
    monkeypatch.setattr('python.providers.le.LEProvider', make)
    monkeypatch.setattr('python.api.le.LEProvider', make)
    monkeypatch.setattr('python.api.commands.LEProvider', make)


@pytest.mark.asyncio
async def test_le_models_listed_and_relay_passes_through(monkeypatch):
    from python.core.registry import list_le_models
    seen = []
    def handle(req):
        seen.append((req.method, req.url.path, req.url.query.decode(), req.headers.get('authorization'),
                     req.headers.get('idempotency-key'), req.content))
        if req.url.path == '/v1/models':
            return httpx.Response(200, json={'data': [{'id': 'ollama/qwen3:8b'}, {'id': 'le/tiny'}]})
        if req.url.path == '/le/v1/models/download':
            return httpx.Response(202, json={'job': {'id': 'j1', 'state': 'queued'}})
        if req.url.path == '/le/v1/events':
            return httpx.Response(200, headers={'content-type': 'text/event-stream'}, content=b'id: 3\nevent: job\ndata: {}\n\n')
        return httpx.Response(404, json={'error': {'code': 'model_not_found', 'message': 'x'}})
    _fake_le(monkeypatch, handle)
    assert [m['id'] for m in await list_le_models()] == ['le:ollama/qwen3:8b', 'le:le/tiny']

    from python.api.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        r = await client.post('/api/le/models/download', json={'url': 'https://x/y.gguf', 'filename': 'y.gguf'},
                              headers={'idempotency-key': 'k1'})
        assert r.status_code == 202 and r.json()['job']['id'] == 'j1'
        r = await client.get('/api/le/models/le/missing')
        assert r.status_code == 404 and r.json()['error']['code'] == 'model_not_found'
        assert (await client.get('/api/le/models/le/../jobs')).status_code in (400, 404)
        r = await client.get('/api/le/events?since=2')
        assert r.headers['content-type'].startswith('text/event-stream') and b'event: job' in r.content
    download = next(s for s in seen if s[1] == '/le/v1/models/download')
    assert download[3:5] == ('Bearer tok', 'k1') and json.loads(download[5])['filename'] == 'y.gguf'
    assert ('GET', '/le/v1/events', 'since=2') == next(s for s in seen if s[1] == '/le/v1/events')[:3]
    assert ('GET', '/le/v1/models/le/missing') == next(s for s in seen if s[1].endswith('missing'))[:2]


@pytest.mark.asyncio
async def test_le_relay_without_le(monkeypatch):
    def down(req):
        raise httpx.ConnectError('refused')
    _fake_le(monkeypatch, down)
    from python.core.registry import list_le_models
    from python.api.main import app
    assert await list_le_models() == []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        for path in ('/api/le/models', '/api/le/events'):
            r = await client.get(path)
            assert r.status_code == 503 and r.json()['error']['code'] == 'le_unavailable'
    _fake_le(monkeypatch, down, token='')
    assert await list_le_models() == []


@pytest.mark.asyncio
async def test_slash_commands_drive_le(monkeypatch):
    jobs = {}
    calls = []
    def handle(req):
        body = json.loads(req.content) if req.content else None
        calls.append((req.method, req.url.path, body))
        path = req.url.path
        if path == '/le/v1/models/load':
            jobs['j1'] = {'id': 'j1' + '0' * 34, 'kind': 'load', 'state': 'completed', 'target': body['id']}
            return httpx.Response(202, json={'job': {**jobs['j1'], 'state': 'queued'}})
        if path.startswith('/le/v1/jobs/'):
            return httpx.Response(200, json=jobs['j1'])
        if path == '/le/v1/models/unload':
            return httpx.Response(200, json={'unloaded': True})
        if path == '/le/v1/jobs':
            return httpx.Response(200, json={'jobs': [{'id': 'abcd' + '0' * 32, 'kind': 'download', 'state': 'running',
                                                       'target': 'le/x', 'progress': {'phase': 'downloading', 'done': 5, 'total': 10}}]})
        return httpx.Response(404, json={'error': {'code': 'model_not_found', 'message': 'no such model'}})
    _fake_le(monkeypatch, handle)
    from python.api.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert any(c['name'] == '/le load' for c in (await client.get('/api/commands')).json()['commands'])
        r = (await client.post('/api/commands', json={'input': '/le load tiny ctx=4096 ngl=20'})).json()
        assert r['ok'] and r['refresh_models'] and 'le/tiny' in r['output']
        assert calls[0] == ('POST', '/le/v1/models/load', {'id': 'le/tiny', 'context_length': 4096, 'gpu_layers': 20})
        r = (await client.post('/api/commands', json={'input': '/le unload'})).json()
        assert r['ok'] and calls[-1] == ('POST', '/le/v1/models/unload', {})
        r = (await client.post('/api/commands', json={'input': '/le jobs'})).json()
        assert '50%' in r['output'] and 'abcd0000' in r['output']
        r = await client.post('/api/commands', json={'input': '/le delete nope'})
        assert r.status_code == 400 and 'no such model' in r.json()['output']
        for bad in ('/le load', '/le load x ctx=abc', '/nope', '/le warp', 'hello', '/le load "x'):
            r = await client.post('/api/commands', json={'input': bad})
            assert r.status_code == 400 and not r.json()['ok'], bad
        assert '/le status' in (await client.post('/api/commands', json={'input': '/help'})).json()['output']


@pytest.mark.asyncio
async def test_slash_commands_plan_devices_and_resume(monkeypatch):
    calls = []
    plan = {'device': 'Vulkan0', 'device_name': 'RX 9070 XT', 'free_bytes': 8 << 30, 'gpu_layers': 12,
            'total_layers': 30, 'full_offload': False, 'context_length': 8192, 'model_bytes': 16 << 30,
            'kv_cache_bytes': 2 << 30, 'kv_exact': True, 'overhead_bytes': 768 << 20,
            'estimated_vram_bytes': 7 << 30, 'notes': ['12/30 layers offloaded']}
    def handle(req):
        body = json.loads(req.content) if req.content else None
        calls.append((req.method, req.url.path, body))
        path = req.url.path
        if path == '/le/v1/models/plan':
            return httpx.Response(200, json={'id': body['id'], 'plan': plan})
        if path == '/le/v1/engine/devices':
            return httpx.Response(200, json={'devices': [
                {'id': 'Vulkan0', 'name': 'RX 9070 XT', 'free_bytes': 8 << 30, 'total_bytes': 16 << 30, 'integrated': False},
                {'id': 'Vulkan1', 'name': 'Radeon(TM) Graphics', 'free_bytes': 70 << 30, 'total_bytes': 80 << 30, 'integrated': True}]})
        if path == '/le/v1/models/load':
            return httpx.Response(202, json={'job': {'id': 'j' * 36, 'kind': 'model_load', 'state': 'completed',
                                                     'result': {'plan': plan}}})
        if path == '/le/v1/models/le/big':
            return httpx.Response(200, json={'id': 'le/big', 'state': 'partial', 'done_bytes': 3 << 30,
                                             'total_bytes': 6 << 30, 'url': 'https://h/big.gguf'})
        if path == '/le/v1/models':
            return httpx.Response(200, json={'models': [{'id': 'le/big', 'state': 'partial', 'done_bytes': 3,
                                                         'total_bytes': 6, 'url': 'https://h/big.gguf'}]})
        if path == '/v1/models':
            return httpx.Response(200, json={'data': []})
        if path == '/le/v1/models/download':
            return httpx.Response(202, json={'job': {'id': 'd' * 36, 'state': 'queued'}})
        return httpx.Response(404, json={'error': {'code': 'model_not_found', 'message': 'x'}})
    _fake_le(monkeypatch, handle)
    from python.api.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        r = (await client.post('/api/commands', json={'input': '/le plan big device=Vulkan0'})).json()
        assert r['ok'] and '12/30' in r['output'] and 'Vulkan0' in r['output']
        assert calls[-1][2] == {'id': 'le/big', 'gpu_layers': 'auto', 'device': 'Vulkan0'}
        r = (await client.post('/api/commands', json={'input': '/le devices'})).json()
        assert 'Vulkan1' in r['output'] and '内蔵GPU' in r['output']
        r = (await client.post('/api/commands', json={'input': '/le load big'})).json()
        assert r['ok'] and '-ngl 12' in r['output']
        assert calls[-1][2] == {'id': 'le/big', 'gpu_layers': 'auto'}
        r = (await client.post('/api/commands', json={'input': '/le models'})).json()
        assert '途中 50%' in r['output'] and '/le resume le/big' in r['output']
        r = (await client.post('/api/commands', json={'input': '/le resume big'})).json()
        assert r['ok'] and calls[-1] == ('POST', '/le/v1/models/download', {'url': 'https://h/big.gguf', 'filename': 'big.gguf'})
        r = await client.post('/api/commands', json={'input': '/le load big ngl=lots'})
        assert r.status_code == 400
        r = await client.post('/api/le/models/plan', json={'id': 'le/big'})
        assert r.status_code == 200 and r.json()['plan']['gpu_layers'] == 12


@pytest.mark.asyncio
async def test_le_stream_error_keeps_structured_code():
    from python.core.generation import _error_label
    body = {'error': {'code': 'model_not_loaded', 'message': "'le/tiny' is not loaded"}}
    p = LEProvider(base_url='http://le:8130', api_key='tok',
                   transport=httpx.MockTransport(lambda r: httpx.Response(409, json=body)))
    with pytest.raises(httpx.HTTPStatusError) as err:
        async for _ in p.stream_events(model='le/tiny', messages=[{'role': 'user', 'content': 'x'}]):
            pass
    assert _error_label(err.value, 'le/tiny') == 'HTTPStatusError: model_not_loaded [le/tiny]'


@pytest.mark.asyncio
async def test_diagnostics_point_at_the_next_step(monkeypatch, isolated):
    from python.storage.db import init_db
    await init_db()
    def handle(req):
        path = req.url.path
        if path == '/le/v1/health':
            return httpx.Response(200, json={'status': 'ok'})
        if path == '/le/v1/capabilities':
            return httpx.Response(200, json={'inference': {'engine': {'available': True},
                                                           'backends': [{'id': 'ollama', 'state': 'ready'}]}})
        if path == '/le/v1/resources':
            return httpx.Response(200, json={'engine': None})
        if path == '/le/v1/models':
            return httpx.Response(200, json={'models': [{'id': 'le/tiny', 'state': 'ready'}]})
        if path == '/v1/models':
            return httpx.Response(200, json={'data': [{'id': 'ollama/qwen'}]})
        return httpx.Response(404, json={})
    _fake_le(monkeypatch, handle)
    import python.api.diagnostics as diag
    monkeypatch.setattr(diag, 'LEProvider', __import__('python.providers.le', fromlist=['LEProvider']).LEProvider)
    async def health():
        return {'health': [{'id': 'ollama', 'status': 'offline'}, {'id': 'lm_studio', 'status': 'offline'},
                           {'id': 'le', 'status': 'ok'}, {'id': 'mock', 'status': 'ok'}]}
    monkeypatch.setattr(diag, 'providers_health', health)
    from python.api.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        d = (await client.get('/api/diagnostics')).json()
    checks = {c['id']: c for c in d['checks']}
    assert d['ready'] is True and checks['api']['ok'] and checks['storage']['ok']
    assert checks['providers']['ok'] is False and 'LE' in checks['providers']['hint']
    assert checks['le']['ok'] and checks['le']['detail']['backends_ready'] == ['ollama']
    assert checks['le_engine']['ok'] is False and '/le load le/tiny' in checks['le_engine']['hint']

    _fake_le(monkeypatch, lambda r: httpx.Response(401, json={}))
    monkeypatch.setattr(diag, 'LEProvider', __import__('python.providers.le', fromlist=['LEProvider']).LEProvider)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        d = (await client.get('/api/diagnostics')).json()
    le = next(c for c in d['checks'] if c['id'] == 'le')
    assert le['ok'] is False and 'トークン' in le['message'] and d['ready'] is False
