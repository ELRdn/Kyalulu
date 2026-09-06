"""Portable library API integration tests (HTTP level, no network, no subprocess)."""
import hashlib
import json

import httpx
import pytest

from python.api.main import app

pytestmark = pytest.mark.asyncio


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def cc_json_bytes(**overrides):
    card = {"spec": "chara_card_v2", "spec_version": "2.0", "data": {
        "name": "シアン", "description": "日本語で話す案内人",
        "personality": "親しみやすい", "scenario": "港町",
        "first_mes": "こんにちは", "mes_example": "{{user}}: hi {{char}}: やあ",
        "creator_notes": "CREATOR_ONLY", "tags": ["案内"],
        "character_book": {"entries": [{"keys": ["鍵"], "content": "鍵は青い。", "enabled": True}]},
    }}
    card["data"].update(overrides)
    return json.dumps(card, ensure_ascii=False).encode("utf-8")


async def preview_commit(cli, raw, filename, request_id, history_indices=None, document=None):
    files = {"file": (filename, raw, "application/octet-stream")}
    preview = await cli.post("/api/imports/preview", files=files)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    doc = document if document is not None else body["documents"][0]
    commit = await cli.post("/api/imports/" + body["preview_id"] + "/commit", json={
        "request_id": request_id,
        "selections": [{"index": 0, "document": doc,
                        "history_indices": history_indices or []}]})
    assert commit.status_code == 200, commit.text
    return body, commit.json()


async def test_preview_then_commit_cc_json(isolated):
    async with client() as cli:
        _prev, result = await preview_commit(cli, cc_json_bytes(), "card.json", "req-cc-1")
        item = result["items"][0]
        assert item["id"].startswith("lib_") and item["revision"] == 1
        assert result["sessions"] == []
        got = await cli.get("/api/library/" + item["id"])
        assert got.status_code == 200
        assert got.json()["document"]["name"] == "シアン"
        assert got.json()["document"]["data"]["description"] == "日本語で話す案内人"


async def test_commit_idempotent_retry_and_changed_body_conflict(isolated):
    async with client() as cli:
        prev, first = await preview_commit(cli, cc_json_bytes(), "card.json", "req-idem")
        same = await cli.post("/api/imports/" + prev["preview_id"] + "/commit", json={
            "request_id": "req-idem",
            "selections": [{"index": 0, "document": prev["documents"][0], "history_indices": []}]})
        assert same.status_code == 200 and same.json() == first
        changed_doc = dict(prev["documents"][0], name="改名後")
        clash = await cli.post("/api/imports/" + prev["preview_id"] + "/commit", json={
            "request_id": "req-idem",
            "selections": [{"index": 0, "document": changed_doc, "history_indices": []}]})
        assert clash.status_code == 409


async def test_edit_revision_conflict_and_pinned_session_keeps_revision(isolated):
    async with client() as cli:
        _prev, result = await preview_commit(cli, cc_json_bytes(), "card.json", "req-edit")
        item_id = result["items"][0]["id"]
        doc = result["items"][0]["document"]
        bound = await cli.put("/api/chat/settings", json={"session_id": "pin1", "character_id": item_id})
        assert bound.status_code == 200, bound.text
        assert bound.json()["library_binding"]["character"] == {"id": item_id, "revision": 1}
        edited = dict(doc, data={**doc["data"], "description": "新しい説明"})
        ok = await cli.put("/api/library/" + item_id, json={"expected_revision": 1, "document": edited})
        assert ok.status_code == 200 and ok.json()["revision"] == 2
        stale = await cli.put("/api/library/" + item_id, json={"expected_revision": 1, "document": edited})
        assert stale.status_code == 409
        settings = await cli.get("/api/chat/settings", params={"session_id": "pin1"})
        assert settings.json()["library_binding"]["character"] == {"id": item_id, "revision": 1}
        debug = await cli.get("/api/chat/debug", params={"session_id": "pin1"})
        assert debug.status_code == 200, debug.text
        snap = debug.json()["compiled"]["sections"]["portable_snapshot"]["document"]
        assert snap["data"]["description"] == "日本語で話す案内人"


async def test_export_preview_notices_and_download_roundtrip(isolated):
    async with client() as cli:
        _prev, result = await preview_commit(cli, cc_json_bytes(), "card.json", "req-exp")
        item_id = result["items"][0]["id"]
        meta = await cli.get("/api/library/" + item_id + "/export", params={"format": "ccv3-json"})
        assert meta.status_code == 200
        assert meta.json()["media_type"] == "application/json" and meta.json()["bytes"] > 0
        assert isinstance(meta.json()["notices"], list)
        dl = await cli.get("/api/library/" + item_id + "/export",
                           params={"format": "ccv3-json", "download": "true"})
        assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
        payload = json.loads(dl.content.decode("utf-8"))
        assert payload["data"]["name"] == "シアン"
        assert len(dl.content) == meta.json()["bytes"]


async def test_original_bytes_preserved(isolated):
    raw = cc_json_bytes()
    async with client() as cli:
        _prev, result = await preview_commit(cli, raw, "card.json", "req-orig")
        item_id = result["items"][0]["id"]
        dl = await cli.get("/api/library/" + item_id + "/export",
                           params={"format": "original", "download": "true"})
        assert dl.status_code == 200 and dl.content == raw


async def test_standalone_profile_and_lorebook_binding_in_chat_and_debug(isolated):
    profile = {"kind": "profile", "name": "丁寧プロファイル",
               "profile": {"system_prompt": "常に丁寧語で応答する", "settings": {"temperature": 0.3}}}
    lore = {"kind": "lorebook", "name": "港町世界書",
            "data": {"character_book": {"entries": [
                {"keys": ["港町"], "content": "港町は霧に包まれている。", "enabled": True}]}}}
    async with client() as cli:
        p = await cli.post("/api/library", json=profile)
        w = await cli.post("/api/library", json=lore)
        assert p.status_code == 200 and w.status_code == 200, (p.text, w.text)
        pid, wid = p.json()["id"], w.json()["id"]
        bound = await cli.put("/api/chat/settings", json={
            "session_id": "bind1",
            "library_binding": {"profile": {"id": pid, "revision": 1},
                                "lorebooks": [{"id": wid, "revision": 1}]}})
        assert bound.status_code == 200, bound.text
        debug = await cli.get("/api/chat/debug", params={"session_id": "bind1"})
        assert debug.status_code == 200, debug.text
        compiled = debug.json()["compiled"]
        assert "常に丁寧語で応答する" in compiled["system_prompt"]
        snap = compiled["sections"]["portable_snapshot"]
        assert snap["document"]["profile"]["system_prompt"] == "常に丁寧語で応答する"
        assert snap["lorebooks"][0]["entries"][0]["content"] == "港町は霧に包まれている。"
        assert snap["document"]["profile"]["settings"]["temperature"] == 0.3
        chat = await cli.post("/api/chat", json={
            "model_id": "mock-echo", "session_id": "bind1",
            "messages": [{"role": "user", "content": "港町について教えて"}]})
        assert chat.status_code == 200, chat.text
        assert chat.json()["reply"].startswith("Mock: ")


async def test_asset_upload_rejects_malformed_image(isolated):
    from python.core.portable_binary import neutral_png
    async with client() as cli:
        bad = await cli.post("/api/library/assets",
                             files={"file": ("evil.txt", b"not an image at all", "text/plain")})
        assert bad.status_code == 400
        raw = neutral_png()
        good = await cli.post("/api/library/assets",
                              files={"file": ("icon.png", raw, "image/png")})
        assert good.status_code == 200, good.text
        assert good.json()["asset_id"] == hashlib.sha256(raw).hexdigest()
        blob = await cli.get("/api/library/assets/" + good.json()["asset_id"])
        assert blob.status_code == 200 and blob.content == raw


async def test_only_selected_histories_committed(isolated):
    from python.storage import library as storage
    from python.core.portable_schema import PortableDocument, PortableHistory
    from python.storage.db import init_db
    await init_db()
    doc = PortableDocument(name="履歴持ち", data={"first_mes": "どうも"}, histories=[
        PortableHistory(name="古い会話", messages=[
            {"role": "user", "content": "昔の質問"}, {"role": "assistant", "content": "昔の回答"}]),
        PortableHistory(name="新しい会話", messages=[
            {"role": "user", "content": "今の質問"}, {"role": "assistant", "content": "今の回答"}]),
    ])
    preview = storage.preview("seed.json", b"seed", [doc], {})
    async with client() as cli:
        commit = await cli.post("/api/imports/" + preview["preview_id"] + "/commit", json={
            "request_id": "req-hist",
            "selections": [{"index": 0, "document": preview["documents"][0], "history_indices": [1]}]})
        assert commit.status_code == 200, commit.text
        sessions = commit.json()["sessions"]
        assert len(sessions) == 1 and sessions[0]["name"] == "新しい会話"
        with storage.connect() as con:
            rows = con.execute("SELECT role, content FROM chat_history WHERE session_id=? ORDER BY id",
                               (sessions[0]["session_id"],)).fetchall()
        assert [(r[0], r[1]) for r in rows] == [("user", "今の質問"), ("assistant", "今の回答")]


async def test_catalog_official_never_true_and_nsfw_filtered(isolated):
    async with client() as cli:
        _p, normal = await preview_commit(cli, cc_json_bytes(), "card.json", "req-cat")
        item_id = normal["items"][0]["id"]
        doc = (await cli.get("/api/library/" + item_id)).json()["document"]
        doc["data"] = {**doc["data"], "official": True}
        spoof = await cli.put("/api/library/" + item_id,
                              json={"expected_revision": 1, "document": doc})
        assert spoof.status_code == 200
        assert spoof.json()["document"]["data"].get("official") is None
        _p2, nsfw_res = await preview_commit(cli, cc_json_bytes(), "nsfw.json", "req-nsfw")
        nsfw_id = nsfw_res["items"][0]["id"]
        nsfw_doc = (await cli.get("/api/library/" + nsfw_id)).json()["document"]
        nsfw_doc["nsfw"] = True
        edited = await cli.put("/api/library/" + nsfw_id,
                               json={"expected_revision": 1, "document": nsfw_doc})
        assert edited.status_code == 200
        default = await cli.get("/api/characters")
        assert default.status_code == 200
        lib_chars = [c for c in default.json()["characters"] if str(c.get("id", "")).startswith("lib_")]
        assert lib_chars, "imported library characters must be listed"
        assert all(c.get("official") is False for c in lib_chars)
        assert all(not c.get("nsfw") for c in default.json()["characters"])
        open_ = await cli.get("/api/characters", params={"include_nsfw": "true"})
        assert any(c.get("nsfw") for c in open_.json()["characters"])


async def test_invalid_history_selection_rolls_back(isolated):
    async with client() as cli:
        files = {"file": ("card.json", cc_json_bytes(), "application/octet-stream")}
        preview = await cli.post("/api/imports/preview", files=files)
        pid, doc = preview.json()["preview_id"], preview.json()["documents"][0]
        bad = await cli.post("/api/imports/" + pid + "/commit", json={
            "request_id": "req-bad-sel",
            "selections": [{"index": 0, "document": doc, "history_indices": [99]}]})
        assert bad.status_code in (400, 409)
        listing = await cli.get("/api/library")
        assert listing.json() == {"items": []}


async def test_script_payload_is_data_never_executed(isolated, tmp_path):
    from python.core.portable_schema import PortableDocument
    payload = {"spec": "chara_card_v2", "spec_version": "2.0",
               "data": {"name": "Scripty", "description": "d",
                        "extensions": {"risuai": {"scripts": [
                            "import os; os.system('pwned')",
                            "<script>fetch('https://evil.example')</script>"]}}}}
    raw = json.dumps(payload).encode("utf-8")
    async with client() as cli:
        _prev, result = await preview_commit(cli, raw, "risu.json", "req-noexec")
        stored = (await cli.get("/api/library/" + result["items"][0]["id"])).json()["document"]
        assert stored["data"]["extensions"]["risuai"]["scripts"][0] == "import os; os.system('pwned')"
        code = await cli.post("/api/imports/text/preview", json={
            "filename": "evil.py", "text": "import os; os.system('pwned')" + chr(10)})
        assert code.status_code == 400
    leftovers = [p for p in tmp_path.rglob("*") if p.suffix in {".py", ".sh", ".bat", ".exe"}
                 and "__pycache__" not in p.parts]
    assert leftovers == []
    assert PortableDocument.model_validate(stored).name == "Scripty"
