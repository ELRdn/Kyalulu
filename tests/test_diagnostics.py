import httpx
import pytest

from python.api import diagnostics
from python.api.main import app
from python.storage.db import init_db

pytestmark = pytest.mark.asyncio


async def test_daemon_without_models_is_not_chat_ready(isolated, monkeypatch):
    await init_db()
    class EmptyLE:
        api_key = "test-only"
        root_url = "http://127.0.0.1:8130"
        async def call(self, method, path):
            return 200, {"health": {"status": "ok"}, "resources": {}, "models": {"models": []}}[path]
        async def le_capabilities(self):
            return {"inference": {"engine": {"available": True}, "backends": []}}
        async def served_models(self):
            return []
    async def no_direct():
        return {"health": [{"id": "mock", "status": "ok"}, {"id": "le", "status": "ok"},
                           {"id": "ollama", "status": "ok", "models": []}]}
    monkeypatch.setattr(diagnostics, "LEProvider", EmptyLE)
    monkeypatch.setattr(diagnostics, "providers_health", no_direct)
    result = await diagnostics.diagnostics()
    assert result["ready"] is False
    assert any(c["id"] == "le_models" and c["ok"] is False for c in result["checks"])
    assert any(c["id"] == "storage" and c["ok"] is True for c in result["checks"])


async def test_local_health_exposes_models_without_generation(monkeypatch):
    from python.api import providers
    class Local:
        async def health_check(self):
            return {"status": "ok", "provider": "ollama"}
        async def list_models(self):
            return [{"id": "present:9b"}]
    monkeypatch.setattr(providers, "TYPES", ("ollama",))
    monkeypatch.setattr(providers, "get_provider", lambda name: Local())
    assert (await providers.providers_health())["health"][0]["models"] == ["present:9b"]


async def test_api_rejects_browser_origin_before_mutations(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for origin in ("https://evil.example", "null", "http://localhost:9999"):
            response = await client.post("/api/creator/world", json={"display_name": "must not be created"}, headers={"Origin": origin})
            assert response.status_code == 403
            assert "access-control-allow-origin" not in response.headers
        ok = await client.get("/api/health", headers={"Origin": "http://127.0.0.1:5174"})
        assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "http://127.0.0.1:5174"
        assert (await client.get("/api/creator/world")).json()["items"] == []
