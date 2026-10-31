"""Fixed Python logical scope IDs shared with Browser policy namespaces.

Goldens pin the real catalog versions; review identities and hashes on catalog changes.
Library character versions use the runtime's bound revision rule, without catalog mocks.
"""
import json
from pathlib import Path

import aiosqlite
import pytest

from python.storage import db, memories
from python.storage.generations import Conflict

FIXTURE = json.loads((Path(__file__).parent / "fixtures/unified-memory-scopes.json").read_text(encoding="utf-8"))
CASES = {case["name"]: case for case in FIXTURE["cases"]}


def test_fixture_contract():
    assert set(FIXTURE) == {"cases"}
    assert 4 <= len(CASES) == len(FIXTURE["cases"]) <= 6
    for case in CASES.values():
        assert set(case) == {"name", "settings", "identity", "world_scope", "shared_scope"}


@pytest.mark.asyncio
@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
async def test_memory_scope_fixture(case, tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "memory.db")
    settings = case["settings"]
    assert memories._identity(settings) == {k: v for k, v in case["identity"].items() if k != "versions"}
    assert memories._asset_versions(settings) == case["identity"]["versions"]
    assert await memories.session_scope(settings) == case["world_scope"]
    assert await memories.session_scope(settings) == case["world_scope"]
    assert await memories.session_scope({**settings, "session_id": "same-identity"}) == case["world_scope"]
    async with aiosqlite.connect(db.DB_PATH) as connection:
        row = await (await connection.execute(
            "SELECT scope,mode,identity_json FROM session_scopes WHERE session_id=?",
            (settings["session_id"],))).fetchone()
    assert row[:2] == (case["world_scope"], "world")
    assert json.loads(row[2]) == case["identity"]

    original = await memories.create(case["world_scope"], "semantic", "fixture fact",
                                     source_session_id=settings["session_id"])
    preview = await memories.scope_preview(settings)
    assert preview["scope"] == preview["target_scope"] == case["world_scope"]
    assert preview["identity"] == preview["previous_identity"] == case["identity"]
    with pytest.raises(Conflict, match="preview migration again"):
        await memories.migrate_scope(settings, "stale", share=True)
    shared = await memories.migrate_scope(settings, preview["preview_revision"], share=True)
    assert shared == {"scope": case["shared_scope"], "copied": 1}
    assert await memories.session_scope(settings) == case["shared_scope"]
    copied, = await memories.list_memories(case["shared_scope"])
    assert copied["content"] == original["content"]
    assert copied["source_session_id"] == settings["session_id"]
    async with aiosqlite.connect(db.DB_PATH) as connection:
        row = await (await connection.execute(
            "SELECT scope,mode,identity_json FROM session_scopes WHERE session_id=?",
            (settings["session_id"],))).fetchone()
    assert row[:2] == (case["shared_scope"], "shared")
    assert json.loads(row[2]) == case["identity"]

    preview = await memories.scope_preview(settings)
    assert preview["scope"] == case["shared_scope"]
    assert preview["target_scope"] == case["world_scope"]
    assert await memories.migrate_scope(settings, preview["preview_revision"]) == {
        "scope": case["world_scope"], "copied": 0}
    assert await memories.session_scope(settings) == case["world_scope"]
    assert await memories.list_memories(case["world_scope"]) == [original]


@pytest.mark.asyncio
@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
async def test_expression_asset_does_not_change_scope(case, tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "memory.db")
    settings = case["settings"]
    assert await memories.session_scope(settings) == case["world_scope"]
    for expression in ("c" * 64, "d" * 64, None):
        changed = {**settings, "library_binding": {
            **(settings.get("library_binding") or {}), "expression_asset_id": expression}}
        assert await memories.session_scope(changed) == case["world_scope"]
        preview = await memories.scope_preview(changed)
        assert preview["identity"] == case["identity"]
        assert preview["target_scope"] == case["world_scope"]


@pytest.mark.asyncio
async def test_library_binding_defaults(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "memory.db")
    case = CASES["builtin-defaults"]
    for binding in (None, {}, {"character": None, "profile": None, "lorebooks": []}):
        settings = {**case["settings"], "library_binding": binding}
        assert await memories.session_scope(settings) == case["world_scope"]
        assert (await memories.scope_preview(settings))["identity"] == case["identity"]


@pytest.mark.asyncio
async def test_library_revision_changes_world_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "memory.db")
    before = CASES["unicode-library-revision-7"]
    after = CASES["unicode-library-revision-8"]
    assert before["world_scope"] != after["world_scope"]
    assert before["shared_scope"] == after["shared_scope"]
    assert await memories.session_scope(before["settings"]) == before["world_scope"]
    settings = {**after["settings"], "session_id": before["settings"]["session_id"]}
    preview = await memories.scope_preview(settings)
    assert preview["scope"] == before["world_scope"]
    assert preview["previous_identity"] == before["identity"]
    assert preview["target_scope"] == after["world_scope"]
    assert preview["identity"] == after["identity"]
    assert await memories.session_scope(settings) == after["world_scope"]
    assert (await memories.scope_preview(settings))["previous_identity"] == after["identity"]
