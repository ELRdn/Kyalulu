"""LM Studio Provider - OpenAI compatible /v1/chat/completions + Phase0 contract."""
from __future__ import annotations
from typing import Any, AsyncIterator
import json
import httpx
from . import ModelProvider, default_http_timeout, resolve_messages, usage_event
from python.core.config import settings
def _wrap_response_format(schema: Any) -> dict:
    if isinstance(schema, dict) and schema.get("type") == "json_schema":
        return schema
    return {"type": "json_schema", "json_schema": {"name": "structured_response", "strict": True, "schema": schema}}
class LMStudioProvider(ModelProvider):
    BASE_SUPPORTED = frozenset({"messages", "model", "temperature", "top_p", "seed", "max_tokens"})
    def __init__(self, base_url: str | None = None, *, supports_structured_output: bool = False, transport: Any | None = None, timeout: httpx.Timeout | None = None, **_ignored: Any) -> None:
        self.base_url = (base_url or settings.lm_studio_url).rstrip("/")
        self.supports_structured_output = bool(supports_structured_output)
        self._transport = transport
        self._timeout = timeout or default_http_timeout()
    @property
    def _supported(self) -> frozenset:
        if self.supports_structured_output:
            return self.BASE_SUPPORTED | frozenset({"response_schema"})
        return self.BASE_SUPPORTED
    def _client(self) -> httpx.AsyncClient:
        kw: dict[str, Any] = {"timeout": self._timeout}
        if self._transport is not None:
            kw["transport"] = self._transport
        return httpx.AsyncClient(**kw)
    def generation_config(self, requested: dict) -> dict:
        req = dict(requested or {})
        applied: dict[str, Any] = {}
        unsupported: list[str] = []
        for k, v in req.items():
            if v is None:
                continue
            if k in self._supported:
                applied[k] = v
            else:
                unsupported.append(k)
        return {"requested": req, "applied": applied, "unsupported": unsupported}
    def _build_payload(self, messages: list[dict], applied: dict) -> dict:
        model = applied.get("model")
        if not model or not isinstance(model, str):
            raise ValueError("lmstudio: explicit model is required")
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True, "stream_options": {"include_usage": True}}
        if "temperature" in applied:
            payload["temperature"] = applied["temperature"]
        if "top_p" in applied:
            payload["top_p"] = applied["top_p"]
        if "seed" in applied:
            payload["seed"] = applied["seed"]
        if "max_tokens" in applied:
            payload["max_tokens"] = applied["max_tokens"]
        if "response_schema" in applied:
            payload["response_format"] = _wrap_response_format(applied["response_schema"])
        return payload
    async def stream_events(self, prompt: str = "", **kwargs: Any) -> AsyncIterator[dict]:
        messages = resolve_messages(prompt, kwargs.get("messages"))
        requested = {k: v for k, v in kwargs.items() if k != "messages" and v is not None}
        cfg = self.generation_config(requested)
        payload = self._build_payload(messages, cfg["applied"])
        async with self._client() as client:
            async with client.stream("POST", f"{self.base_url}/chat/completions", json=payload) as r:
                r.raise_for_status()
                done_marker = False
                finish_seen = False
                pu: Any = None
                cu: Any = None
                thinking: Any = None
                async for line in r.aiter_lines():
                    if not line or not line.strip():
                        continue
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        done_marker = True
                        break
                    try:
                        obj = json.loads(data_str)
                    except json.JSONDecodeError as e:
                        raise RuntimeError(f"lmstudio: malformed JSON in SSE data: {data_str[:300]!r}") from e
                    if not isinstance(obj, dict):
                        raise RuntimeError(f"lmstudio: malformed chunk (not object): {data_str[:300]!r}")
                    if isinstance(obj.get("usage"), dict):
                        thinking = obj["usage"].get("completion_tokens_details", {}).get("reasoning_tokens", thinking)
                    if "choices" not in obj:
                        if isinstance(obj.get("usage"), dict):
                            u = obj["usage"]
                            if u.get("prompt_tokens") is not None:
                                pu = u.get("prompt_tokens")
                            if u.get("completion_tokens") is not None:
                                cu = u.get("completion_tokens")
                            continue
                        raise RuntimeError(f"lmstudio: malformed chunk missing choices: {data_str[:300]!r}")
                    yield {"type": "chunk"}
                    choices = obj["choices"]
                    if not isinstance(choices, list) or not choices:
                        if isinstance(obj.get("usage"), dict):
                            u2 = obj["usage"]
                            if u2.get("prompt_tokens") is not None:
                                pu = u2.get("prompt_tokens")
                            if u2.get("completion_tokens") is not None:
                                cu = u2.get("completion_tokens")
                            continue
                        raise RuntimeError(f"lmstudio: malformed choices: {data_str[:300]!r}")
                    ch = choices[0]
                    if not isinstance(ch, dict):
                        raise RuntimeError(f"lmstudio: malformed choice: {data_str[:300]!r}")
                    fr = ch.get("finish_reason")
                    if fr is not None:
                        finish_seen = True
                    delta = ch.get("delta", {})
                    if isinstance(delta, dict):
                        c = delta.get("content")
                        if c is None:
                            pass
                        elif isinstance(c, str):
                            if c:
                                yield {"type": "delta", "text": c}
                        else:
                            raise RuntimeError(f"lmstudio: malformed delta.content: {data_str[:300]!r}")
                    if isinstance(obj.get("usage"), dict):
                        u3 = obj["usage"]
                        if u3.get("prompt_tokens") is not None:
                            pu = u3.get("prompt_tokens")
                        if u3.get("completion_tokens") is not None:
                            cu = u3.get("completion_tokens")
                if not done_marker:
                    raise RuntimeError("lmstudio: truncated stream (missing [DONE])")
                if not finish_seen:
                    raise RuntimeError("lmstudio: truncated stream (missing finish_reason)")
                yield usage_event(pu, cu, thinking)
    async def connect(self) -> bool:
        try:
            async with self._client() as c:
                r = await c.get(f"{self.base_url}/models")
                return r.status_code == 200
        except Exception:
            return False
    async def list_models(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get(f"{self.base_url}/models")
            r.raise_for_status()
            data = r.json()
            return [{"id": m["id"], "name": m["id"]} for m in data.get("data", [])]
    async def get_model_metadata(self, model_id: str) -> dict:
        return {"id": model_id, "provider": "lm_studio"}
    async def health_check(self) -> dict:
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "lm_studio", "base_url": self.base_url}
    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
