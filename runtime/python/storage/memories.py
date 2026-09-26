"""Memory Lab storage: memories, their operation log, and per-session enablement.

Memories live in a `scope` (a character/persona pair for chat, one experiment
run for research) so they survive across sessions but never leak between
experiment runs. Deletion is soft; every create/update/delete/retrieve/inject
is appended to `memory_events` so the inspector can replay what happened.
"""
import json
import uuid

import aiosqlite

from . import db as storage

COLUMNS = ("id, scope, type, content, importance, origin, supported, source_session_id, source_turn, "
           "source_generation_id, version, status, access_count, last_accessed, created_at, updated_at")


class NotFound(Exception):
    pass


async def init() -> None:
    await storage.init_db()


def chat_scope(character_id: str | None, persona_id: str | None, session_id: str) -> str:
    if not character_id:
        return f"session:{session_id}"
    return f"char:{character_id}|persona:{persona_id or 'default'}"


def _row(row) -> dict:
    d = dict(row)
    if d.get("supported") is not None:
        d["supported"] = bool(d["supported"])
    return d


async def _log(db, scope: str, op: str, memory_id: str | None = None, generation_id: str | None = None,
               detail: dict | None = None) -> None:
    await db.execute("INSERT INTO memory_events(memory_id,scope,op,generation_id,detail_json) VALUES(?,?,?,?,?)",
                     (memory_id, scope, op, generation_id, json.dumps(detail, ensure_ascii=False) if detail else None))


async def list_memories(scope: str, include_deleted: bool = False) -> list[dict]:
    await init()
    sql = f"SELECT {COLUMNS} FROM memories WHERE scope=?" + ("" if include_deleted else " AND status='active'")
    async with aiosqlite.connect(storage.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(sql + " ORDER BY rowid", (scope,))).fetchall()
    return [_row(r) for r in rows]


async def get(memory_id: str) -> dict:
    await init()
    async with aiosqlite.connect(storage.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(f"SELECT {COLUMNS} FROM memories WHERE id=?", (memory_id,))).fetchone()
    if not row:
        raise NotFound(memory_id)
    return _row(row)


async def create(scope: str, type_: str, content: str, *, origin: str = "user", supported: bool | None = None,
                 source_session_id: str | None = None, source_turn: int | None = None,
                 source_generation_id: str | None = None) -> dict:
    await init()
    memory_id = "mem_" + uuid.uuid4().hex[:12]
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute(
            "INSERT INTO memories(id,scope,type,content,origin,supported,source_session_id,source_turn,source_generation_id) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (memory_id, scope, type_, content, origin, None if supported is None else int(supported),
             source_session_id, source_turn, source_generation_id))
        await _log(db, scope, "create", memory_id, source_generation_id,
                   {"type": type_, "content": content, "origin": origin})
        await db.commit()
    return await get(memory_id)


async def update(memory_id: str, *, content: str | None = None, type_: str | None = None) -> dict:
    before = await get(memory_id)
    if before["status"] != "active":
        raise NotFound(memory_id)
    after = {"content": content if content is not None else before["content"],
             "type": type_ if type_ is not None else before["type"]}
    if after["content"] == before["content"] and after["type"] == before["type"]:
        return before
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("UPDATE memories SET content=?, type=?, version=version+1, origin=CASE WHEN origin='model' "
                         "THEN 'model_edited' ELSE origin END, updated_at=datetime('now') WHERE id=?",
                         (after["content"], after["type"], memory_id))
        await _log(db, before["scope"], "update", memory_id, None,
                   {"before": {"content": before["content"], "type": before["type"], "version": before["version"]},
                    "after": after})
        await db.commit()
    return await get(memory_id)


async def delete(memory_id: str) -> dict:
    before = await get(memory_id)
    if before["status"] != "active":
        raise NotFound(memory_id)
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("UPDATE memories SET status='deleted', updated_at=datetime('now') WHERE id=?", (memory_id,))
        await _log(db, before["scope"], "delete", memory_id, None, {"content": before["content"]})
        await db.commit()
    return await get(memory_id)


async def events(*, memory_id: str | None = None, scope: str | None = None, limit: int = 200) -> list[dict]:
    await init()
    where, args = ("memory_id=?", (memory_id,)) if memory_id else ("scope=?", (scope,))
    async with aiosqlite.connect(storage.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(
            f"SELECT id, memory_id, scope, op, generation_id, detail_json, created_at FROM memory_events "
            f"WHERE {where} ORDER BY id DESC LIMIT ?", (*args, limit))).fetchall()
    return [{**{k: r[k] for k in r.keys() if k != "detail_json"},
             "detail": json.loads(r["detail_json"]) if r["detail_json"] else None} for r in rows]


async def record_use(scope: str, generation_id: str | None, trace: dict) -> None:
    """Log one retrieval (all candidates) and mark injected memories as accessed."""
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await _log(db, scope, "retrieve", None, generation_id,
                   {"candidates": [{k: c[k] for k in ("id", "score", "decision")} for c in trace["candidates"]],
                    "injected_tokens": trace["injected_tokens"], "retrieval_ms": trace.get("retrieval_ms")})
        for memory_id in trace["injected"]:
            await db.execute("UPDATE memories SET access_count=access_count+1, last_accessed=datetime('now') WHERE id=?",
                             (memory_id,))
            await _log(db, scope, "inject", memory_id, generation_id, None)
        await db.commit()


async def session_enabled(session_id: str) -> bool:
    await init()
    async with aiosqlite.connect(storage.DB_PATH) as db:
        row = await (await db.execute("SELECT enabled FROM session_memory WHERE session_id=?", (session_id,))).fetchone()
    return bool(row and row[0])


async def set_session_enabled(session_id: str, enabled: bool) -> None:
    await init()
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("INSERT INTO session_memory(session_id,enabled) VALUES(?,?) ON CONFLICT(session_id) "
                         "DO UPDATE SET enabled=excluded.enabled, updated_at=datetime('now')", (session_id, int(enabled)))
        await db.commit()


async def scopes() -> list[dict]:
    await init()
    async with aiosqlite.connect(storage.DB_PATH) as db:
        rows = await (await db.execute(
            "SELECT scope, SUM(status='active'), COUNT(*), MAX(updated_at) FROM memories GROUP BY scope "
            "ORDER BY MAX(updated_at) DESC")).fetchall()
    return [{"scope": r[0], "active": r[1], "total": r[2], "updated_at": r[3]} for r in rows]


# ── turn helpers used by chat and experiments ────────────────────────────

async def prepare(scope: str, query: str, **options) -> dict:
    """Retrieve for one turn: the prompt block plus the full ranking trace."""
    import time

    from python.core import memory as logic
    start = time.perf_counter()
    items = await list_memories(scope)
    trace = logic.retrieve(items, query, **options)
    trace["retrieval_ms"] = round((time.perf_counter() - start) * 1000, 2)
    trace["scope"] = scope
    trace["stored_count"] = len(items)
    by_id = {m["id"]: m for m in items}
    return {"block": logic.render_block([by_id[i] for i in trace["injected"]]), "trace": trace}


async def commit(scope: str, result: dict, *, session_id: str | None, turn: int | None,
                 evidence_text: str) -> None:
    """After a turn: log retrieval, mark evidenced memories, validate and store proposals.

    Mutates ``result["memory"]`` so the persisted generation record carries every decision.
    """
    from python.core import memory as logic
    trace = result.get("memory")
    if not trace:
        return
    generation_id = result.get("generation_id")
    await record_use(scope, generation_id, trace)
    injected = {c["id"]: c["content"] for c in trace.get("candidates", []) if c.get("decision") in logic.INJECTED}
    trace["evidenced"] = [i for i, content in injected.items() if logic.evidenced(content, result.get("reply", ""))]
    decisions = []
    if result.get("status") == "completed" and trace.get("proposals"):
        proposals = [logic.MemoryProposal.model_validate(p) for p in trace["proposals"]]
        decisions = logic.validate_proposals(proposals, await list_memories(scope), evidence_text)
        for d in decisions:
            if d["action"] == "store":
                stored = await create(scope, d["type"], d["content"], origin="model", supported=d["supported"],
                                      source_session_id=session_id, source_turn=turn,
                                      source_generation_id=generation_id)
                d["memory_id"] = stored["id"]
    trace["decisions"] = decisions
