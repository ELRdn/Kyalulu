"""LM Studio Provider - OpenAI互換 /v1/chat/completions を利用"""

import httpx
from typing import AsyncIterator
import json

from . import ModelProvider
from python.core.config import settings


class LMStudioProvider(ModelProvider):
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or settings.lm_studio_url).rstrip("/")

    async def connect(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base_url}/models")
                return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{self.base_url}/models")
            r.raise_for_status()
            data = r.json()
            return [{"id": m["id"], "name": m["id"]} for m in data.get("data", [])]

    async def get_model_metadata(self, model_id: str) -> dict:
        # LM Studio は個別metadata APIがないため簡易
        return {"id": model_id, "provider": "lm_studio"}

    async def generate(self, prompt: str, **kwargs) -> str:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model", "")
        # model未指定なら一覧から先頭を使う
        if not model:
            try:
                models = await self.list_models()
                if models:
                    model = models[0]["id"]
            except Exception:
                pass
        async with httpx.AsyncClient(timeout=60) as c:
            payload: dict = {"messages": messages, "stream": False, "temperature": kwargs.get("temperature", 0.8)}
            if model:
                payload["model"] = model
            r = await c.post(f"{self.base_url}/chat/completions", json=payload)
            r.raise_for_status()
            data = r.json()
            return data["choices"][0]["message"]["content"]

    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        messages = kwargs.get("messages", [{"role": "user", "content": prompt}])
        model = kwargs.get("model", "")
        if not model:
            try:
                models = await self.list_models()
                if models:
                    model = models[0]["id"]
            except Exception:
                pass
        async with httpx.AsyncClient(timeout=60) as c:
            payload: dict = {"messages": messages, "stream": True, "temperature": kwargs.get("temperature", 0.8)}
            if model:
                payload["model"] = model
            async with c.stream("POST", f"{self.base_url}/chat/completions", json=payload) as r:
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
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "lm_studio", "base_url": self.base_url}

    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
