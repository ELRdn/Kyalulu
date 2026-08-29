"""Ollama Provider - /api/chat を利用"""

import httpx
from typing import AsyncIterator
import json

from . import ModelProvider
from python.core.config import settings


class OllamaProvider(ModelProvider):
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.ollama_url).rstrip("/")

    async def connect(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base_url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self.base_url}/api/tags")
            r.raise_for_status()
            data = r.json()
            return [{"id": m["name"], "name": m["name"]} for m in data.get("models", [])]

    async def get_model_metadata(self, model_id: str) -> dict:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.post(f"{self.base_url}/api/show", json={"name": model_id})
            if r.status_code != 200:
                return {"id": model_id}
            return r.json()

    async def generate(self, prompt: str, **kwargs) -> str:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model", "qwen2:7b")
        # Ollama の /api/chat (non-stream)
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{self.base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            r.raise_for_status()
            data = r.json()
            return data.get("message", {}).get("content", "") or data.get("response", "")

    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model", "qwen2:7b")
        async with httpx.AsyncClient(timeout=60) as c:
            async with c.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={"model": model, "messages": messages, "stream": True},
            ) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    # Ollama stream: {message:{content:"..."}}
                    content = obj.get("message", {}).get("content")
                    if content:
                        yield content
                    if obj.get("done"):
                        break

    async def health_check(self) -> dict:
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "ollama", "base_url": self.base_url}

    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
