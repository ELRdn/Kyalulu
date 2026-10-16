"""Anonymous read-only browsing, with no provider calls or anonymous accounts."""
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.community import Community
from python.core.portable_schema import PortableDocument
from python.storage import db as storage, library
from python.storage.context import CloudStorageContext, storage_context
from test_cloud_cost_accounting import config

pytestmark = pytest.mark.asyncio


def hosted(tmp_path, *, community=False):
    cfg = replace(config(tmp_path), private_test=not community,
                  community_enabled=community, legal_approved=community)

    def no_network(request):
        pytest.fail("Guest access tests must not call any external API")

    return create_app(cfg, transport=httpx.MockTransport(no_network))


def client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://cloud.test")


async def test_guest_catalog_is_sfw_and_never_opens_private_storage(isolated, monkeypatch):
    from python.core import prompt_compiler
    app = hosted(isolated)
    chars, worlds = isolated / "chars", isolated / "worlds"
    chars.mkdir(); worlds.mkdir()
    (chars / "public.yaml").write_text("id: public\ndisplay_name: Public\nnsfw: false\nintro: Public introduction\n", encoding="utf-8")
    (chars / "adult.yaml").write_text("id: adult\ndisplay_name: Adult\nnsfw: true\n", encoding="utf-8")
    (worlds / "public.yaml").write_text("id: public-world\ndisplay_name: Public world\n", encoding="utf-8")
    monkeypatch.setattr(prompt_compiler, "CHAR_DIR", chars)
    monkeypatch.setattr(prompt_compiler, "WORLD_DIR", worlds)

    async def no_private_db():
        pytest.fail("Anonymous catalog must not initialize a runtime DB")

    monkeypatch.setattr(storage, "init_db", no_private_db)
    async with client(app) as c:
        for cookie in (None, "expired-browser"):
            if cookie:
                c.cookies.set(SESSION_COOKIE, cookie)
            status = await c.get("/api/mobile/status")
            assert status.status_code == 200 and status.json()["authenticated"] is False
            assert status.json()["owner_scope"] is None
            capabilities = await c.get("/api/capabilities")
            assert capabilities.status_code == 200
            response = await c.get("/api/characters")
            assert response.status_code == 200
            assert [v["id"] for v in response.json()["characters"]] == ["public"]
            assert response.json()["characters"][0]["intro"] == "Public introduction"
            assert response.headers["cache-control"] == "no-store"
            assert "set-cookie" not in response.headers
            assert (await c.get("/api/characters?include_nsfw=true")).status_code == 403
            assert (await c.get("/api/worlds")).json()["worlds"][0]["id"] == "public-world"
    assert not (app.state.store.config.root / "tenants").exists()
    with app.state.store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 0


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/chat"), ("POST", "/api/cloud/quotes"),
    ("POST", "/api/chat/stream"), ("GET", "/api/chat/sessions"),
    ("GET", "/api/chat/generations/private"), ("POST", "/api/chat/generations/private/cancel"),
    ("GET", "/api/chat/history?session_id=private"), ("GET", "/api/chat/context/private"),
    ("PUT", "/api/chat/settings"), ("GET", "/api/library"),
    ("GET", "/api/library/private"), ("GET", "/api/library/assets/private"),
    ("GET", "/api/models"), ("GET", "/api/personas"),
    ("POST", "/api/prompt/compile"), ("POST", "/api/library"),
    ("POST", "/api/community/works"), ("DELETE", "/api/community/works/public"),
    ("PUT", "/api/community/works/public/reaction"),
    ("POST", "/api/community/works/public/comments"),
    ("PUT", "/api/community/authors/public/follow"),
    ("POST", "/api/community/reports"), ("GET", "/api/cloud/profile"),
    ("GET", "/api/cloud/account"), ("GET", "/api/cloud/sync"),
    ("HEAD", "/api/characters"), ("GET", "/api/community/works/public/reaction"),
])
async def test_guest_cannot_read_private_data_or_mutate(isolated, method, path):
    app = hosted(isolated, community=True)
    async with client(app) as c:
        response = await c.request(method, path, headers={"Origin": "https://cloud.test"})
        assert response.status_code == 401
        if method != "HEAD":
            assert response.json()["code"] == "authentication_required"
    assert not (app.state.store.config.root / "tenants").exists()


async def test_guest_public_snapshots_comments_and_authors_remain_read_only(isolated):
    app = hosted(isolated, community=True)
    community = Community(app.state.store.config.root / "community.db")
    work = community.publish("creator", "Public author", "private-item", 1,
                             PortableDocument(name="Public work", data={"description": "public text", "first_mes": "public scene", "tags": ["story"]}))
    community.register("reader", "Reader")
    community.comment("reader", work["id"], "public comment")
    async with client(app) as c:
        for path in ("/api/community/works", "/api/community/works?q=Public&tag=story",
                     f"/api/community/works/{work['id']}",
                     f"/api/community/works/{work['id']}/comments",
                     f"/api/community/authors/{work['author_id']}"):
            response = await c.get(path)
            assert response.status_code == 200, response.text
            assert "set-cookie" not in response.headers
            assert "private-item" not in response.text
        detail = (await c.get(f"/api/community/works/{work['id']}")).json()
        assert detail["owned"] is False and detail["reactions"] == [] and detail["following"] is False
        assert detail["document"]["data"]["first_mes"] == "public scene"
        assert (await c.get(f"/api/community/works/{work['id']}/comments")).json()["comments"][0]["text"] == "public comment"
        assert (await c.get("/api/community/works/missing")).status_code == 404
    assert not (app.state.store.config.root / "tenants").exists()
    with community.db() as db:
        assert db.execute("SELECT COUNT(*) FROM authors WHERE owner=''").fetchone()[0] == 0
    with app.state.store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


async def test_guest_read_does_not_enable_unaccepted_community(isolated):
    app = hosted(isolated)
    async with client(app) as c:
        response = await c.get("/api/community/works")
        assert response.status_code == 503
        assert response.json()["code"] == "community_awaiting_acceptance"


async def test_authenticated_catalog_retains_private_library_and_visibility(isolated):
    app = hosted(isolated, community=True)
    owner = str(uuid4())
    app.state.store.account(owner, consent=provider_consent_version(app.state.store.config))
    app.state.auth.save("browser", owner, {"access_token": "fixture", "refresh_token": "fixture", "expires_in": 3600})
    context = CloudStorageContext.for_owner(app.state.store.config.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        item = library.save_item(PortableDocument(name="Private character", data={"description": "private secret"}))
    community = Community(app.state.store.config.root / "community.db")
    work = community.publish("creator", "Creator", "item", 1, PortableDocument(name="Blocked work"))
    community.relation(owner, work["author_id"], True, block=True)
    async with client(app) as c:
        c.cookies.set(SESSION_COOKIE, "browser")
        catalog = await c.get("/api/characters")
        assert catalog.status_code == 200 and item.id in {v["id"] for v in catalog.json()["characters"]}
        assert (await c.get("/api/chat/sessions")).status_code == 200
        assert (await c.get("/api/community/works")).json()["works"] == []
        assert (await c.get(f"/api/community/works/{work['id']}")).status_code == 404
        c.cookies.clear()
        guest = await c.get("/api/characters")
        assert item.id not in {v["id"] for v in guest.json()["characters"]}
        assert "private secret" not in guest.text
        assert len((await c.get("/api/community/works")).json()["works"]) == 1
