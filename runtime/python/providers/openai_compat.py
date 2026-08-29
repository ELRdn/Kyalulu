"""OpenAI互換 Provider - 外部API試運転用"""

import httpx
from typing import AsyncIterator
import json

from . import ModelProvider
from python.core.config import settings


class OpenAICompatibleProvider(ModelProvider):
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or settings.openai_compatible_url or "").rstrip("/")
        self.api_key = api_key or settings.openai_compatible_api_key or ""

    def _headers(self) -> dict:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def connect(self) -> bool:
        if not self.base_url:
            return False
        try:
            async with httpx.AsyncClient(timeout=5, headers=self._headers()) as c:
                r = await c.get(f"{self.base_url}/models")
                return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        if not self.base_url:
            return []
        async with httpx.AsyncClient(timeout=10, headers=self._headers()) as c:
            r = await c.get(f"{self.base_url}/models")
            r.raise_for_status()
            data = r.json()
            return [{"id": m["id"], "name": m["id"]} for m in data.get("data", [])]

    async def get_model_metadata(self, model_id: str) -> dict:
        return {"id": model_id, "provider": "openai_compatible", "base_url": self.base_url}

    async def generate(self, prompt: str, **kwargs) -> str:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model") or kwargs.get("provider_model_id") or "gpt-4o-mini"
        async with httpx.AsyncClient(timeout=60, headers=self._headers()) as c:
            r = await c.post(
                f"{self.base_url}/chat/completions",
                json={"model": model, "messages": messages, "stream": False, "temperature": kwargs.get("temperature", 0.8)},
            )
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]

    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model") or kwargs.get("provider_model_id") or "gpt-4o-mini"
        async with httpx.AsyncClient(timeout=60, headers=self._headers()) as c:
            async with c.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                json={"model": model, "messages": messages, "stream": True, "temperature": kwargs.get("temperature", 0.8)},
            ) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        obj = json.loads(data_str)
                        delta = obj["choices"][0].get("delta", {}).get("content")
                        if delta:
                            yield delta
                    except Exception:
                        continue

    async def health_check(self) -> dict:
        if not self.base_url:
            return {"status": "not_configured", "provider": "openai_compatible"}
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "openai_compatible", "base_url": self.base_url}

    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
