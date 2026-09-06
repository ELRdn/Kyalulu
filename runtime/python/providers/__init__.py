"""Provider event and usage contract."""
from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator
import httpx
KNOWN_GENERATION_KEYS = frozenset({"messages", "model", "temperature", "top_p", "seed", "max_tokens", "reasoning", "response_schema"})
def default_http_timeout() -> httpx.Timeout:
    return httpx.Timeout(120.0, connect=10.0)
def resolve_messages(prompt: str = "", messages: Any = None) -> list[dict]:
    if messages is not None:
        if not isinstance(messages, list):
            raise ValueError("messages must be a list of {role, content}")
        out: list[dict] = []
        for m in messages:
            if not isinstance(m, dict):
                raise ValueError("each message must be a dict with role/content")
            role = m.get("role", "user")
            cnt = m.get("content", "")
            if not isinstance(role, str) or not role:
                raise ValueError("message role must be a non-empty string")
            if cnt is None:
                cnt = ""
            if not isinstance(cnt, str):
                cnt = str(cnt)
            out.append({"role": role, "content": cnt})
        return out
    return [{"role": "user", "content": prompt or ""}]
def last_user_text(prompt: str = "", messages: Any = None) -> str:
    if isinstance(messages, list):
        for m in reversed(messages):
            if isinstance(m, dict) and m.get("role") == "user":
                c = m.get("content", "")
                if c is None:
                    return ""
                return c if isinstance(c, str) else str(c)
    if prompt:
        return prompt if isinstance(prompt, str) else str(prompt)
    return ""
def as_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None
def usage_event(prompt_tokens: Any = None, completion_tokens: Any = None, thinking_tokens: Any = None) -> dict:
    return {"type": "usage", "usage": {"prompt_tokens": as_int_or_none(prompt_tokens), "completion_tokens": as_int_or_none(completion_tokens), "thinking_tokens": as_int_or_none(thinking_tokens)}}
class ModelProvider(ABC):
    @abstractmethod
    async def connect(self) -> bool:
        ...
    @abstractmethod
    async def list_models(self) -> list[dict]:
        ...
    @abstractmethod
    async def get_model_metadata(self, model_id: str) -> dict:
        ...
    @abstractmethod
    def generation_config(self, requested: dict) -> dict:
        ...
    @abstractmethod
    async def stream_events(self, prompt: str = "", **kwargs: Any) -> AsyncIterator[dict]:
        if False:
            yield {}
        ...
    async def generate(self, prompt: str = "", **kwargs: Any) -> str:
        parts: list[str] = []
        async for ev in self.stream_events(prompt, **kwargs):
            if isinstance(ev, dict) and ev.get("type") == "delta":
                t = ev.get("text", "")
                if isinstance(t, str) and t:
                    parts.append(t)
        return "".join(parts)
    async def stream_generate(self, prompt: str = "", **kwargs: Any) -> AsyncIterator[str]:
        async for ev in self.stream_events(prompt, **kwargs):
            if isinstance(ev, dict) and ev.get("type") == "delta":
                t = ev.get("text", "")
                if isinstance(t, str) and t:
                    yield t
    @abstractmethod
    async def health_check(self) -> dict:
        ...
    @abstractmethod
    def capabilities(self) -> dict:
        ...
