"""Source-linked extractive summaries and optimistic stored conversation context.

No provider calls: extractive summaries are bounded excerpts, not semantic summaries.
All generation side effects use the caller's finish transaction.
"""
import hashlib
import json
import uuid
from copy import deepcopy

import aiosqlite

from . import db as storage, generations
from .context import get_db_path

CHAPTER_MESSAGES = 20
ARC_CHAPTERS = 10
SUMMARY_CHARS = 4000
CONTEXT_BYTES = 50000


async def _history(db, session_id):
    db.row_factory = aiosqlite.Row
    rows = await (await db.execute(
        "SELECT id,role,content,model_id FROM chat_history WHERE session_id=? ORDER BY id",
        (session_id,))).fetchall()
    return [dict(row) for row in rows]


def _summary(row):
    return {"id": row[0], "kind": row[1], "text": row[2], "revision": str(row[3]),
            "source_message_ids": json.loads(row[4]), "method": row[5]}


async def _summaries(db, session_id):
    rows = await (await db.execute(
        "SELECT id,kind,text,revision,source_message_ids,method FROM conversation_summaries "
        "WHERE session_id=? ORDER BY kind,ordinal", (session_id,))).fetchall()
    return [_summary(row) for row in rows]


async def _revision(db, session_id):
    settings = await (await db.execute("SELECT system_prompt,temperature,character_id,persona_id,world_id,intro,library_binding "
                                      "FROM session_settings WHERE session_id IN (?, '__global__') ORDER BY CASE WHEN session_id=? THEN 0 ELSE 1 END LIMIT 1",
                                      (session_id, session_id))).fetchone()
    state = await (await db.execute("SELECT state_json FROM runtime_states WHERE session_id=?", (session_id,))).fetchone()
    payload = [await _history(db, session_id), await _summaries(db, session_id),
               list(settings) if settings else None, state[0] if state else None]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


async def revision(session_id: str) -> str:
    await storage.init_db()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        return await _revision(db, session_id)


async def context(session_id: str) -> dict:
    await storage.init_db()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("BEGIN")
        scope = await (await db.execute("SELECT scope FROM session_scopes WHERE session_id=?", (session_id,))).fetchone()
        return {"history_revision": await _revision(db, session_id), "summaries": await _summaries(db, session_id),
                **({"scope": scope[0]} if scope else {}),
                "summary_policy": {"chapter_messages": CHAPTER_MESSAGES, "arc_chapters": ARC_CHAPTERS,
                                   "method": "extractive", "additional_api_cost": 0}}


def _extract(messages):
    # shortcut: per-message excerpts lose detail; use an explicitly priced semantic summarizer when authorized.
    if not messages:
        return ""
    quota = max(1, (SUMMARY_CHARS - len(messages) * 24) // len(messages))
    lines = []
    for message in messages:
        text = message["content"]
        excerpt = text if len(text) <= quota else text[:quota] + "… [excerpt]"
        lines.append(f"[{message['id']}:{message['role']}] {excerpt}")
    return "\n".join(lines)[:SUMMARY_CHARS]


async def refresh(db, session_id):
    """Create only closed milestones; preserve user-edited summaries of unchanged sources."""
    history = await _history(db, session_id)
    chapters = []
    for ordinal in range(len(history) // CHAPTER_MESSAGES):
        source = history[ordinal * CHAPTER_MESSAGES:(ordinal + 1) * CHAPTER_MESSAGES]
        ids = [m["id"] for m in source]
        await _put_extract(db, session_id, "chapter", ordinal, ids, _extract(source))
        chapters.append(ids)
    for ordinal in range(len(chapters) // ARC_CHAPTERS):
        ids = sum(chapters[ordinal * ARC_CHAPTERS:(ordinal + 1) * ARC_CHAPTERS], [])
        chapter_rows = await (await db.execute(
            "SELECT id,text FROM conversation_summaries WHERE session_id=? AND kind='chapter' "
            "AND ordinal>=? AND ordinal<? ORDER BY ordinal",
            (session_id, ordinal * ARC_CHAPTERS, (ordinal + 1) * ARC_CHAPTERS))).fetchall()
        # Arc text comes from editable chapters; source IDs still refer to original messages.
        text = _extract([{"id": row[0], "role": "chapter", "content": row[1]} for row in chapter_rows])
        await _put_extract(db, session_id, "arc", ordinal, ids, text)


async def _put_extract(db, sid, kind, ordinal, ids, text):
    old = await (await db.execute(
        "SELECT id,source_message_ids,text,method FROM conversation_summaries WHERE session_id=? AND kind=? AND ordinal=?",
        (sid, kind, ordinal))).fetchone()
    encoded = json.dumps(ids)
    if old and old[1] == encoded:
        if kind == "arc" and old[3] == "extractive" and old[2] != text:
            await db.execute("UPDATE conversation_summaries SET text=?,revision=revision+1 WHERE id=?", (text, old[0]))
        return
    await db.execute(
        "INSERT INTO conversation_summaries VALUES(?,?,?, ?,1,?,'extractive',?) "
        "ON CONFLICT(session_id,kind,ordinal) DO UPDATE SET text=excluded.text,source_message_ids=excluded.source_message_ids,"
        "revision=revision+1,method='extractive'",
        ("sum_" + uuid.uuid4().hex, sid, kind, text, encoded, ordinal))


async def resolve_messages(session_id: str, messages: list[dict], regenerate_message_id: int | None = None,
                           history_revision: str | None = None) -> list[dict]:
    await storage.init_db()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("BEGIN")
        current = await _revision(db, session_id)
        if history_revision is None or history_revision != current:
            raise generations.Conflict("history changed; reload conversation context before generation")
        history = await _history(db, session_id)
        summaries = await _summaries(db, session_id)
    if not messages or messages[-1].get("role") != "user":
        raise ValueError("stored context requires the latest user message")
    if regenerate_message_id is not None:
        if not history or history[-1]["id"] != regenerate_message_id or history[-1]["role"] != "assistant":
            raise generations.Conflict("only the latest assistant can be regenerated")
        history = history[:-1]
        if not history or history[-1]["role"] != "user" or history[-1]["content"] != messages[-1]["content"]:
            raise generations.Conflict("regeneration user message differs from stored history")
        history = history[:-1]
    recent = history[-CHAPTER_MESSAGES:]
    boundary = recent[0]["id"] if recent else 0
    covered = set()
    selected = []
    for kind in ("arc", "chapter"):
        for summary in summaries:
            ids = set(summary["source_message_ids"])
            if summary["kind"] == kind and ids and max(ids) < boundary and not ids & covered:
                selected.append({"role": "system", "content":
                    f"Conversation {kind} ({summary['method']}; source-linked excerpts, may omit detail):\n{summary['text']}"})
                covered |= ids
    # Preserve uncovered boundary messages instead of silently dropping a partial chapter.
    remaining = [m for m in history if m["id"] not in covered]
    resolved = selected + [{"role": m["role"], "content": m["content"]} for m in remaining] + [messages[-1]]
    if len(json.dumps(resolved, ensure_ascii=False).encode()) > CONTEXT_BYTES:
        raise ValueError("stored conversation exceeds context budget; edit summaries or explicitly branch")
    return resolved


async def edit_summary(session_id, summary_id, text, expected_revision):
    await storage.init_db()
    async with generations.transaction() as db:
        await _assert_idle(db, session_id)
        row = await (await db.execute("SELECT revision FROM conversation_summaries WHERE id=? AND session_id=?",
                                     (summary_id, session_id))).fetchone()
        if not row:
            raise LookupError("summary not found")
        if str(row[0]) != str(expected_revision):
            raise generations.Conflict("summary changed; reload before editing")
        await db.execute("UPDATE conversation_summaries SET text=?,revision=revision+1,method='user_edited' WHERE id=?",
                         (text, summary_id))
        await refresh(db, session_id)
    return await context(session_id)


async def _assert_idle(db, sid):
    if await (await db.execute("SELECT 1 FROM generations WHERE session_id=? AND status='pending'", (sid,))).fetchone():
        raise generations.Conflict("stop generation before changing conversation")


async def invalidate(db, session_id, message_id):
    rows = await (await db.execute("SELECT id,source_message_ids FROM conversation_summaries WHERE session_id=?",
                                  (session_id,))).fetchall()
    for row in rows:
        if any(i >= message_id for i in json.loads(row[1])):
            await db.execute("DELETE FROM conversation_summaries WHERE id=?", (row[0],))


def erase_memory_references(result, memory_ids, *, source_session_ids=()):
    """Remove deleted source snapshots from other conversations without deleting their replies."""
    trace = result.get("memory") or {}
    source_session_ids = set(source_session_ids)
    candidates = trace.get("candidates", [])
    deleted_sources = [c for c in candidates if c.get("source_session_id") in source_session_ids]
    # Memory rows may already have been physically cleared. Their source survives
    # in saved retrieval candidates and still identifies snapshots to erase.
    memory_ids = set(memory_ids) | {c["id"] for c in deleted_sources if c.get("id") is not None}
    references = {c.get("id") for c in trace.get("candidates", [])} | {c.get("memory_id") for c in trace.get("decisions", [])}
    references |= set(trace.get("injected", [])) | set(trace.get("evidenced", []))
    if not deleted_sources and not references & memory_ids:
        return result
    result = deepcopy(result)
    trace = result["memory"]
    trace["candidates"] = [c for c in trace.get("candidates", [])
                           if c.get("id") not in memory_ids and c.get("source_session_id") not in source_session_ids]
    trace["decisions"] = [c for c in trace.get("decisions", []) if c.get("memory_id") not in memory_ids]
    for key in ("injected", "evidenced"):
        trace[key] = [i for i in trace.get(key, []) if i not in memory_ids]
    # Raw prompts/attempts may contain injected source quotes without a memory ID beside them.
    for key in ("compiled", "raw_prompt", "attempts"):
        result.pop(key, None)
    return result


async def purge(session_id, *, cloud_revision=None):
    await storage.init_db()
    async with generations.transaction() as db:
        if cloud_revision:
            await db.execute("ATTACH DATABASE ? AS control", (str(cloud_revision[0]),))
        # A pending generation may hold source quotes in RAM after the memory
        # rows were cleared. Fence the whole DB inside this write transaction;
        # durable scope/source rows cannot prove that another task is unrelated.
        if await (await db.execute("SELECT 1 FROM generations WHERE status='pending' LIMIT 1")).fetchone():
            raise generations.Conflict("stop all generations before deleting conversation data")
        await db.execute("PRAGMA secure_delete=ON")
        memory_ids = [r[0] for r in await (await db.execute(
            "SELECT id FROM memories WHERE source_session_id=? OR scope=?", (session_id, f"session:{session_id}"))).fetchall()]
        rows = await (await db.execute("SELECT generation_id,result_json FROM generations WHERE session_id<>? AND result_json IS NOT NULL",
                                      (session_id,))).fetchall()
        for row in rows:
            original = json.loads(row[1])
            redacted = erase_memory_references(original, memory_ids, source_session_ids={session_id})
            if redacted is not original:
                await db.execute("UPDATE generations SET result_json=? WHERE generation_id=?",
                                 (json.dumps(redacted, ensure_ascii=False), row[0]))
        for memory_id in memory_ids:
            await db.execute("DELETE FROM memory_events WHERE memory_id=?", (memory_id,))
            await db.execute("DELETE FROM memories WHERE id=?", (memory_id,))
        await db.execute("DELETE FROM memory_events WHERE generation_id IN (SELECT generation_id FROM generations WHERE session_id=?)",
                         (session_id,))
        await db.execute("DELETE FROM imported_history WHERE message_id IN (SELECT id FROM chat_history WHERE session_id=?)", (session_id,))
        for table in ("chat_history", "generations", "runtime_states", "conversation_summaries", "session_settings", "session_memory", "session_scopes"):
            await db.execute(f"DELETE FROM {table} WHERE session_id=?", (session_id,))
        # Cloud sync/restore must carry this tombstone so old backups cannot resurrect conversation data.
        await db.execute("INSERT OR REPLACE INTO session_deletions(session_id) VALUES(?)", (session_id,))
        if cloud_revision:
            await db.execute("CREATE TABLE IF NOT EXISTS control.conversation_erasures(owner TEXT,hash TEXT,PRIMARY KEY(owner,hash))")
            await db.execute("INSERT OR IGNORE INTO control.conversation_erasures VALUES(?,?)",
                             (cloud_revision[1], hashlib.sha256(session_id.encode()).hexdigest()))
            await db.execute("INSERT INTO control.sync_heads VALUES(?,'workspace',1,0,'{}') "
                             "ON CONFLICT(owner,id) DO UPDATE SET revision=revision+1,deleted=0", (cloud_revision[1],))
    return {"ok": True, "session_id": session_id, "deleted": True, "backup_policy": "tombstone_required_on_restore"}


async def branch(session_id, message_id):
    await storage.init_db()
    new_id = "branch_" + uuid.uuid4().hex
    async with generations.transaction() as db:
        await _assert_idle(db, session_id)
        history = await _history(db, session_id)
        if message_id not in {m["id"] for m in history}:
            raise LookupError("message not found")
        mapping = {}
        for message in history:
            if message["id"] > message_id:
                break
            cur = await db.execute("INSERT INTO chat_history(session_id,role,content,model_id) VALUES(?,?,?,?)",
                                   (new_id, message["role"], message["content"], message["model_id"]))
            mapping[message["id"]] = cur.lastrowid
        await db.execute("INSERT INTO session_settings(session_id,system_prompt,temperature,extra_json,updated_at,character_id,persona_id,world_id,intro,library_binding) "
                         "SELECT ?,system_prompt,temperature,extra_json,updated_at,character_id,persona_id,world_id,intro,library_binding "
                         "FROM session_settings WHERE session_id=?", (new_id, session_id))
        state_row = await (await db.execute("SELECT result_json FROM generations WHERE session_id=? AND valid=1 "
                                           "AND status='completed' AND assistant_id<=? ORDER BY assistant_id DESC LIMIT 1",
                                           (session_id, message_id))).fetchone()
        from python.core.schemas import RuntimeState
        state = json.loads(state_row[0])["state"] if state_row else RuntimeState().model_dump()
        state["session_id"] = new_id
        await db.execute("INSERT INTO runtime_states VALUES(?,?)", (new_id, json.dumps(state, ensure_ascii=False)))
        generation_map = {}
        rows = await (await db.execute("SELECT generation_id,result_json,user_id,assistant_id FROM generations "
                                      "WHERE session_id=? AND valid=1 AND status='completed' AND assistant_id<=? ORDER BY assistant_id",
                                      (session_id, message_id))).fetchall()
        for row in rows:
            copied_id = "branch_gen_" + uuid.uuid4().hex
            generation_map[row[0]] = copied_id
            result = json.loads(row[1])
            for key in ("state", "state_before"):
                if key in result:
                    result[key]["session_id"] = new_id
            result.update(session_id=new_id, generation_id=copied_id, user_id=mapping.get(row[2]), assistant_id=mapping.get(row[3]))
            # Branch metadata contains only committed predecessor snapshots.
            result.pop("replace_message_id", None)
            await db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json,user_id,assistant_id) "
                             "VALUES(?,?,'','completed',?,?,?)", (copied_id, new_id, json.dumps(result, ensure_ascii=False),
                                                                mapping.get(row[2]), mapping.get(row[3])))
        scope_row = await (await db.execute("SELECT scope,identity_json FROM session_scopes WHERE session_id=?", (session_id,))).fetchone()
        new_scope = f"session:{new_id}"
        await db.execute("INSERT INTO session_scopes VALUES(?,?,'branch',?)", (new_id, new_scope, scope_row[1] if scope_row else "{}"))
        await db.execute("INSERT INTO session_memory SELECT ?,enabled,updated_at FROM session_memory WHERE session_id=?", (new_id, session_id))
        if scope_row:
            from . import memories
            for memory in await memories._list_memories(db, scope_row[0]):
                ids = memory.get("source_message_ids", [])
                if memory["source_session_id"] == session_id and ids and max(ids) <= message_id:
                    await memories._create(db, new_scope, memory["type"], memory["content"], memory["origin"], memory["supported"],
                                           new_id, memory["source_turn"], generation_map.get(memory["source_generation_id"]), source_kind=memory["source_kind"],
                                           source_quote=memory["source_quote"], source_revision=memory["source_revision"],
                                           source_message_ids=[mapping[i] for i in ids if i in mapping], confirmation=memory["confirmation"])
        rows = await (await db.execute("SELECT kind,text,revision,source_message_ids,method,ordinal FROM conversation_summaries WHERE session_id=?",
                                      (session_id,))).fetchall()
        for row in rows:
            ids = json.loads(row[3])
            if ids and all(i in mapping for i in ids):
                text = row[1]
                if row[4] == "extractive":
                    import re
                    text = re.sub(r"\[(\d+):", lambda m: f"[{mapping.get(int(m[1]), int(m[1]))}:", text)
                await db.execute("INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,?)",
                                 ("sum_" + uuid.uuid4().hex, new_id, row[0], text, row[2],
                                  json.dumps([mapping[i] for i in ids]), row[4], row[5]))
        await refresh(db, new_id)
    return {"session_id": new_id}
