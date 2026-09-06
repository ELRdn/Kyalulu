"""OpenAI chat-completions compatible transport with explicit capabilities."""
import httpx
from .lmstudio import LMStudioProvider
from python.core.config import settings


class OpenAICompatibleProvider(LMStudioProvider):
    def __init__(self, base_url=None, api_key=None, **kwargs):
        super().__init__(base_url=base_url or settings.openai_compatible_url, **kwargs)
        self.base_url = (base_url or settings.openai_compatible_url or "").rstrip("/")
        self.api_key = api_key or settings.openai_compatible_api_key

    def _client(self):
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        return httpx.AsyncClient(timeout=self._timeout, transport=self._transport, headers=headers)

    async def health_check(self):
        return {"status": "ok" if await self.connect() else "offline", "provider": "openai_compatible"}
