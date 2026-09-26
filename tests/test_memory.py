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


async def test_chat_stores_restores_across_sessions_and_evidences(isolated):
    async with client() as c:
        for sid in ("day1", "day2", "off"):
            assert (await c.put("/api/chat/settings", json={"session_id": sid, "character_id": "mocha_sfw"})).status_code == 200
        for sid in ("day1", "day2"):
            s = (await c.put(f"/api/memory/session/{sid}", json={"enabled": True})).json()
            assert s["enabled"] and s["scope"] == "char:mocha_sfw|persona:default"

        body = {"model_id": "mock-echo", "session_id": "day1",
                "messages": [{"role": "user", "content": "サーモンのお寿司が好きなんだ、覚えてて"}]}
        r = (await c.post("/api/chat", json=body)).json()
        assert r["memory"]["enabled"] and r["memory"]["injected"] == []
        assert r["memory"]["decisions"][0]["action"] == "store" and r["memory"]["decisions"][0]["supported"]
        stored = (await c.get("/api/memory", params={"scope": "char:mocha_sfw|persona:default"})).json()["memories"]
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
            "/api/memory/events", params={"scope": "char:mocha_sfw|persona:default"})).json()["events"]}

        # Memory off: same character, no retrieval and no proposals.
        body["session_id"] = "off"
        r = (await c.post("/api/chat", json=body)).json()
        assert r.get("memory") is None and "覚えてるよ" not in r["reply"]

        preview = (await c.post("/api/memory/search", json={"scope": "char:mocha_sfw|persona:default",
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
