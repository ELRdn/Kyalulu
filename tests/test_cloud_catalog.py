"""Server plots survive restart and remain private without paid inference."""

from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.config import CloudConfig
from python.core.portable_schema import PortableDocument
from python.core.prompt_compiler import compile_prompt
from python.storage import db as storage, library
from python.storage.context import CloudStorageContext, storage_context


@pytest.mark.asyncio
async def test_cloud_catalog_serves_bundled_and_persisted_account_plots(tmp_path):
    config = CloudConfig(root=tmp_path, origin="https://cloud.test", secret="s" * 32)
    transport = httpx.MockTransport(lambda _: pytest.fail("catalog must not call a provider"))
    app = create_app(config, transport=transport)
    owners = [str(uuid4()), str(uuid4())]
    for index, owner in enumerate(owners):
        app.state.store.account(owner, consent=provider_consent_version(config))
        app.state.auth.save(f"session-{index}", owner, {
            "access_token": "fixture", "refresh_token": "fixture", "expires_in": 3600,
        })
    with storage_context(CloudStorageContext.for_owner(config.root / "tenants", owners[0])):
        await storage.init_db()
        saved = library.save_item(PortableDocument(name="Private cafe plot", data={
            "description": "Meet at the cafe", "personality": "Friendly host",
            "first_mes": "Welcome to my cafe!",
        }))
        assert "Friendly host" in compile_prompt(character_id=saved.id).system_prompt

    # Recreate the app: the catalog comes from deployment files and the tenant DB.
    app = create_app(config, transport=transport)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=config.origin) as client:
        assert (await client.get("/api/characters")).status_code == 401
        for index in (0, 1):
            client.cookies.set(SESSION_COOKIE, f"session-{index}")
            response = await client.get("/api/characters?include_nsfw=false")
            assert response.status_code == 200
            characters = response.json()["characters"]
            mocha = next(c for c in characters if c["id"] == "mocha_sfw")
            assert mocha["intro"] and mocha["personality"] and mocha["speaking_style"]
            assert all(not c.get("nsfw") for c in characters)
            assert (saved.id in {c["id"] for c in characters}) == (index == 0)
            if index == 0:
                plot = next(c for c in characters if c["id"] == saved.id)
                assert plot["intro"] == "Welcome to my cafe!"
            denied = await client.get("/api/characters?include_nsfw=true")
            assert denied.status_code == 403 and denied.json()["error"] == "cloud_sfw_only"
        with app.state.store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_plot_saved_via_cloud_api_survives_restart_and_rejects_stale_revision(tmp_path):
    config = CloudConfig(root=tmp_path / "cloud", backup_root=tmp_path / "offsite",
                         origin="https://cloud.test", secret="s" * 32,
                         inference_enabled=True, operator_backend="deepseek", deepseek_key="fixture")
    screening = httpx.MockTransport(lambda _: httpx.Response(200, json={
        "choices": [{"message": {"content": '{"sfw":true}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 5},
    }))
    app = create_app(config, transport=screening)
    owner = str(uuid4())
    app.state.store.account(owner, consent=provider_consent_version(config))
    app.state.store.trial(owner)
    app.state.auth.save("plot-session", owner, {
        "access_token": "fixture", "refresh_token": "fixture", "expires_in": 3600,
    })
    document = PortableDocument(name="Cloud plot", data={
        "description": "A quiet cafe", "personality": "Friendly",
        "scenario": "Meet by the window", "first_mes": "Welcome!",
        "extensions": {"preserved": [1, 2]},
    }).model_dump(mode="json")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=config.origin,
                                headers={"Origin": config.origin}, cookies={SESSION_COOKIE: "plot-session"}) as client:
        created = await client.post("/api/library", json=document)
        assert created.status_code == 200, created.text
        item = created.json()
        document["data"]["first_mes"] = "Welcome back!"
        body = {"document": document, "expected_revision": item["revision"]}
        updated = await client.put(f"/api/library/{item['id']}", json=body)
        assert updated.status_code == 200 and updated.json()["revision"] == 2
        assert (await client.put(f"/api/library/{item['id']}", json=body)).status_code == 409
    restored = create_app(config, transport=screening)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restored), base_url=config.origin,
                                cookies={SESSION_COOKIE: "plot-session"}) as client:
        saved = (await client.get(f"/api/library/{item['id']}")).json()
        assert saved["revision"] == 2 and saved["document"]["data"]["first_mes"] == "Welcome back!"
        assert saved["document"]["data"]["extensions"] == {"preserved": [1, 2]}
        catalog = (await client.get("/api/characters?include_nsfw=false")).json()["characters"]
        assert next(c for c in catalog if c["id"] == item["id"])["intro"] == "Welcome back!"
    assert app.state.store.balance(owner) == 1000
