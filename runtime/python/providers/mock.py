"""Mock Provider - 外部APIなしでも動くダミー"""

import asyncio
from typing import AsyncIterator

from . import ModelProvider


class MockProvider(ModelProvider):
    """入力をオウム返し + 少し装飾するモック"""

    async def connect(self) -> bool:
        return True

    async def list_models(self) -> list[dict]:
        return [{"id": "mock-echo", "name": "Mock Echo"}]

    async def get_model_metadata(self, model_id: str) -> dict:
        return {"id": model_id, "provider": "mock"}

    async def generate(self, prompt: str, **kwargs) -> str:
        # 最後の user メッセージを抽出 (簡易)
        msg = kwargs.get("messages", [])
        last = ""
        if msg:
            last = msg[-1].get("content", "") if isinstance(msg[-1], dict) else str(msg[-1])
        else:
            last = prompt
        return f"[Mock Echo] あなたはこう言いました: 「{last}」\nこれはダミーレスポンスです。外部APIなしでもUIを試せます。"

    async def stream_generate(self, prompt: str, **kwargs) -> AsyncIterator[str]:
        text = await self.generate(prompt, **kwargs)
        # 文字ごとに少しずつ流す (SSEの動きを確認しやすく)
        for ch in text:
            yield ch
            await asyncio.sleep(0.02)

    async def health_check(self) -> dict:
        return {"status": "ok", "provider": "mock", "latency_ms": 1}

    def capabilities(self) -> dict:
        return {"streaming": True, "tools": False, "vision": False}
