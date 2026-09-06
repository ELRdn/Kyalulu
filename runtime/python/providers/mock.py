"""Deterministic local fixture; never pretends to be a measured model."""
import json
from . import ModelProvider, last_user_text, usage_event


class MockProvider(ModelProvider):
    async def connect(self): return True
    async def list_models(self): return [{"id": "mock-echo", "name": "Mock Echo"}]
    async def get_model_metadata(self, model_id): return {"id": model_id, "provider": "mock"}
    async def health_check(self): return {"status": "ok", "provider": "mock"}
    def capabilities(self): return {"streaming": True, "structured_output": True}
    def generation_config(self, requested):
        return {"requested": dict(requested), "applied": {k: v for k, v in requested.items() if k in {"model", "response_schema"}}, "unsupported": [k for k in requested if k not in {"model", "response_schema"}]}

    async def stream_events(self, prompt="", **kwargs):
        reply = "Mock: " + last_user_text(prompt, kwargs.get("messages"))
        raw = json.dumps({"reply": reply, "state_update": {"location": "", "time": "", "mood": "neutral",
            "active_scene": "conversation", "relationship_state": {"stage": "acquaintance",
            "tone": "friendly", "unresolved_conflict": False}}}, ensure_ascii=False) if kwargs.get("response_schema") else reply
        for pos in range(0, len(raw), 7):
            yield {"type": "delta", "text": raw[pos:pos + 7]}
        yield usage_event()
