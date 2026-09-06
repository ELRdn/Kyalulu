import json
import httpx
import pytest
from python.providers.ollama import OllamaProvider
from python.providers.lmstudio import LMStudioProvider
from python.providers.openai_compat import OpenAICompatibleProvider
from python.providers.responses import ResponsesProvider
from python.providers.factory import get_provider, get_provider_for_model


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
        assert body['options'] == {'temperature': .3, 'top_p': .8, 'seed': 42, 'num_predict': 100}
        assert body['format'] == {'type': 'object'}
        return httpx.Response(200, text=json.dumps({'message': {'content': 'hi'}, 'done': False}) + '\n' + json.dumps({'done': True, 'prompt_eval_count': 5, 'eval_count': 2}))
    p = OllamaProvider(transport=httpx.MockTransport(handle))
    events = [e async for e in p.stream_events(model='chosen', temperature=.3, top_p=.8, seed=42, max_tokens=100, response_schema={'type': 'object'})]
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


@pytest.mark.parametrize('name', ['ollama','lm_studio','openai_compatible','responses','mock'])
def test_factory(name):
    assert get_provider_for_model({'provider': {'type': name, 'model': 'explicit'}}) is not None


def test_no_mock_fallback():
    with pytest.raises(ValueError): get_provider('typo')
    with pytest.raises(ValueError): get_provider_for_model({'provider': {'type': 'ollama'}})
