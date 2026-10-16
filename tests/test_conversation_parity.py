"""Real runtime/storage paths with Mock only; no measured model-quality claims."""
import sqlite3
from contextlib import closing

import httpx
import pytest

from python.api.main import app
from python.core.schemas import RuntimeState
from python.storage import conversation, db, generations, memories

pytestmark = pytest.mark.asyncio


def client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def send(c, sid, text, **extra):
    return await c.post("/api/chat", json={"session_id": sid, "model_id": "mock-echo",
                                           "messages": [{"role": "user", "content": text}], **extra})


async def test_stored_context_conflict_compaction_and_replay(isolated):
    async with client() as c:
        for turn in range(11):
            snapshot = (await c.get("/api/chat/context/stored")).json()
            body = {"context_mode": "stored", "history_revision": snapshot["history_revision"], "generation_id": f"stored-{turn}"}
            response = await send(c, "stored", f"source_{turn}", **body)
            assert response.status_code == 200, response.text
        assert len((await conversation.context("stored"))["summaries"]) == 1
        stale = await send(c, "stored", "stale", context_mode="stored", history_revision=snapshot["history_revision"])
        assert stale.status_code == 409
        replay = await send(c, "stored", "source_10", **body)
        assert replay.status_code == 200
        assert len((await c.get("/api/chat/history?session_id=stored")).json()["history"]) == 22
        assert response.json()["user_id"] is not None


async def test_chapter_arc_edits_sources_and_budget(isolated):
    await db.init_db()
    async with generations.transaction() as con:
        for index in range(220):
            await con.execute("INSERT INTO chat_history(session_id,role,content) VALUES('long',?,?)",
                              ("user" if index % 2 == 0 else "assistant", f"original_{index}"))
        await conversation.refresh(con, "long")
    context = await conversation.context("long")
    chapters = [s for s in context["summaries"] if s["kind"] == "chapter"]
    arcs = [s for s in context["summaries"] if s["kind"] == "arc"]
    assert len(chapters) == 11 and len(arcs) == 1
    assert len(chapters[0]["source_message_ids"]) == 20 and len(arcs[0]["source_message_ids"]) == 200
    updated = await conversation.edit_summary("long", chapters[0]["id"], "corrected_chapter_marker", chapters[0]["revision"])
    assert updated["history_revision"] != context["history_revision"]
    assert any("corrected_chapter_marker" in s["text"] for s in updated["summaries"] if s["kind"] == "arc")
    with pytest.raises(generations.Conflict):
        await conversation.edit_summary("long", chapters[0]["id"], "stale", chapters[0]["revision"])
    messages = await conversation.resolve_messages("long", [{"role": "user", "content": "next"}], history_revision=updated["history_revision"])
    assert "corrected_chapter_marker" in messages[0]["content"]
    assert len(messages) == 22 and messages[-1]["content"] == "next"
    from python.core.portable_prompt import assemble_messages
    from python.core.schemas import CompiledPrompt
    compiled = CompiledPrompt(system_prompt="important world settings")
    assembled = assemble_messages(compiled, messages, "contract")
    assert "corrected_chapter_marker" in assembled[0]["content"]
    assert "important world settings" in assembled[0]["content"]
    with pytest.raises(ValueError, match="context budget"):
        await conversation.resolve_messages("long", [{"role": "user", "content": "x" * 60000}], history_revision=updated["history_revision"])
    branched = await conversation.branch("long", 200)
    fork = await conversation.context(branched["session_id"])
    assert any(s["method"] == "user_edited" and s["text"] == "corrected_chapter_marker" for s in fork["summaries"])
    assert max(fork["summaries"][0]["source_message_ids"]) > 220


async def test_new_world_scopes_pinned_legacy_and_explicit_sharing(isolated):
    await db.init_db()
    with sqlite3.connect(db.DB_PATH) as con:
        con.execute("INSERT INTO session_settings(session_id,character_id) VALUES('legacy','mocha_sfw')")
    legacy = {"session_id": "legacy", "character_id": "mocha_sfw"}
    assert await memories.session_scope(legacy) == "char:mocha_sfw|persona:default"
    first = {"session_id": "new1", "character_id": "mocha_sfw", "world_id": "beast_world"}
    second = {**first, "session_id": "new2", "world_id": None}
    scope = await memories.session_scope(first)
    assert scope.startswith("work:") and scope != await memories.session_scope(second)
    assert scope == await memories.session_scope({**first, "session_id": "same-world"})
    await memories.create(scope, "semantic", "world-specific memory")
    assert await memories.list_memories(await memories.session_scope(second)) == []
    preview = await memories.scope_preview(first)
    with pytest.raises(generations.Conflict):
        await memories.migrate_scope(first, "stale", share=True)
    shared = await memories.migrate_scope(first, preview["preview_revision"], share=True)
    assert shared["scope"] == "char:mocha_sfw|persona:default" and shared["copied"] == 1
    assert len(await memories.list_memories(scope)) == 1
    assert await memories.session_scope(first) == shared["scope"]


async def test_reply_cannot_support_user_biography_but_story_is_labeled(isolated):
    result = {"generation_id": "story-source", "status": "completed", "reply": "宇宙飛行士として月面で働いている",
              "memory": {"candidates": [], "injected": [], "injected_tokens": 0,
                         "proposals": [{"type": "semantic", "content": "宇宙飛行士として月面で働いている"}]}}
    await memories.commit("facts", result, session_id="source", turn=1, evidence_text="こんにちは")
    memory = (await memories.list_memories("facts"))[0]
    assert not memory["supported"] and memory["source_kind"] == "user_statement"
    assert memory["source_quote"] == "こんにちは" and memory["confirmation"] == "unverified"
    assert (await memories.prepare("facts", "宇宙飛行士"))["trace"]["injected"] == []
    result["memory"]["proposals"][0].update(source_kind="story_event")
    await memories.commit("fiction", result, session_id="source", turn=1, evidence_text="こんにちは")
    fictional = (await memories.list_memories("fiction"))[0]
    assert fictional["supported"] and fictional["source_kind"] == "story_event"
    assert "not user biography" in (await memories.prepare("fiction", "宇宙飛行士"))["block"]


async def test_finish_is_atomic_with_summary_failure(isolated, monkeypatch):
    await generations.reserve("atomic", "s", {})
    result = {"generation_id": "atomic", "status": "completed", "reply": "reply", "state": RuntimeState(session_id="s", turn=1).model_dump(),
              "memory": {"candidates": [], "injected": [], "injected_tokens": 0,
                         "proposals": [{"type": "semantic", "content": "サーモンが好き"}]}}
    async def fail(*args):
        raise RuntimeError("summary write failed")
    monkeypatch.setattr(conversation, "refresh", fail)
    with pytest.raises(RuntimeError):
        await generations.finish("atomic", result, {"role": "user", "content": "サーモンが好き"}, "mock-echo", memory_scope="atomic-scope")
    with sqlite3.connect(db.DB_PATH) as con:
        assert con.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 0
        assert con.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
        assert con.execute("SELECT status FROM generations").fetchone()[0] == "pending"


async def test_regenerate_invalidates_old_memory_before_commit(isolated):
    async with client() as c:
        await c.put("/api/chat/settings", json={"session_id": "regen-memory", "character_id": "mocha_sfw"})
        scope = (await c.put("/api/memory/session/regen-memory", json={"enabled": True})).json()["scope"]
        original = (await send(c, "regen-memory", "サーモンが好き、覚えて", generation_id="old-memory")).json()
        old = (await memories.list_memories(scope))[0]
        regenerated = await send(c, "regen-memory", "サーモンが好き、覚えて", generation_id="new-memory",
                                 regenerate_message_id=original["assistant_id"])
        assert regenerated.status_code == 200, regenerated.text
        active = await memories.list_memories(scope)
        assert len(active) == 1 and active[0]["id"] != old["id"]
        assert active[0]["source_generation_id"] == "new-memory"
        assert active[0]["source_message_ids"] == [original["user_id"]]
        assert (await memories.get(old["id"]))["status"] == "deleted"
        assert not any(e["generation_id"] == "old-memory" for e in await memories.events(scope=scope))


async def test_branch_copies_only_predecessor_state_memory_and_edit_truncates(isolated):
    async with client() as c:
        await c.put("/api/chat/settings", json={"session_id": "parent", "character_id": "mocha_sfw"})
        await c.put("/api/memory/session/parent", json={"enabled": True})
        first = (await send(c, "parent", "りんごが好き、覚えて")).json()
        second = (await send(c, "parent", "未来は月面基地に行くのが好き、覚えて")).json()
        response = await c.post("/api/chat/sessions/parent/branch", json={"message_id": first["assistant_id"]})
        assert response.status_code == 200, response.text
        sid = response.json()["session_id"]
        state = (await c.get(f"/api/chat/debug?session_id={sid}")).json()
        assert state["state"]["turn"] == 1 and state["history_count"] == 2
        active = await memories.list_memories(state["memory_session"]["scope"])
        assert len(active) == 1 and "月面基地" not in active[0]["content"]
        history = (await c.get(f"/api/chat/history?session_id={sid}")).json()["history"]
        regen = await send(c, sid, history[0]["content"], regenerate_message_id=history[1]["id"])
        assert regen.status_code == 200 and regen.json()["state"]["turn"] == 1
        assert (await c.put(f"/api/chat/history/{first['user_id']}", json={"content": "訂正"})).status_code == 200
        remaining = (await c.get("/api/chat/history?session_id=parent")).json()["history"]
        assert len(remaining) == 1 and remaining[0]["content"] == "訂正"
        assert (await generations.status(second["generation_id"], "parent"))["status"] == "completed"
        with sqlite3.connect(db.DB_PATH) as con:
            assert "月面基地" not in con.execute("SELECT result_json FROM generations WHERE generation_id=?", (second["generation_id"],)).fetchone()[0]


async def test_physical_purge_removes_payload_and_fences_replay(isolated):
    async with client() as c:
        await c.put("/api/memory/session/erase", json={"enabled": True})
        saved = await send(c, "erase", "秘密の好きな言葉、覚えて", generation_id="erase-gen")
        assert saved.status_code == 200
        assert (await c.delete("/api/chat/sessions/erase/data")).status_code == 200
        with sqlite3.connect(db.DB_PATH) as con:
            for table in ("chat_history", "generations", "runtime_states", "conversation_summaries", "session_settings", "session_memory", "session_scopes"):
                assert con.execute(f"SELECT COUNT(*) FROM {table} WHERE session_id='erase'").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM memories WHERE source_session_id='erase'").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM memory_events").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM session_deletions WHERE session_id='erase'").fetchone()[0] == 1
        assert (await send(c, "erase", "秘密の好きな言葉、覚えて", generation_id="erase-gen")).status_code == 409


async def test_declarative_cast_rpg_server_dice_replay_and_validation(isolated, monkeypatch):
    from python.core import story
    calls = []
    monkeypatch.setattr(story.secrets, "randbelow", lambda n: calls.append(n) or 19)
    async with client() as c:
        world = {"display_name": "冒険", "rules": "利用者の行動を決めない",
                 "cast": [{"id": "guide", "display_name": "案内人", "knowledge": "森の道だけ知る"}],
                 "rpg": {"initial_hp": 100, "initial_inventory": ["鍵"], "skills": {"探索": 2},
                         "actions": [{"id": "open", "label": "扉を開く", "trigger": "扉を開く", "skill": "探索",
                                      "difficulty": 10, "hp_delta": -3, "inventory_remove": ["鍵"], "inventory_add": ["宝石"]}]}}
        created = await c.post("/api/creator/world", json=world)
        assert created.status_code == 201
        await c.put("/api/chat/settings", json={"session_id": "rpg", "world_id": created.json()["id"]})
        saved = await send(c, "rpg", "扉を開く", generation_id="roll-once")
        assert saved.status_code == 200, saved.text
        state = saved.json()["state"]["rpg"]
        assert state["hp"] == 97 and state["inventory"] == ["宝石"]
        assert state["rolls"][0]["die"] == 20 and state["rolls"][0]["generation_id"] == "roll-once"
        assert "案内人" in saved.json()["raw_prompt"] and "森の道だけ知る" in saved.json()["raw_prompt"]
        replay = await send(c, "rpg", "扉を開く", generation_id="roll-once")
        assert replay.json()["state"]["rpg"] == state and calls == [20]
        rejected = (await send(c, "rpg", "扉を開く", generation_id="missing-key")).json()["state"]["rpg"]
        assert rejected["hp"] == 97 and rejected["rolls"][-1]["reason"] == "missing_inventory"
        assert calls == [20]
        mention = (await send(c, "rpg", "扉を開くことはしない", generation_id="do-not-roll")).json()["state"]["rpg"]
        assert mention == rejected and calls == [20]
        world["rpg"]["script"] = "import os"
        assert (await c.post("/api/creator/world", json=world)).status_code == 422


async def test_pending_mutations_block_and_summary_clear(isolated):
    await generations.reserve("pending", "pending", {})
    async with client() as c:
        assert (await c.put("/api/chat/settings", json={"session_id": "pending", "character_id": "mocha_sfw"})).status_code == 409
    with pytest.raises(generations.Conflict):
        await conversation.purge("pending")
    with pytest.raises(generations.Conflict):
        await conversation.branch("pending", 1)
    await generations.cancel("pending", "pending")
    await conversation.purge("pending")


@pytest.mark.parametrize("terminal", ["completed", "cancelled"])
async def test_purge_blocks_pending_cached_source_after_memory_clear(isolated, terminal):
    import copy
    import json

    async with client() as c:
        assert (await send(c, "erase-source", "private original")).status_code == 200
        await memories.create("shared", "semantic", "cached secret", source_session_id="erase-source")
        cached = await memories.prepare("shared", "another request")
        assert cached["trace"]["injected"]
        await generations.reserve("cached-generation", "other-session", {})
        # Simulate a previously cleared store; no durable scope/source row can
        # connect this pending task's already prepared memory context to A.
        async with generations.transaction() as con:
            await con.execute("DELETE FROM memory_events")
            await con.execute("DELETE FROM memories")
        rejected = await c.delete("/api/chat/sessions/erase-source/data")
        assert rejected.status_code == 409 and "stop all generations" in rejected.text
        with closing(sqlite3.connect(db.DB_PATH)) as con:
            assert con.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM session_deletions").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='erase-source'").fetchone()[0] == 2
        assert (await generations.status("cached-generation", "other-session"))["status"] == "pending"

        state = RuntimeState(session_id="other-session").model_dump()
        result = {"status": "completed", "reply": "retained reply", "full": "retained reply",
                  "state": state, "state_before": state, "memory": copy.deepcopy(cached["trace"]),
                  "raw_prompt": cached["block"]}
        if terminal == "cancelled":
            await generations.cancel("cached-generation", "other-session")
        finished = await generations.finish("cached-generation", result,
                                             {"role": "user", "content": "another request"}, "mock-echo")
        assert finished["status"] == terminal
        if terminal == "completed":
            assert "cached secret" in json.dumps(finished)
        assert (await c.delete("/api/chat/sessions/erase-source/data")).status_code == 200
        saved = await generations.latest("other-session")
        assert "cached secret" not in json.dumps(saved)
        if terminal == "completed":
            assert saved["reply"] == "retained reply" and saved["state"] == state
        # A late finish cannot overwrite either the redacted terminal record
        # or the cancellation that fenced the cached RAM response.
        replay = await generations.finish("cached-generation", result, None, "mock-echo")
        assert "cached secret" not in json.dumps(replay)


async def test_generation_settings_report_real_applied_or_unsupported(isolated):
    async with client() as c:
        response = await send(c, "parameters", "hello", max_tokens=64, top_p=0.7)
        assert response.status_code == 200
        config = response.json()["generation_config"]
        assert config["requested"]["max_tokens"] == 64 and config["requested"]["top_p"] == 0.7
        assert {"max_tokens", "top_p"} <= set(config["unsupported"])
        assert "max_tokens" not in config["applied"] and "top_p" not in config["applied"]
        assert response.json()["telemetry"]["save_processing_ms"] >= 0
        assert (await send(c, "parameters", "bad", max_tokens=0)).status_code == 422
        assert (await send(c, "parameters", "bad", top_p=1.1)).status_code == 422


async def test_purge_control_tombstone_and_revision_are_atomic(isolated):
    control = isolated / "control.db"
    with sqlite3.connect(control) as con:
        con.execute("CREATE TABLE sync_heads(owner TEXT,id TEXT,revision INTEGER,deleted INTEGER,payload TEXT,PRIMARY KEY(owner,id))")
        con.execute("INSERT INTO sync_heads VALUES('owner','workspace',3,0,'{}')")
        con.execute("CREATE TRIGGER reject_revision BEFORE UPDATE ON sync_heads BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    async with client() as c:
        assert (await send(c, "atomic-purge", "private source")).status_code == 200
    with pytest.raises(Exception, match="injected failure"):
        await conversation.purge("atomic-purge", cloud_revision=(control, "owner"))
    with sqlite3.connect(db.DB_PATH) as con:
        assert con.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='atomic-purge'").fetchone()[0] == 2
        assert con.execute("SELECT COUNT(*) FROM session_deletions").fetchone()[0] == 0
    with sqlite3.connect(control) as con:
        assert con.execute("SELECT revision FROM sync_heads").fetchone()[0] == 3
        con.execute("DROP TRIGGER reject_revision")
    await conversation.purge("atomic-purge", cloud_revision=(control, "owner"))
    import hashlib
    with sqlite3.connect(control) as con:
        assert con.execute("SELECT hash FROM conversation_erasures WHERE owner='owner'").fetchone()[0] == hashlib.sha256(b"atomic-purge").hexdigest()
        assert con.execute("SELECT revision FROM sync_heads").fetchone()[0] == 4
    with sqlite3.connect(db.DB_PATH) as con:
        assert con.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 0


@pytest.mark.parametrize("clear_first", [False, True])
async def test_purge_scrubs_injected_source_snapshots_in_other_session(isolated, clear_first):
    async with client() as c:
        for sid in ("source-session", "recall-session"):
            await c.put("/api/chat/settings", json={"session_id": sid, "character_id": "mocha_sfw"})
            await c.put(f"/api/memory/session/{sid}", json={"enabled": True})
        source = (await send(c, "source-session", "特別な秘密の花が好き、覚えて")).json()
        recalled = (await send(c, "recall-session", "その花は？")).json()
        assert recalled["memory"]["injected"]
        memory_id = recalled["memory"]["injected"][0]
        if clear_first:
            assert (await c.delete("/api/memory/session/source-session/data")).status_code == 200
            with closing(sqlite3.connect(db.DB_PATH)) as con:
                assert con.execute("SELECT COUNT(*) FROM memories").fetchone()[0] == 0
        assert (await c.delete("/api/chat/sessions/source-session/data")).status_code == 200
        snapshot = await generations.latest("recall-session")
        assert memory_id not in {m["id"] for m in snapshot["memory"]["candidates"]}
        assert not {"raw_prompt", "compiled", "attempts"} & snapshot.keys()
        # A separate conversation's committed reply remains that conversation's data.
        assert snapshot["reply"] == recalled["reply"] and snapshot["assistant_id"] != source["assistant_id"]


async def test_erasure_helper_identifies_cleared_sources_and_preserves_other_data():
    import json

    original = {"reply": "another conversation's reply", "state": {"turn": 2},
                "memory": {"candidates": [
                    {"id": "removed", "source_session_id": "erased", "content": "secret"},
                    {"id": "kept", "source_session_id": "other", "content": "retained"}],
                    "decisions": [{"memory_id": "removed"}, {"memory_id": "kept"}],
                    "injected": ["removed", "kept"], "evidenced": ["removed", "kept"]},
                "raw_prompt": "secret", "compiled": "secret", "attempts": ["secret"]}
    before = json.dumps(original, sort_keys=True)
    redacted = conversation.erase_memory_references(original, [], source_session_ids={"erased"})
    assert "secret" not in json.dumps(redacted)
    assert redacted["reply"] == original["reply"] and redacted["state"] == original["state"]
    assert redacted["memory"]["candidates"] == [original["memory"]["candidates"][1]]
    assert redacted["memory"]["decisions"] == [{"memory_id": "kept"}]
    assert redacted["memory"]["injected"] == redacted["memory"]["evidenced"] == ["kept"]
    assert json.dumps(original, sort_keys=True) == before
    assert conversation.erase_memory_references(original, [], source_session_ids={"unrelated"}) is original


async def test_purge_cleared_source_redaction_rolls_back_with_control_failure(isolated):
    import json

    await db.init_db()
    original = {"reply": "retained reply", "memory": {"candidates": [
        {"id": "cleared", "source_session_id": "erased", "content": "secret"}], "injected": ["cleared"]},
        "raw_prompt": "secret"}
    async with generations.transaction() as con:
        await con.execute("INSERT INTO chat_history(session_id,role,content) VALUES('erased','user','secret')")
        await con.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) "
                          "VALUES('retained','other','fingerprint','completed',?)", (json.dumps(original),))
    control = isolated / "redaction-control.db"
    with closing(sqlite3.connect(control)) as con, con:
        con.execute("CREATE TABLE sync_heads(owner TEXT,id TEXT,revision INTEGER,deleted INTEGER,payload TEXT,PRIMARY KEY(owner,id))")
        con.execute("INSERT INTO sync_heads VALUES('owner','workspace',1,0,'{}')")
        con.execute("CREATE TRIGGER reject_revision BEFORE UPDATE ON sync_heads BEGIN SELECT RAISE(ABORT,'injected failure'); END")
    with pytest.raises(Exception, match="injected failure"):
        await conversation.purge("erased", cloud_revision=(control, "owner"))
    assert (await generations.latest("other"))["memory"] == original["memory"]
    with closing(sqlite3.connect(db.DB_PATH)) as con:
        assert con.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='erased'").fetchone()[0] == 1
        assert con.execute("SELECT COUNT(*) FROM session_deletions").fetchone()[0] == 0
    with closing(sqlite3.connect(control)) as con, con:
        con.execute("DROP TRIGGER reject_revision")
    await conversation.purge("erased", cloud_revision=(control, "owner"))
    after = await generations.latest("other")
    assert after["reply"] == original["reply"] and "secret" not in json.dumps(after)


@pytest.mark.parametrize("context_mode", ["client", "stored"])
async def test_native_version_drift_fails_closed_then_explicit_migration(isolated, monkeypatch, context_mode):
    from python.core import prompt_compiler
    native = isolated / "characters"
    native.mkdir()
    file = native / "pinned.yaml"
    file.write_text("id: pinned\ndisplay_name: Pinned\nversion: 0.1.0\n", encoding="utf-8")
    monkeypatch.setattr(prompt_compiler, "CHAR_DIR", native)
    async with client() as c:
        assert (await c.put("/api/chat/settings", json={"session_id": "pinned-native", "character_id": "pinned"})).status_code == 200
        first = (await c.get("/api/chat/context/pinned-native")).json()
        assert not await memories.session_enabled("pinned-native")
        await memories.create(first["scope"], "semantic", "old version memory")
        file.write_text("id: pinned\ndisplay_name: Pinned\nversion: 0.2.0\n", encoding="utf-8")
        rejected = await send(c, "pinned-native", "hello", context_mode=context_mode,
                              history_revision=first["history_revision"])
        assert rejected.status_code == 409 and "version changed" in rejected.text
        with closing(sqlite3.connect(db.DB_PATH)) as con:
            assert con.execute("SELECT COUNT(*) FROM generations").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 0
        assert (await c.get("/api/chat/context/pinned-native")).status_code == 409
        preview = (await c.get("/api/memory/session/pinned-native/scope-preview")).json()
        assert preview["previous_identity"]["versions"]["character_id"] == "0.1.0"
        assert preview["identity"]["versions"]["character_id"] == "0.2.0"
        file.write_text("id: pinned\ndisplay_name: Pinned\nversion: 0.3.0\n", encoding="utf-8")
        assert (await c.post("/api/memory/session/pinned-native/scope-migrate", json={"expected_revision": preview["preview_revision"]})).status_code == 409
        preview = (await c.get("/api/memory/session/pinned-native/scope-preview")).json()
        migrated = await c.post("/api/memory/session/pinned-native/scope-migrate", json={"expected_revision": preview["preview_revision"]})
        assert migrated.status_code == 200 and migrated.json()["scope"] != first["scope"]
        assert len(await memories.list_memories(first["scope"])) == 1
        assert (await send(c, "pinned-native", "hello")).status_code == 200


async def test_library_binding_keeps_exact_version_when_latest_library_changes(isolated):
    from python.storage import library
    from python.core.portable_schema import PortableDocument
    await db.init_db()
    first = library.save_item(PortableDocument(name="First", data={"description": "fixed"}))
    settings = {"session_id": "pinned-library", "character_id": first.id,
                "library_binding": {"character": {"id": first.id, "revision": first.revision}}}
    original_scope = await memories.session_scope(settings)
    library.save_item(PortableDocument(name="Second", data={"description": "updated"}), first.id, first.revision)
    assert await memories.session_scope(settings) == original_scope
    from python.core.prompt_compiler import compile_prompt
    compiled = compile_prompt(character_id=first.id, library_binding=settings["library_binding"])
    assert compiled.character_version == "1.0.1" and "fixed" in compiled.system_prompt


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("context_mode", ["client", "stored"])
async def test_cloud_native_version_guard_independent_of_memory(isolated, monkeypatch, enabled, context_mode):
    from python.cloud.app import create_app
    from python.cloud.generation import CloudChat
    from python.cloud.store import CloudError
    from python.core import prompt_compiler
    from python.storage.context import CloudStorageContext, storage_context
    from test_cloud_cost_accounting import config, enroll

    native = isolated / "cloud-characters"
    native.mkdir()
    asset = native / "pinned.yaml"
    asset.write_text("id: pinned\ndisplay_name: Pinned\nversion: 0.1.0\nnsfw: false\n", encoding="utf-8")
    monkeypatch.setattr(prompt_compiler, "CHAR_DIR", native)

    def no_network(request):
        pytest.fail("version checks must not invoke paid providers")

    hosted = create_app(config(isolated), transport=httpx.MockTransport(no_network))
    owner = enroll(hosted)
    context = CloudStorageContext.for_owner(hosted.state.store.config.root / "tenants", owner)
    with storage_context(context):
        await db.init_db()
        settings = {"session_id": "cloud-pinned", "character_id": "pinned"}
        await memories.session_scope(settings)
        async with generations.transaction() as con:
            await con.execute("INSERT INTO session_settings(session_id,character_id) VALUES('cloud-pinned','pinned')")
        await memories.set_session_enabled("cloud-pinned", enabled)
        req = CloudChat(model_id="cloud-standard", session_id="cloud-pinned", context_mode=context_mode,
                        history_revision=await conversation.revision("cloud-pinned"),
                        messages=[{"role": "user", "content": "hello"}])
        prepared = await hosted.state.jobs.prepare(owner, req)
        assert (prepared["memory"] is not None) == enabled
        asset.write_text("id: pinned\ndisplay_name: Pinned\nversion: 0.2.0\nnsfw: false\n", encoding="utf-8")
        with pytest.raises(CloudError, match="memory_scope_revision_conflict") as caught:
            await hosted.state.jobs.prepare(owner, req)
        assert caught.value.status == 409
        with hosted.state.store.transaction() as control:
            assert control.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 0
