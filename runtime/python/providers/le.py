"""LE (Kyalulu Local Engine) provider.

Kyalulu owns character truth; LE owns execution. Chat goes through LE's
OpenAI-compatible /v1 surface with stable ids such as ``ollama/qwen3:8b``.
System calls (/le/v1/*) are exposed for health and capability discovery only.
"""
import httpx
from .openai_compat import OpenAICompatibleProvider
from python.core.config import settings, resolve_le_token


class LEProvider(OpenAICompatibleProvider):
    def __init__(self, base_url=None, api_key=None, **kwargs):
        root = (base_url or settings.le_api_url).rstrip("/")
        if root.endswith("/v1"):
            root = root[:-3]
        super().__init__(base_url=f"{root}/v1", api_key=api_key or resolve_le_token(), **kwargs)
        self.root_url = root

    async def _system(self, path: str) -> dict:
        async with self._client() as c:
            r = await c.get(f"{self.root_url}/le/v1/{path}")
            r.raise_for_status()
            return r.json()

    async def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
        """(status, json) for a /le/v1 call; LE errors come back as data, not exceptions."""
        async with self._client() as c:
            r = await c.request(method, f"{self.root_url}/le/v1/{path}", json=body)
        try:
            data = r.json()
        except ValueError:
            data = {}
        return r.status_code, data if isinstance(data, dict) else {}

    async def le_version(self) -> dict:
        return await self._system("version")

    async def le_capabilities(self) -> dict:
        return await self._system("capabilities")

    async def served_models(self) -> list[str]:
        """Model ids LE can route right now (backends + loaded le/ model)."""
        async with self._client() as c:
            r = await c.get(f"{self.base_url}/models")
            r.raise_for_status()
            return [m["id"] for m in r.json().get("data", []) if isinstance(m, dict) and m.get("id")]

    async def connect(self) -> bool:
        try:
            return (await self._system("health")).get("status") == "ok"
        except (httpx.HTTPError, ValueError):
            return False

    async def health_check(self):
        if not self.api_key:
            return {"status": "offline", "provider": "le", "base_url": self.root_url, "error": "LE token not found"}
        try:
            data = await self._system("health")
        except httpx.HTTPStatusError as e:
            status = "unauthorized" if e.response.status_code == 401 else "offline"
            return {"status": status, "provider": "le", "base_url": self.root_url}
        except (httpx.HTTPError, ValueError):
            return {"status": "offline", "provider": "le", "base_url": self.root_url}
        return {"status": "ok" if data.get("status") == "ok" else "offline", "provider": "le", "base_url": self.root_url}
