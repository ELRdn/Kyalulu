import httpx
import pytest

from python.api.main import app
from python.core.prompt_compiler import compile_prompt

pytestmark = pytest.mark.asyncio


async def test_creator_versions_stay_pinned_and_roundtrip(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for kind, field, parameter, catalog in (("persona", "traits", "persona_id", "personas"),
                                               ("world", "rules", "world_id", "worlds")):
            doc = {"display_name": "旧版の名前", "description": "静かな場所", field: "old_revision_marker"}
            response = await client.post(f"/api/creator/{kind}", json=doc)
            assert response.status_code == 201, response.text
            old = response.json()
            saved = await client.put("/api/chat/settings", json={"session_id": "pinned", parameter: old["id"]})
            assert saved.status_code == 200, saved.text
            response = await client.put(f"/api/creator/{kind}/{old['id']}", json={**doc, field: "new_revision_marker"})
            new = response.json()
            assert response.status_code == 200 and new["revision"] == 2
            assert "old_revision_marker" in compile_prompt(**{parameter: old["id"]}).system_prompt
            assert "new_revision_marker" in compile_prompt(**{parameter: new["id"]}).system_prompt
            settings = (await client.get("/api/chat/settings", params={"session_id": "pinned"})).json()
            assert settings[parameter] == old["id"]
            conflict = await client.put(f"/api/creator/{kind}/{old['id']}", json=doc)
            assert conflict.status_code == 409
            exported = (await client.get(f"/api/creator/{kind}/{new['id']}/export")).json()
            assert exported["format"] == "kyalulu-creator"
            copy = (await client.post(f"/api/creator/{kind}", json=exported["document"])).json()
            assert copy["id"] != new["id"] and copy[field] == new[field]
            listed = (await client.get(f"/api/{catalog}")).json()[catalog]
            assert new["id"] in {x["id"] for x in listed} and old["id"] not in {x["id"] for x in listed}
            history = (await client.get(f"/api/creator/{kind}/{old['id']}")).json()["versions"]
            assert [x["revision"] for x in history] == [2, 1]


async def test_created_world_does_not_inherit_a_hardcoded_setting(isolated):
    from python.storage.db import init_db
    from python.storage import creator
    await init_db()
    world = creator.save("world", {"display_name": "雨音の図書館", "description": "現代の静かな図書館", "rules": "魔法は存在しない", "traits": ""})
    for character in (None, "librarian_sfw"):
        prompt = compile_prompt(character_id=character, world_id=world["id"]).system_prompt
        assert "雨音の図書館" in prompt and "魔法は存在しない" in prompt
        assert "獣人が多数を占める世界" not in prompt and "「」" not in prompt


async def test_invalid_creator_and_paths_rejected(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/api/creator/world", json={"display_name": "   "})).status_code == 422
        assert (await client.post("/api/creator/world", json={"display_name": "x", "rules": "x" * 6001})).status_code == 422
        assert (await client.post("/api/creator/character", json={"display_name": "x"})).status_code == 422
        assert (await client.get("/api/creator/world/created_bad@1")).status_code == 404
        assert (await client.put("/api/chat/settings", json={"session_id": "bad", "world_id": "created_bad@1"})).status_code == 400
        assert (await client.post("/api/prompt/compile", json={"persona_id": "../worlds/beast_world"})).status_code in (400, 500)
