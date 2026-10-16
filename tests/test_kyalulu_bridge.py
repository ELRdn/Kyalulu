import hashlib
import importlib.util
from pathlib import Path

import httpx
import pytest
from benchmarks.characterbench.kcb.providers import _usage
from python.api.main import app as runtime
from python.storage import memories

spec=importlib.util.spec_from_file_location("native_bridge",Path(__file__).parents[1]/"benchmarks/characterbench/tools/kyalulu_bridge.py")
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


@pytest.mark.asyncio
async def test_actual_runtime_adapter_memory_replay_and_parameter_disclosure(isolated):
    app=bridge.create_app(path=isolated/"bridge.db",transport=httpx.ASGITransport(app=runtime))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test") as client:
        body={"protocol":"kcb-system-step-0.1","session_id":"original-run","turn_index":1,"reset":True,
              "messages":[{"role":"system","content":"You are a kind guide."},{"role":"user","content":"サーモンが好き、覚えて"}],
              "generation":{"model":"mock-echo","temperature":.6,"max_tokens":64,"top_p":.8}}
        response=await client.post("/kcb/v1/step",json=body)
        assert response.status_code==200,response.text
        value=response.json()
        assert value["mock"] and value["runtime_id"]==bridge.RUNTIME_ID
        assert value["generation_config"]["requested"]["max_tokens"]==64
        assert "max_tokens" in value["generation_config"]["unsupported"]
        local_sid="kcb:"+hashlib.sha256(b"original-run").hexdigest()
        assert len(await memories.list_memories(f"session:{local_sid}"))==1
        replay=await client.post("/kcb/v1/step",json=body)
        assert replay.json()["replayed_response"]
        changed=await client.post("/kcb/v1/step",json={**body,"messages":[{"role":"user","content":"edited"}]})
        assert changed.status_code==409
        next_body={**body,"turn_index":2,"reset":False,"messages":[{"role":"user","content":"サーモンの好みを覚えてる？"}]}
        second=await client.post("/kcb/v1/step",json=next_body)
        assert second.status_code==200 and "覚えてるよ" in second.json()["text"]


@pytest.mark.asyncio
@pytest.mark.parametrize("thinking_tokens", [7, None])
async def test_adapter_reasoning_usage_preserves_unknown(tmp_path, thinking_tokens):
    def respond(request):
        if request.url.path == "/api/models":
            data = {"models": [{"id": "mock-echo", "provider_type": "mock"}]}
        elif request.url.path.startswith("/api/chat/context/"):
            data = {"history_revision": 0}
        elif request.url.path == "/api/chat" and request.method == "POST":
            data = {"status": "completed", "reply": "test", "telemetry": {
                "prompt_tokens": 11, "completion_tokens": 19, "thinking_tokens": thinking_tokens}}
        else:
            data = {"history": []}
        return httpx.Response(200, json=data)

    app = bridge.create_app(path=tmp_path/"bridge.db", transport=httpx.MockTransport(respond))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/kcb/v1/step", json={"protocol": "kcb-system-step-0.1",
            "session_id": "usage", "turn_index": 1, "reset": True,
            "messages": [{"role": "user", "content": "test"}], "generation": {"model": "mock-echo"}})
        assert response.status_code == 200
        usage = _usage(response.json()["usage"])
        assert usage["prompt_tokens"] == 11 and usage["completion_tokens"] == 19
        if thinking_tokens is None:
            assert "reasoning_tokens" not in usage
        else:
            assert usage["reasoning_tokens"] == thinking_tokens
