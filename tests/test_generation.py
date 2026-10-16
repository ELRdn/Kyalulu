import asyncio
import json
import pytest
from python.core.generation import generate_events, reply_prefix
from python.core.schemas import RuntimeState, CompiledPrompt


VALID = {"reply": 'こんにちは「友達」\n😀', "state_update": {"location": "cafe", "time": "day",
    "mood": "happy", "active_scene": "chat", "relationship_state": {
        "stage": "friend", "tone": "warm", "unresolved_conflict": False}}}


class Fake:
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.calls = 0

    def generation_config(self, requested):
        return {"requested": requested, "applied": requested, "unsupported": []}

    async def stream_events(self, *args, **kwargs):
        self.calls += 1
        value = next(self.outputs)
        if isinstance(value, Exception):
            raise value
        for c in value:
            yield {"type": "delta", "text": c}
        yield {"type": "usage", "usage": {"completion_tokens": 10}}


async def collect(provider):
    return [e async for e in generate_events(provider, model="test", messages=[{"role": "user", "content": "hello"}],
        compiled=CompiledPrompt(system_prompt="character"), state=RuntimeState(), requested={"seed": 1})]


@pytest.mark.asyncio
@pytest.mark.parametrize('portable', [False, True])
async def test_rp_thought_contract_and_visible_reply_for_both_prompt_paths(portable):
    from python.core.portable_prompt import compile_portable
    from python.core.portable_schema import PortableDocument
    compiled = (compile_portable({'document': PortableDocument(name='アキ').model_dump()})
                if portable else CompiledPrompt(system_prompt='character'))
    reply = '*（もう少し話していたい）*\n\nもう一杯、飲む？'
    provider = Fake([json.dumps({**VALID, 'reply': reply}, ensure_ascii=False)])
    events = [e async for e in generate_events(provider, model='test',
        messages=[{'role': 'user', 'content': '*（まだ帰りたくない）*'}],
        compiled=compiled, state=RuntimeState(), requested={})]
    result = events[-1]['result']
    assert result['status'] == 'completed' and result['reply'] == reply
    contract = result['attempts'][0]['messages'][0]['content']
    assert 'visible to the user in reply' in contract
    assert 'Thoughts are not audible to other characters' in contract
    assert 'record them as spoken/shared facts' in contract
    assert 'Only a line-start @:' in contract
    assert result['attempts'][0]['messages'][-1]['content'] == '*（まだ帰りたくない）*'


@pytest.mark.parametrize("ascii_only", [True, False])
def test_reply_prefix_all_chunk_boundaries(ascii_only):
    raw = json.dumps(VALID, ensure_ascii=ascii_only)
    last = ""
    for i in range(len(raw) + 1):
        current = reply_prefix(raw[:i])
        assert current.startswith(last)
        assert VALID["reply"].startswith(current)
        last = current
    assert last == VALID["reply"]


def test_nested_reply_not_exposed():
    assert reply_prefix('{"state_update":{"reply":"wrong"},"reply":"right"') == "right"


@pytest.mark.asyncio
async def test_success_after_retry():
    provider = Fake(['{"reply":"old","state_update":{}}', json.dumps(VALID)])
    events = await collect(provider)
    result = events[-1]["result"]
    assert result["status"] == "completed"
    assert result["state"]["relationship"] == "friend"
    assert result["state"]["turn"] == 1
    assert result["validation"]["retries"] == 1
    assert len(result["attempts"]) == 2
    assert any(e["type"] == "reset" for e in events)


@pytest.mark.asyncio
async def test_invalid_preserves_state_and_raw():
    provider = Fake(['{"reply":"usable"}'] * 3)
    result = (await collect(provider))[-1]["result"]
    assert provider.calls == 3
    assert result["status"] == "invalid"
    assert result["state"] == result["state_before"]
    assert result["reply"] == "usable"
    assert all(a["raw"] and a["errors"] for a in result["attempts"])


@pytest.mark.asyncio
async def test_transport_not_retried():
    provider = Fake([ConnectionError("offline")])
    result = (await collect(provider))[-1]["result"]
    assert provider.calls == 1
    assert result["status"] == "failed"


@pytest.mark.asyncio
async def test_cancel_propagates():
    class Slow(Fake):
        async def stream_events(self, *args, **kwargs):
            await asyncio.sleep(10)
            yield {}
    task = asyncio.create_task(collect(Slow([])))
    await asyncio.sleep(.02)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_error_label_carries_provider_code_and_model():
    import httpx
    from python.core.generation import _error_label
    req = httpx.Request("POST", "http://le/v1/chat/completions")
    res = httpx.Response(409, json={"error": {"code": "model_not_loaded", "message": "x"}}, request=req)
    exc = httpx.HTTPStatusError("409", request=req, response=res)
    assert _error_label(exc, "le/tiny") == "HTTPStatusError: model_not_loaded [le/tiny]"
    plain = httpx.HTTPStatusError("500", request=req, response=httpx.Response(500, text="boom", request=req))
    assert _error_label(plain, "le/tiny") == "HTTPStatusError"
    assert _error_label(ValueError("x"), "m") == "ValueError"
