"""Responses API Provider - opencode go muse-spark 等用 (/v1/responses)"""

import httpx
import json
from typing import AsyncIterator

from . import ModelProvider
from python.core.config import settings


def _messages_to_input(messages: list[dict] | None, prompt: str) -> str:
    """messages を Responses API の input に変換（簡易）"""
    if messages:
        # 最後のユーザーメッセージを優先、なければ全てを連結
        # Responses API は input に文字列かメッセージ配列を取れるが、簡易で文字列化
        parts = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "user":
                parts.append(content)
            elif role == "assistant":
                parts.append(f"Assistant: {content}")
            elif role == "system":
                parts.append(f"System: {content}")
        return "\n".join(parts) if parts else prompt
    return prompt


class ResponsesProvider(ModelProvider):
    """OpenAI Responses API (/v1/responses) 用"""

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        # base_url は https://opencode.ai/zen/go/v1 を想定。末尾の /responses は含めない
        raw = base_url or settings.openai_compatible_url or ""
        # もしユーザーがフルエンドポイントを入れた場合でも対応
        if raw.endswith("/responses"):
            raw = raw[: -len("/responses")]
        self.base_url = raw.rstrip("/")
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
        return {"id": model_id, "provider": "responses", "base_url": self.base_url}

    async def generate(self, prompt: str, **kwargs) -> str:
        messages = kwargs.get("messages")
        model = kwargs.get("model") or kwargs.get("provider_model_id") or "muse-spark-1.2-contributor"
        inp = _messages_to_input(messages, prompt)
        async with httpx.AsyncClient(timeout=60, headers=self._headers()) as c:
            r = await c.post(
                f"{self.base_url}/responses",
                json={"model": model, "input": inp, "stream": False},
            )
            r.raise_for_status()
            data = r.json()
            # output から message の text を抽出
            for item in data.get("output", []):
                if item.get("type") == "message":
                    for part in item.get("content", []):
                        if part.get("type") == "output_text":
                            return part.get("text", "")
            return ""

    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        messages = kwargs.get("messages")
        model = kwargs.get("model") or kwargs.get("provider_model_id") or "muse-spark-1.2-contributor"
        inp = _messages_to_input(messages, prompt)
        async with httpx.AsyncClient(timeout=60, headers=self._headers()) as c:
            payload = {"model": model, "input": inp, "stream": True}
            # temperature 等は Responses API でも受け付ける場合があるが、muse-spark は固定1の模様なので無視
            async with c.stream("POST", f"{self.base_url}/responses", json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    # SSE: event: ... / data: ...
                    if line.startswith("data:"):
                        data_str = line[len("data:"):].strip()
                        if not data_str:
                            continue
                        try:
                            obj = json.loads(data_str)
                        except Exception:
                            continue
                        # Responses API のストリーミングは response.output_text.delta に delta が入る
                        if obj.get("type") == "response.output_text.delta":
                            delta = obj.get("delta")
                            if delta:
                                yield delta
                        elif obj.get("type") == "response.completed":
                            break
                    # event: 行は無視、data: 行で処理
                # end

    async def health_check(self) -> dict:
        if not self.base_url:
            return {"status": "not_configured", "provider": "responses"}
        ok = await self.connect()
        return {"status": "ok" if ok else "offline", "provider": "responses", "base_url": self.base_url}

    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
