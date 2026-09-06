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
