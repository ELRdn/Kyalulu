"""Memory Lab storage: memories, their operation log, and per-session enablement.

Memories live in a `scope` (a character/persona pair for chat, one experiment
run for research) so they survive across sessions but never leak between
experiment runs. Deletion is soft; every create/update/delete/retrieve/inject
is appended to `memory_events` so the inspector can replay what happened.
"""
from python.storage.context import get_db_path
import json
import uuid
import hashlib

import aiosqlite
import anyio

from . import db as storage

COLUMNS = ("id, scope, type, content, importance, origin, supported, source_session_id, source_turn, "
           "source_generation_id, version, status, access_count, last_accessed, created_at, updated_at, "
           "source_kind, source_quote, source_revision, source_message_ids, confirmation")


class NotFound(Exception):
    pass


async def init() -> None:
    await storage.init_db()


def chat_scope(character_id: str | None, persona_id: str | None, session_id: str) -> str:
    if not character_id:
        return f"session:{session_id}"
    return f"char:{character_id}|persona:{persona_id or 'default'}"


async def session_scope(settings: dict, *, db=None) -> str:
    """Pin new scope identities once; existing saved sessions retain their legacy scope."""
    if db is None:
        await init()
        async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as own:
            await own.execute("BEGIN IMMEDIATE")
            scope = await session_scope(settings, db=own)
            await own.commit()
            return scope
    sid = settings.get("session_id", "default")
    row = await (await db.execute("SELECT scope,mode,identity_json FROM session_scopes WHERE session_id=?", (sid,))).fetchone()
    identity = _identity(settings)
    identity["versions"] = _asset_versions(settings)
    if row:
        before = json.loads(row[2])
        changed_versions = [k for k, value in identity["versions"].items()
                            if k in before.get("versions", {}) and before.get(k) == identity.get(k)
                            and before["versions"][k] != value
                            and (k != "character_id" or (before.get("library_binding") or {}).get("character") == identity["library_binding"].get("character"))]
        if changed_versions:
            from .generations import Conflict
            raise Conflict("asset version changed; preview and explicitly migrate memory scope before continuing")
        if all(before.get(k) == v for k, v in identity.items()):
            return row[0]
        if row[1] != "world":
            await db.execute("UPDATE session_scopes SET identity_json=? WHERE session_id=?", (json.dumps(identity), sid))
            return row[0]
    existing = await (await db.execute("SELECT 1 FROM session_settings WHERE session_id=?", (sid,))).fetchone()
    if not existing:
        existing = await (await db.execute("SELECT 1 FROM chat_history WHERE session_id=? LIMIT 1", (sid,))).fetchone()
    legacy = bool(existing) and row is None
    encoded = json.dumps(identity, ensure_ascii=False, sort_keys=True)
    scope = chat_scope(settings.get("character_id"), settings.get("persona_id"), sid) if legacy else (
        "work:" + hashlib.sha256(encoded.encode()).hexdigest() if settings.get("character_id") else f"session:{sid}")
    await db.execute("INSERT INTO session_scopes VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET "
                     "scope=excluded.scope,mode=excluded.mode,identity_json=excluded.identity_json",
                     (sid, scope, "legacy" if legacy else "world", encoded))
    return scope


def _identity(settings):
    from python.core.portable_schema import LibraryBinding
    return {**{k: settings.get(k) for k in ("character_id", "persona_id", "world_id")},
            "library_binding": LibraryBinding.model_validate(settings.get("library_binding") or {}).model_dump(exclude={"expression_asset_id"})}


def _asset_versions(settings):
    from python.core.prompt_compiler import _load_yaml, CHAR_DIR, PERSONA_DIR, WORLD_DIR
    binding = _identity(settings)["library_binding"]
    versions = {}
    for key, directory in (("character_id", CHAR_DIR), ("persona_id", PERSONA_DIR), ("world_id", WORLD_DIR)):
        ref = binding.get("character") if key == "character_id" else None
        if ref and ref["id"] == settings.get(key):
            versions[key] = f"1.0.{ref['revision']}"
        else:
            versions[key] = (_load_yaml(directory, settings.get(key)) or {}).get("version")
    return versions


def _row(row) -> dict:
    d = dict(row)
    if d.get("supported") is not None:
        d["supported"] = bool(d["supported"])
    d["source_message_ids"] = json.loads(d.get("source_message_ids") or "[]")
    return d


async def _log(db, scope: str, op: str, memory_id: str | None = None, generation_id: str | None = None,
               detail: dict | None = None) -> None:
    await db.execute("INSERT INTO memory_events(memory_id,scope,op,generation_id,detail_json) VALUES(?,?,?,?,?)",
                     (memory_id, scope, op, generation_id, json.dumps(detail, ensure_ascii=False) if detail else None))


async def list_memories(scope: str, include_deleted: bool = False) -> list[dict]:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        return await _list_memories(db, scope, include_deleted)


async def _list_memories(db, scope: str, include_deleted: bool = False) -> list[dict]:
    sql = f"SELECT {COLUMNS} FROM memories WHERE scope=?" + ("" if include_deleted else " AND status='active'")
    cursor = await db.execute(sql + " ORDER BY rowid", (scope,))
    cursor.row_factory = aiosqlite.Row
    rows = await cursor.fetchall()
    return [_row(r) for r in rows]


async def conversation_snapshot(db, session_id):
    """Only attributable active memories; never copy another session's shared facts."""
    scope = await (await db.execute('SELECT scope FROM session_scopes WHERE session_id=?', (session_id,))).fetchone()
    cursor = await db.execute(f"SELECT {COLUMNS} FROM memories WHERE status='active' AND "
        "(source_session_id=? OR (source_session_id IS NULL AND scope=?))" + (' AND scope=?' if scope else '') + ' ORDER BY rowid',
        (session_id, 'session:' + session_id) + ((scope[0],) if scope else ()))
    cursor.row_factory = aiosqlite.Row
    return [_row(row) for row in await cursor.fetchall()]


async def get(memory_id: str) -> dict:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute(f"SELECT {COLUMNS} FROM memories WHERE id=?", (memory_id,))).fetchone()
    if not row:
        raise NotFound(memory_id)
    return _row(row)


async def create(scope: str, type_: str, content: str, *, origin: str = "user", supported: bool | None = None,
                 source_session_id: str | None = None, source_turn: int | None = None,
                 source_generation_id: str | None = None, source_kind: str = "user_statement",
                 source_quote: str = "", source_revision: str | None = None) -> dict:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        memory_id = await _create(db, scope, type_, content, origin, supported,
                                  source_session_id, source_turn, source_generation_id,
                                  source_kind=source_kind, source_quote=source_quote or (content if origin == "user" else ""),
                                  source_revision=source_revision or ("manual:1" if origin == "user" else None),
                                  confirmation="user_confirmed" if origin == "user" else "unverified")
        await db.commit()
    return await get(memory_id)


async def _create(db, scope, type_, content, origin, supported,
                  source_session_id, source_turn, source_generation_id, *, source_kind="user_statement",
                  source_quote="", source_revision=None, source_message_ids=None, confirmation="unverified"):
    memory_id = "mem_" + uuid.uuid4().hex[:12]
    await db.execute(
        "INSERT INTO memories(id,scope,type,content,origin,supported,source_session_id,source_turn,source_generation_id,"
        "source_kind,source_quote,source_revision,source_message_ids,confirmation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (memory_id, scope, type_, content, origin, None if supported is None else int(supported),
         source_session_id, source_turn, source_generation_id, source_kind, source_quote[:2000], source_revision,
         json.dumps(source_message_ids or []), confirmation))
    await _log(db, scope, "create", memory_id, source_generation_id,
               {"type": type_, "content": content, "origin": origin})
    return memory_id


async def update(memory_id: str, *, content: str | None = None, type_: str | None = None) -> dict:
    before = await get(memory_id)
    if before["status"] != "active":
        raise NotFound(memory_id)
    after = {"content": content if content is not None else before["content"],
             "type": type_ if type_ is not None else before["type"]}
    if after["content"] == before["content"] and after["type"] == before["type"]:
        return before
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("UPDATE memories SET content=?, type=?, version=version+1, origin=CASE WHEN origin='model' "
                         "THEN 'model_edited' ELSE origin END, source_kind='user_correction',confirmation='user_confirmed', "
                         "supported=NULL,source_quote=?,source_revision=?, updated_at=datetime('now') WHERE id=?",
                         (after["content"], after["type"], after["content"], f"manual:{before['version'] + 1}", memory_id))
        await _log(db, before["scope"], "update", memory_id, None,
                   {"before": {"content": before["content"], "type": before["type"], "version": before["version"]},
                    "after": after})
        await db.commit()
    return await get(memory_id)


async def delete(memory_id: str) -> dict:
    before = await get(memory_id)
    if before["status"] != "active":
        raise NotFound(memory_id)
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("UPDATE memories SET status='deleted', updated_at=datetime('now') WHERE id=?", (memory_id,))
        await _log(db, before["scope"], "delete", memory_id, None, {"content": before["content"]})
        await db.commit()
    return await get(memory_id)


async def events(*, memory_id: str | None = None, scope: str | None = None, limit: int = 200) -> list[dict]:
    await init()
    where, args = ("memory_id=?", (memory_id,)) if memory_id else ("scope=?", (scope,))
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute(
            f"SELECT id, memory_id, scope, op, generation_id, detail_json, created_at FROM memory_events "
            f"WHERE {where} ORDER BY id DESC LIMIT ?", (*args, limit))).fetchall()
    return [{**{k: r[k] for k in r.keys() if k != "detail_json"},
             "detail": json.loads(r["detail_json"]) if r["detail_json"] else None} for r in rows]


async def record_use(scope: str, generation_id: str | None, trace: dict) -> None:
    """Log one retrieval (all candidates) and mark injected memories as accessed."""
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await _record_use(db, scope, generation_id, trace)
        await db.commit()


async def _record_use(db, scope, generation_id, trace):
    await _log(db, scope, "retrieve", None, generation_id,
               {"candidates": [{k: c[k] for k in ("id", "score", "decision")} for c in trace["candidates"]],
                "injected_tokens": trace["injected_tokens"], "retrieval_ms": trace.get("retrieval_ms")})
    for memory_id in trace["injected"]:
        await db.execute("UPDATE memories SET access_count=access_count+1, last_accessed=datetime('now') WHERE id=?",
                         (memory_id,))
        await _log(db, scope, "inject", memory_id, generation_id, None)


async def session_enabled(session_id: str) -> bool:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        row = await (await db.execute("SELECT enabled FROM session_memory WHERE session_id=?", (session_id,))).fetchone()
    return bool(row and row[0])


async def set_session_enabled(session_id: str, enabled: bool) -> None:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("INSERT INTO session_memory(session_id,enabled) VALUES(?,?) ON CONFLICT(session_id) "
                         "DO UPDATE SET enabled=excluded.enabled, updated_at=datetime('now')", (session_id, int(enabled)))
        await db.commit()


async def scopes() -> list[dict]:
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        rows = await (await db.execute(
            "SELECT scope, SUM(status='active'), COUNT(*), MAX(updated_at) FROM memories GROUP BY scope "
            "ORDER BY MAX(updated_at) DESC")).fetchall()
    return [{"scope": r[0], "active": r[1], "total": r[2], "updated_at": r[3]} for r in rows]


# ── turn helpers used by chat and experiments ────────────────────────────

async def prepare(scope: str, query: str, *, exclude_after: tuple[str, int] | None = None, **options) -> dict:
    """Retrieve for one turn: the prompt block plus the full ranking trace."""
    import time

    from python.core import memory as logic
    start = time.perf_counter()
    items = await list_memories(scope)
    if exclude_after:
        async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
            ids = {r[0] for r in await (await db.execute(
                "SELECT generation_id FROM generations WHERE session_id=? AND (assistant_id>=? OR user_id>=?)",
                (exclude_after[0], exclude_after[1], exclude_after[1]))).fetchall()}
        items = [m for m in items if m.get("source_generation_id") not in ids]
    trace = logic.retrieve(items, query, **options)
    trace["retrieval_ms"] = round((time.perf_counter() - start) * 1000, 2)
    trace["scope"] = scope
    trace["stored_count"] = len(items)
    by_id = {m["id"]: m for m in items}
    return {"block": logic.render_block([by_id[i] for i in trace["injected"]]), "trace": trace}


async def commit(scope: str, result: dict, *, session_id: str | None, turn: int | None,
                 evidence_text: str, db: aiosqlite.Connection | None = None,
                 source_message_ids: list[int] | None = None, source_revision: str | None = None) -> None:
    """After a turn: log retrieval, mark evidenced memories, validate and store proposals.

    Mutates ``result["memory"]`` so the persisted generation record carries every decision.
    When db is supplied, ALL reads/writes use the caller's transaction; never commit it here.
    """
    from python.core import memory as logic
    trace = result.get("memory")
    if not trace:
        return
    if db is None:
        await init()
        with anyio.CancelScope(shield=True):
            async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as own:
                await own.execute("BEGIN IMMEDIATE")
                await commit(scope, result, session_id=session_id, turn=turn,
                             evidence_text=evidence_text, db=own, source_message_ids=source_message_ids,
                             source_revision=source_revision)
                await own.commit()
        return
    generation_id = result.get("generation_id")
    await _record_use(db, scope, generation_id, trace)
    injected = {c["id"]: c["content"] for c in trace.get("candidates", []) if c.get("decision") in logic.INJECTED}
    trace["evidenced"] = [i for i, content in injected.items() if logic.evidenced(content, result.get("reply", ""))]
    decisions = []
    if result.get("status") == "completed" and trace.get("proposals"):
        proposals = [logic.MemoryProposal.model_validate(p) for p in trace["proposals"]]
        decisions = logic.validate_proposals(proposals, await _list_memories(db, scope), evidence_text)
        for d in decisions:
            if d["action"] == "store":
                kind = d.get("source_kind", "user_statement")
                quote = evidence_text
                supported = d["supported"]
                if kind == "story_event":
                    quote = result.get("reply", "")
                    supported = logic.evidenced(d["content"], quote)
                # Work canon is not verified by model text; only an explicit editor can confirm it.
                if kind == "work_setting":
                    supported = False
                d.update(source_kind=kind, supported=supported, confirmation="unverified", source_quote=quote[:2000],
                         source_revision=source_revision)
                d["memory_id"] = await _create(db, scope, d["type"], d["content"], "model", d["supported"],
                                                session_id, turn, generation_id, source_kind=kind, source_quote=quote,
                                                source_revision=source_revision,
                                                source_message_ids=(source_message_ids[-1:] if kind == "story_event" else source_message_ids[:1]) if source_message_ids else [])
    trace["decisions"] = decisions


async def invalidate(db, session_id, message_id=0):
    """Invalidate memories and traces from edited turns before replacement memory commit."""
    ids = [r[0] for r in await (await db.execute(
        "SELECT generation_id FROM generations WHERE session_id=? AND (assistant_id>=? OR user_id>=?)",
        (session_id, message_id, message_id))).fetchall()]
    for generation_id in ids:
        affected = await (await db.execute("SELECT id,scope FROM memories WHERE source_generation_id=? AND status='active'", (generation_id,))).fetchall()
        await db.execute("UPDATE memories SET status='deleted' WHERE source_generation_id=?", (generation_id,))
        await db.execute("DELETE FROM memory_events WHERE generation_id=?", (generation_id,))
        for memory_id, scope in affected:
            await _log(db, scope, "invalidate", memory_id, None, {"session_id": session_id, "message_id": message_id})


async def scope_preview(settings):
    await init()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        row = await (await db.execute("SELECT scope,identity_json FROM session_scopes WHERE session_id=?", (settings["session_id"],))).fetchone()
    current = row[0] if row else await session_scope(settings)
    identity = _identity(settings)
    identity["versions"] = _asset_versions(settings)
    target = "work:" + hashlib.sha256(json.dumps(identity, ensure_ascii=False, sort_keys=True).encode()).hexdigest() if settings.get("character_id") else f"session:{settings['session_id']}"
    items = await list_memories(current)
    return {"scope": current, "target_scope": target, "memories": items,
            "preview_revision": _preview_digest(current, items, identity), "identity": identity,
            "previous_identity": json.loads(row[1]) if row else identity}


def _preview_digest(scope, items, identity):
    return hashlib.sha256(json.dumps([scope, items, identity], sort_keys=True).encode()).hexdigest()


async def migrate_scope(settings, expected_revision, share=False):
    preview = await scope_preview(settings)
    from .generations import transaction, Conflict
    sid = settings["session_id"]
    async with transaction() as db:
        current = await _list_memories(db, preview["scope"])
        digest = _preview_digest(preview["scope"], current, preview["identity"])
        if digest != expected_revision:
            raise Conflict("memory changed; preview migration again")
        if await (await db.execute("SELECT 1 FROM generations WHERE session_id=? AND status='pending'", (sid,))).fetchone():
            raise Conflict("stop generation before migrating memory")
        target = chat_scope(settings.get("character_id"), settings.get("persona_id"), sid) if share else preview["target_scope"]
        if target != preview["scope"]:
            existing = {(m["content"], m["type"], m["source_kind"], m["source_generation_id"]) for m in await _list_memories(db, target)}
            copied = 0
            for memory in current:
                key = (memory["content"], memory["type"], memory["source_kind"], memory["source_generation_id"])
                if key in existing:
                    continue
                source_session_id = memory["source_session_id"]
                if source_session_id is None and preview["scope"] == f"session:{sid}":
                    source_session_id = sid
                await _create(db, target, memory["type"], memory["content"], memory["origin"], memory["supported"],
                              source_session_id, memory["source_turn"], memory["source_generation_id"],
                              source_kind=memory["source_kind"], source_quote=memory["source_quote"],
                              source_revision=memory["source_revision"], source_message_ids=memory["source_message_ids"],
                              confirmation=memory["confirmation"])
                existing.add(key)
                copied += 1
        await db.execute("UPDATE session_scopes SET scope=?,mode=?,identity_json=? WHERE session_id=?",
                         (target, "shared" if share else "world", json.dumps(preview["identity"]), sid))
    return {"scope": target, "copied": copied if target != preview["scope"] else 0}
