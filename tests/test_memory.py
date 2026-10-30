import httpx
import pytest
from python.core import memory as logic
from python.core.memory import MemoryProposal

pytestmark = pytest.mark.asyncio


def mem(id_, type_, content):
    return {"id": id_, "type": type_, "content": content}


async def test_retrieval_ranks_by_overlap_and_respects_budget():
    items = [mem("a", "semantic", "寿司が好き。特にサーモン"), mem("b", "semantic", "猫を二匹飼っている"),
             mem("c", "relationship", "最近は気軽に冗談を言い合う仲")]
    trace = logic.retrieve(items, "お寿司はサーモンが一番だよね", fill_recent=False)
    assert trace["injected"][0] == "a"
    decisions = {c["id"]: c["decision"] for c in trace["candidates"]}
    assert decisions == {"a": "injected", "c": "injected", "b": "below_threshold"}
    filled = logic.retrieve(items, "お寿司はサーモンが一番だよね")
    assert filled["injected"] == ["a", "c", "b"] and filled["candidates"][-1]["decision"] == "recent_fill"
    tight = logic.retrieve(items, "お寿司はサーモンが一番だよね", budget_tokens=12, fill_recent=False)
    assert tight["injected"] == ["a"] and {c["decision"] for c in tight["candidates"]} >= {"over_budget"}
    assert logic.retrieve(items, "サーモン", top_k=1)["injected"] == ["a"]
    assert "[semantic] 寿司が好き" in logic.render_block([items[0]]) and logic.render_block([]) == ""


async def test_proposals_are_deduplicated_and_flagged_when_unsupported():
    existing = [mem("a", "semantic", "寿司が好き。特にサーモン")]
    props = [MemoryProposal(type="semantic", content="寿司が好き。特にサーモン"),
             MemoryProposal(type="episodic", content="来週の土曜に水族館へ行く約束をした"),
             MemoryProposal(type="semantic", content="宇宙飛行士として月面で働いている")]
    evidence = "今度の土曜に水族館へ行こうね、約束だよ"
    out = logic.validate_proposals(props, existing, evidence)
    assert [d["action"] for d in out] == ["skip", "store", "store"]
    assert out[0]["reason"] == "duplicate"
    assert out[1]["supported"] is True and out[2]["supported"] is False
    assert logic.evidenced("寿司が好き。特にサーモン", "サーモンのお寿司が好きなんだよね")
    assert not logic.evidenced("寿司が好き。特にサーモン", "今日は雨だね")


async def test_unverified_memories_are_inspectable_but_not_injected():
    item = {**mem("x", "semantic", "好きな花はデルフィニウム"), "supported": False, "origin": "model"}
    trace = logic.retrieve([item], "好きな花はデルフィニウム")
    assert trace["injected"] == [] and trace["candidates"][0]["decision"] == "unverified"
    item["origin"] = "model_edited"
    assert logic.retrieve([item], "花")["injected"] == ["x"]


async def test_memory_normalizes_before_validation_and_orders_by_insertion(isolated):
    from python.storage import memories
    async with client() as c:
        assert (await c.post("/api/memory", json={"scope": "s", "type": "semantic", "content": " \n "})).status_code == 422
        first = await memories.create("stable", "semantic", "最初の記憶")
        second = await memories.create("stable", "semantic", "次の記憶")
        assert [x["id"] for x in await memories.list_memories("stable")] == [first["id"], second["id"]]


def client():
    from python.api.main import app
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_memory_crud_keeps_versions_and_an_operation_log(isolated):
    async with client() as c:
        m = (await c.post("/api/memory", json={"scope": "char:x|persona:default", "type": "semantic",
                                                "content": " 寿司が  好き "})).json()
        assert m["content"] == "寿司が 好き" and m["origin"] == "user" and m["version"] == 1
        u = (await c.patch(f"/api/memory/{m['id']}", json={"content": "寿司が好き。特にサーモン"})).json()
        assert u["version"] == 2
        d = (await c.delete(f"/api/memory/{m['id']}")).json()
        assert d["status"] == "deleted"
        assert (await c.get("/api/memory", params={"scope": "char:x|persona:default"})).json()["memories"] == []
        full = (await c.get(f"/api/memory/{m['id']}")).json()
        assert [e["op"] for e in full["events"]] == ["delete", "update", "create"]
        assert full["events"][1]["detail"]["before"]["content"] == "寿司が 好き"
        assert (await c.patch(f"/api/memory/{m['id']}", json={"content": "x"})).status_code == 404
        assert (await c.post("/api/memory", json={"scope": "s", "type": "story", "content": "x"})).status_code == 422
        scopes = (await c.get("/api/memory/scopes")).json()["scopes"]
        assert scopes == [{"scope": "char:x|persona:default", "active": 0, "total": 1, "updated_at": scopes[0]["updated_at"]}]


@pytest.mark.parametrize("share", [False, True])
async def test_manual_memory_source_is_atomic_and_erased_with_session(isolated, monkeypatch, share):
    from python.storage import memories

    checked_db = None
    session_scope, create = memories.session_scope, memories._create

    async def checked_scope(settings, *, db=None):
        nonlocal checked_db
        if db is not None:
            assert db.in_transaction
            checked_db = db
        return await session_scope(settings, db=db)

    async def checked_create(db, *args, **kwargs):
        assert db is checked_db and db.in_transaction
        return await create(db, *args, **kwargs)

    async with client() as c:
        assert (await c.put("/api/chat/settings", json={"session_id": "manual-source",
            "character_id": "mocha_sfw", "world_id": "beast_world"})).status_code == 200
        if share:
            preview = (await c.get("/api/memory/session/manual-source/scope-preview")).json()
            assert (await c.post("/api/memory/session/manual-source/scope-migrate", json={
                "expected_revision": preview["preview_revision"], "share": True})).status_code == 200
        scope = (await c.get("/api/memory/session/manual-source")).json()["scope"]
        assert scope.startswith("char:" if share else "work:")
        body = {"scope": scope, "type": "semantic", "content": "  manual   fact "}
        global_memory = (await c.post("/api/memory", json=body)).json()
        assert global_memory["source_session_id"] is None
        monkeypatch.setattr(memories, "session_scope", checked_scope)
        monkeypatch.setattr(memories, "_create", checked_create)
        response = await c.post("/api/memory", json={**body, "source_session_id": "manual-source"})
        assert response.status_code == 200
        linked = response.json()
        assert linked["source_session_id"] == "manual-source" and linked["content"] == "manual fact"
        assert linked["source_quote"] == "manual fact" and linked["source_revision"] == "manual:1"
        assert linked["confirmation"] == "user_confirmed" and linked["origin"] == "user"
        assert (await c.delete("/api/chat/sessions/manual-source/data")).status_code == 200
        assert (await c.get(f"/api/memory/{linked['id']}")).status_code == 404
        assert await memories.events(memory_id=linked["id"]) == []
        assert [m["id"] for m in await memories.list_memories(scope)] == [global_memory["id"]]


@pytest.mark.parametrize("case", ["missing", "scope-only", "mismatch", "deleted", "source-pending", "peer-pending"])
async def test_manual_memory_source_rejects_invalid_or_busy_session(isolated, case):
    from python.storage import generations, memories

    async with client() as c:
        for sid in ("source", "peer", "__global__"):
            assert (await c.put("/api/chat/settings", json={
                "session_id": sid, "character_id": "mocha_sfw"})).status_code == 200
        scope = (await c.get("/api/memory/session/source")).json()["scope"]
        sid = "source"
        if case in {"missing", "scope-only"}:
            sid = "absent"
            if case == "scope-only":
                assert (await c.get(f"/api/memory/session/{sid}")).status_code == 200
        elif case == "mismatch":
            scope = "session:other"
            async with generations.transaction() as db:
                await db.execute("DELETE FROM session_scopes WHERE session_id=?", (sid,))
        elif case == "deleted":
            assert (await c.delete("/api/chat/sessions/source/data")).status_code == 200
            # Even stale restored settings must not bypass the deletion tombstone.
            async with generations.transaction() as db:
                await db.execute("INSERT INTO session_settings(session_id) VALUES('source')")
        else:
            await generations.reserve("busy", "peer" if case == "peer-pending" else sid, {})
        response = await c.post("/api/memory", json={
            "scope": scope, "type": "semantic", "content": "rejected fact", "source_session_id": sid})
        assert response.status_code == (404 if case in {"missing", "scope-only"} else 409)
        if case.endswith("pending"):
            assert "stop generation" in response.json()["error"]
        assert await memories.list_memories(scope) == []
        assert await memories.events(scope=scope) == []
        if case == "mismatch":
            async with generations.transaction() as db:
                assert await (await db.execute("SELECT 1 FROM session_scopes WHERE session_id=?", (sid,))).fetchone() is None


@pytest.mark.parametrize("invalid_source", ["", "x" * 301])
async def test_manual_memory_source_id_is_bounded(isolated, invalid_source):
    async with client() as c:
        assert (await c.post("/api/memory", json={"scope": "session:test", "type": "semantic", "content": "fact", "source_session_id": invalid_source})).status_code == 422


async def test_manual_memory_source_stays_in_tenant_and_accepts_history_only(isolated):
    from python.storage import db, generations
    from python.storage.context import CloudStorageContext, storage_context

    async with client() as c:
        with storage_context(CloudStorageContext("tenant-a", isolated / "tenant-a")):
            assert (await c.put("/api/chat/settings", json={"session_id": "foreign"})).status_code == 200
        with storage_context(CloudStorageContext("tenant-b", isolated / "tenant-b")):
            await db.init_db()
            async with generations.transaction() as connection:
                await connection.execute("INSERT INTO session_settings(session_id,character_id) VALUES('__global__','mocha_sfw')")
                await connection.execute("INSERT INTO chat_history(session_id,role,content) VALUES('history-only','user','hello')")
            body = {"scope": "char:mocha_sfw|persona:default", "type": "semantic", "content": "tenant fact"}
            assert (await c.post("/api/memory", json={**body, "source_session_id": "foreign"})).status_code == 404
            response = await c.post("/api/memory", json={**body, "source_session_id": "history-only"})
            assert response.status_code == 200 and response.json()["source_session_id"] == "history-only"
            assert (await c.post("/api/memory", json={**body, "source_session_id": None})).json()["source_session_id"] is None


@pytest.mark.parametrize("private_scope,explicit_source", [(True, False), (True, True), (False, True)])
async def test_migrate_equal_manual_facts_preserves_sources_and_repeat_dedup(isolated, private_scope, explicit_source):
    from python.storage import conversation, memories

    settings = {}
    target = "char:mocha_sfw|persona:default"
    for sid in ("source-a", "source-b"):
        settings[sid] = {"session_id": sid}
        if not private_scope:
            settings[sid].update(character_id="mocha_sfw", world_id=sid)
        original_scope = await memories.session_scope(settings[sid])
        await memories.create(original_scope, "semantic", "same manual fact",
                              source_session_id=sid if explicit_source else None)
        settings[sid].update(character_id="mocha_sfw", world_id="beast_world")
        preview = await memories.scope_preview(settings[sid])
        assert await memories.migrate_scope(settings[sid], preview["preview_revision"], share=True) == {
            "scope": target, "copied": 1}

    shared = await memories.list_memories(target)
    assert len(shared) == 2
    assert {m["source_session_id"] for m in shared} == {"source-a", "source-b"}
    assert all(m["source_generation_id"] is None and m["origin"] == "user" for m in shared)

    # A real round trip exercises dedup while source and target scopes differ.
    preview = await memories.scope_preview(settings["source-a"])
    await memories.migrate_scope(settings["source-a"], preview["preview_revision"])
    preview = await memories.scope_preview(settings["source-a"])
    assert await memories.migrate_scope(settings["source-a"], preview["preview_revision"], share=True) == {
        "scope": target, "copied": 0}
    assert [m["id"] for m in await memories.list_memories(target)] == [m["id"] for m in shared]

    await conversation.purge("source-a")
    remaining = await memories.list_memories(target)
    assert [m["id"] for m in remaining] == [m["id"] for m in shared if m["source_session_id"] == "source-b"]
    assert remaining[0]["content"] == "same manual fact"


async def test_migrate_unowned_world_fact_does_not_infer_session_source(isolated):
    from python.storage import conversation, memories

    settings = {"session_id": "source-a", "character_id": "mocha_sfw", "world_id": "beast_world"}
    scope = await memories.session_scope(settings)
    await memories.create(scope, "semantic", "same manual fact")
    target = "char:mocha_sfw|persona:default"
    attributed = await memories.create(target, "semantic", "same manual fact", source_session_id="source-a")
    preview = await memories.scope_preview(settings)
    assert await memories.migrate_scope(settings, preview["preview_revision"], share=True) == {
        "scope": target, "copied": 1}
    shared = await memories.list_memories(target)
    assert [m["source_session_id"] for m in shared] == ["source-a", None]
    await conversation.purge("source-a")
    remaining = await memories.list_memories(target)
    assert [m["id"] for m in remaining] == [shared[1]["id"]]
    assert remaining[0]["source_session_id"] is None and remaining[0]["id"] != attributed["id"]


async def test_chat_stores_restores_across_sessions_and_evidences(isolated):
    async with client() as c:
        for sid in ("day1", "day2", "off"):
            assert (await c.put("/api/chat/settings", json={"session_id": sid, "character_id": "mocha_sfw"})).status_code == 200
        for sid in ("day1", "day2"):
            s = (await c.put(f"/api/memory/session/{sid}", json={"enabled": True})).json()
            assert s["enabled"] and s["scope"].startswith("work:")
            if sid == "day1":
                scope = s["scope"]
            assert s["scope"] == scope

        body = {"model_id": "mock-echo", "session_id": "day1",
                "messages": [{"role": "user", "content": "サーモンのお寿司が好きなんだ、覚えてて"}]}
        r = (await c.post("/api/chat", json=body)).json()
        assert r["memory"]["enabled"] and r["memory"]["injected"] == []
        assert r["memory"]["decisions"][0]["action"] == "store" and r["memory"]["decisions"][0]["supported"]
        stored = (await c.get("/api/memory", params={"scope": scope})).json()["memories"]
        assert len(stored) == 1 and stored[0]["source_session_id"] == "day1" and stored[0]["origin"] == "model"

        # A new session with the same character: nothing in its history, the memory comes back.
        body = {"model_id": "mock-echo", "session_id": "day2",
                "messages": [{"role": "user", "content": "今日のお昼はお寿司にしようかな"}]}
        r = (await c.post("/api/chat", json=body)).json()
        assert r["memory"]["injected"] == [stored[0]["id"]]
        assert "覚えてるよ" in r["reply"] and r["memory"]["evidenced"] == [stored[0]["id"]]
        assert r["token_budget"]["memory_tokens"] > 0
        debug = (await c.get("/api/chat/debug", params={"session_id": "day2"})).json()
        assert debug["memory"]["injected"] == [stored[0]["id"]]
        after = (await c.get(f"/api/memory/{stored[0]['id']}")).json()
        assert after["access_count"] == 1 and {"retrieve", "inject"} <= {e["op"] for e in (await c.get(
            "/api/memory/events", params={"scope": scope})).json()["events"]}

        # Memory off: same character, no retrieval and no proposals.
        body["session_id"] = "off"
        r = (await c.post("/api/chat", json=body)).json()
        assert r.get("memory") is None and "覚えてるよ" not in r["reply"]

        preview = (await c.post("/api/memory/search", json={"scope": scope,
                                                            "query": "サーモン"})).json()
        assert preview["injected"] == [stored[0]["id"]] and "サーモン" in preview["block"]


async def test_experiment_memory_on_off_with_probes(isolated):
    from python.core.experiment import load_scenario, run_single
    scenario = load_scenario("mocha_memory_001")
    assert scenario.turns[4].new_session and scenario.turns[4].expect_recall
    on, turns_on, _ = await run_single(scenario, "mock-echo", memory=True)
    off, turns_off, _ = await run_single(scenario, "mock-echo")
    assert on.memory_enabled and not on.official and not off.memory_enabled
    m_on, m_off = on.metrics["memory"], off.metrics["memory"]
    assert m_on["probes"] == m_off["probes"] == 3
    # The mock recalls whatever memory is injected, so only the memory run can recall after the break.
    assert m_on["recalled"] >= 1 and m_off["recalled"] == 0
    assert set(m_off["outcomes"]) == {"no_memory"}
    assert m_on["stored"] >= 1 and m_on["avg_retrieval_ms"] is not None
    assert turns_on[4]["new_session"] and turns_on[4]["memory"]["injected"]
    assert not any(t.get("memory") for t in turns_off)
    # Runs never share memories.
    from python.storage import memories
    assert (await memories.list_memories(f"exp:{off.experiment_id}")) == []
