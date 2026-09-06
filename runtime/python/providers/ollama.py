"""Ollama Provider - /api/chat + Phase0 event contract."""
from __future__ import annotations
from typing import Any, AsyncIterator
import json
import httpx
from . import ModelProvider, default_http_timeout, resolve_messages, usage_event
from python.core.config import settings
class OllamaProvider(ModelProvider):
    SUPPORTED = frozenset({"messages", "model", "temperature", "top_p", "seed", "max_tokens", "response_schema"})
    def __init__(self, base_url: str | None = None, *, transport: Any | None = None, timeout: httpx.Timeout | None = None, **_ignored: Any) -> None:
        self.base_url = (base_url or settings.ollama_url).rstrip("/")
        self._transport = transport
        self._timeout = timeout or default_http_timeout()
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
            if k in self.SUPPORTED:
                applied[k] = v
            else:
                unsupported.append(k)
        return {"requested": req, "applied": applied, "unsupported": unsupported}
    async def stream_events(self, prompt: str = "", **kwargs: Any) -> AsyncIterator[dict]:
        messages = resolve_messages(prompt, kwargs.get("messages"))
        requested = {k: v for k, v in kwargs.items() if k != "messages" and v is not None}
        cfg = self.generation_config(requested)
        applied = cfg["applied"]
        model = applied.get("model")
        if not model or not isinstance(model, str):
            raise ValueError("ollama: explicit model is required")
        payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
        options: dict[str, Any] = {}
        if "temperature" in applied:
            options["temperature"] = applied["temperature"]
        if "top_p" in applied:
            options["top_p"] = applied["top_p"]
        if "seed" in applied:
            options["seed"] = applied["seed"]
        if "max_tokens" in applied:
            options["num_predict"] = applied["max_tokens"]
        if options:
            payload["options"] = options
        if "response_schema" in applied:
            payload["format"] = applied["response_schema"]
        async with self._client() as client:
            async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as r:
                r.raise_for_status()
                seen_done = False
                prompt_tokens: Any = None
                completion_tokens: Any = None
                async for line in r.aiter_lines():
                    if not line or not line.strip():
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError as e:
                        raise RuntimeError(f"ollama: malformed JSON line: {line[:300]!r}") from e
                    if not isinstance(obj, dict):
                        raise RuntimeError(f"ollama: malformed chunk (not object): {line[:300]!r}")
                    yield {"type": "chunk"}
                    msg = obj.get("message")
                    if isinstance(msg, dict):
                        c = msg.get("content")
                        if c is None:
                            pass
                        elif isinstance(c, str):
                            if c:
                                yield {"type": "delta", "text": c}
                        else:
                            raise RuntimeError(f"ollama: malformed message.content: {line[:300]!r}")
                    done = obj.get("done")
                    if done is True:
                        seen_done = True
                        prompt_tokens = obj.get("prompt_eval_count")
                        completion_tokens = obj.get("eval_count")
                        break
                    elif done is False:
                        if msg is None and obj.get("thinking") is None:
                            raise RuntimeError(f"ollama: malformed chunk missing message: {line[:300]!r}")
                        continue
                    else:
                        raise RuntimeError(f"ollama: malformed chunk missing done flag: {line[:300]!r}")
                if not seen_done:
                    raise RuntimeError("ollama: truncated stream (missing done:true)")
                yield usage_event(prompt_tokens, completion_tokens, None)
    async def connect(self) -> bool:
        try:
            async with self._client() as c:
                r = await c.get(f"{self.base_url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False
    async def list_models(self) -> list[dict]:
        async with self._client() as c:
            r = await c.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
            data = r.json()
            return [{"id": m["name"], "name": m["name"]} for m in data.get("models", [])]
    async def get_model_metadata(self, model_id: str) -> dict:
        async with self._client() as c:
            r = await c.post(f"{self.base_url}/api/show", json={"name": model_id})
            if r.status_code != 200:
                return {"id": model_id}
            return r.json()
    async def health_check(self) -> dict:
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "ollama", "base_url": self.base_url}
    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
