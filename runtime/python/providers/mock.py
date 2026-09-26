"""Deterministic local fixture; never pretends to be a measured model."""
import json
import re
from . import ModelProvider, last_user_text, usage_event

MEMORY_LINE = re.compile(r"^- \[\w+\] (.+)$", re.M)
MEMORY_TRIGGERS = ("覚えて", "忘れないで", "好き", "remember")


class MockProvider(ModelProvider):
    async def connect(self): return True
    async def list_models(self): return [{"id": "mock-echo", "name": "Mock Echo"}]
    async def get_model_metadata(self, model_id): return {"id": model_id, "provider": "mock"}
    async def health_check(self): return {"status": "ok", "provider": "mock"}
    def capabilities(self): return {"streaming": True, "structured_output": True}
    def generation_config(self, requested):
        return {"requested": dict(requested), "applied": {k: v for k, v in requested.items() if k in {"model", "response_schema"}}, "unsupported": [k for k in requested if k not in {"model", "response_schema"}]}

    async def stream_events(self, prompt="", **kwargs):
        user = last_user_text(prompt, kwargs.get("messages"))
        reply = "Mock: " + user
        schema = kwargs.get("response_schema") or {}
        output = {"reply": reply, "state_update": {"location": "", "time": "", "mood": "neutral",
            "active_scene": "conversation", "relationship_state": {"stage": "acquaintance",
            "tone": "friendly", "unresolved_conflict": False}}}
        if "memory_proposals" in schema.get("properties", {}):
            # Echo injected memories to test transport, not model quality. Using only the first
            # made recall tests depend on incidental retrieval ordering and random memory IDs.
            system = "\n".join(m.get("content", "") for m in kwargs.get("messages") or [] if m.get("role") == "system")
            recalled = MEMORY_LINE.findall(system)
            if recalled:
                output["reply"] = reply + f"（覚えてるよ: {' / '.join(recalled[:5])}）"
            keep = any(k in user for k in MEMORY_TRIGGERS)
            output["memory_proposals"] = [{"type": "semantic", "content": user[:200]}] if keep else []
        raw = json.dumps(output, ensure_ascii=False) if schema else reply
        for pos in range(0, len(raw), 7):
            yield {"type": "delta", "text": raw[pos:pos + 7]}
        yield usage_event()
