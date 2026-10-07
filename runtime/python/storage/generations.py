"""Atomic generation reservations, durable state and backward-compatible history."""
from python.storage.context import get_db_path
import hashlib
import json
from contextlib import asynccontextmanager
import aiosqlite
import anyio

from . import db as storage
from python.core.schemas import RuntimeState


class Conflict(Exception):
    pass


def fingerprint(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@asynccontextmanager
async def transaction():
    """Serialize finish/cancel and protect SQLite commit/rollback/close from SSE cancellation."""
    with anyio.CancelScope(shield=True):
        async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
            await db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                await db.commit()
            except BaseException:
                await db.rollback()
                raise


async def reserve(generation_id: str, session_id: str, body: dict):
    await storage.init_db()
    digest = fingerprint(body)
    async with transaction() as db:
        db.row_factory = aiosqlite.Row
        row = await (await db.execute("SELECT * FROM generations WHERE generation_id=?", (generation_id,))).fetchone()
        if row:
            if row["session_id"] != session_id or row["fingerprint"] != digest or not row["valid"]:
                raise Conflict("generation_id belongs to a different or edited request")
            if row["status"] == "pending":
                raise Conflict("generation is already running")
            return json.loads(row["result_json"] or "{}")
        try:
            await db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status) VALUES(?,?,?,'pending')",
                             (generation_id, session_id, digest))
        except aiosqlite.IntegrityError as exc:
            raise Conflict("another generation is running in this session") from exc
    return None


async def load_state(session_id: str, settings: dict) -> RuntimeState:
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        row = await (await db.execute("SELECT state_json FROM runtime_states WHERE session_id=?", (session_id,))).fetchone()
        if row:
            state = RuntimeState.model_validate_json(row[0])
        else:
            state = RuntimeState(session_id=session_id)
        for key in ("character_id", "persona_id", "world_id"):
            setattr(state, key, settings.get(key))
        # Reading/preparing a turn must not change durable state. Only finish may
        # advance it, atomically with history and memories.
        return state


async def finish(generation_id: str, result: dict, user: dict | None, model_id: str,
                 *, memory_scope: str | None = None, memory_turn: int | None = None,
                 evidence_text: str = "", cloud_revision: tuple | None = None):
    async with transaction() as db:
        if cloud_revision:
            await db.execute("ATTACH DATABASE ? AS control", (str(cloud_revision[0]),))
        row = await (await db.execute("SELECT session_id,status,result_json FROM generations WHERE generation_id=?", (generation_id,))).fetchone()
        if not row:
            raise Conflict("generation not reserved")
        if row[1] != "pending":
            # Cancellation or a prior finish already won. Never overwrite it or
            # return an uncommitted provider reply as a successful SSE result.
            return json.loads(row[2] or "{}")
        sid = row[0]
        if memory_scope is not None:
            from . import memories
            await memories.commit(memory_scope, result, session_id=sid, turn=memory_turn,
                                  evidence_text=evidence_text, db=db)
        user_id = assistant_id = None
        save_reply = result["status"] == "completed" or (result["status"] == "invalid" and result.get("reply") and result.get("mode") == "immersion")
        if save_reply:
            replacement = result.get("replace_message_id")
            if replacement:
                await db.execute("UPDATE generations SET valid=0 WHERE session_id=? AND assistant_id>=?", (sid, replacement))
                await db.execute("UPDATE chat_history SET content=?,model_id=? WHERE id=? AND session_id=?", (result["reply"], model_id, replacement, sid))
                assistant_id = replacement
                if result["status"] != "completed":
                    await db.execute("UPDATE runtime_states SET state_json=? WHERE session_id=?", (json.dumps(result["state_before"]), sid))
            elif user:
                cur = await db.execute("INSERT INTO chat_history(session_id,role,content,model_id) VALUES(?,?,?,?)",
                                       (sid, "user", user["content"], model_id))
                user_id = cur.lastrowid
            if not replacement:
                cur = await db.execute("INSERT INTO chat_history(session_id,role,content,model_id) VALUES(?,?,?,?)",
                                       (sid, "assistant", result["reply"], model_id))
                assistant_id = cur.lastrowid
        if result["status"] == "completed":
            await db.execute("INSERT INTO runtime_states VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json",
                             (sid, json.dumps(result["state"], ensure_ascii=False)))
        result.update(generation_id=generation_id, session_id=sid, user_id=user_id, assistant_id=assistant_id)
        await db.execute("UPDATE generations SET status=?,result_json=?,user_id=?,assistant_id=? WHERE generation_id=?",
                         (result["status"], json.dumps(result, ensure_ascii=False), user_id, assistant_id, generation_id))
        if cloud_revision and result["status"] == "completed":
            await db.execute("INSERT INTO control.sync_heads VALUES(?,'workspace',1,0,'{}') ON CONFLICT(owner,id) DO UPDATE SET revision=revision+1,deleted=0", (cloud_revision[1],))
    return result


async def invalidate(db, session_id: str, message_id: int = 0):
    active = await (await db.execute("SELECT 1 FROM generations WHERE session_id=? AND status='pending'", (session_id,))).fetchone()
    if active:
        raise Conflict("stop generation before editing history")
    await db.execute("UPDATE generations SET valid=0 WHERE session_id=? AND (assistant_id>=? OR user_id>=?)",
                     (session_id, message_id, message_id))
    row = await (await db.execute("SELECT result_json FROM generations WHERE session_id=? AND valid=1 AND status='completed' AND assistant_id<? ORDER BY assistant_id DESC LIMIT 1",
                                 (session_id, message_id))).fetchone()
    state = json.loads(row[0])["state"] if row else RuntimeState(session_id=session_id).model_dump()
    await db.execute("INSERT INTO runtime_states VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json",
                     (session_id, json.dumps(state, ensure_ascii=False)))


async def latest(session_id: str):
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        row = await (await db.execute("SELECT result_json,valid FROM generations WHERE session_id=? AND status!='pending' ORDER BY rowid DESC LIMIT 1", (session_id,))).fetchone()
        if not row:
            return None
        return {**json.loads(row[0] or "{}"), "snapshot_valid": bool(row[1])}


async def state_before(session_id: str, message_id: int, settings: dict):
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        row = await (await db.execute("SELECT result_json FROM generations WHERE session_id=? AND assistant_id=? AND valid=1 ORDER BY rowid DESC LIMIT 1", (session_id, message_id))).fetchone()
    state = RuntimeState.model_validate(json.loads(row[0])["state_before"]) if row else RuntimeState(session_id=session_id)
    for key in ("character_id", "persona_id", "world_id"):
        setattr(state, key, settings.get(key))
    return state


async def recover_interrupted():
    """Called once at application startup, never on each request."""
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        await db.execute("UPDATE generations SET status='cancelled',result_json=? WHERE status='pending'",
                         (json.dumps({"status": "cancelled", "error": "runtime restarted", "reply": ""}),))
        await db.commit()


async def cancel_pending(generation_id: str, *, attempts: list | None = None):
    """Response cleanup only: never create a reservation or overwrite a terminal result."""
    async with transaction() as db:
        await db.execute("UPDATE generations SET status='cancelled',result_json=? WHERE generation_id=? AND status='pending'",
                         (json.dumps({"generation_id": generation_id, "status": "cancelled", "reply": "",
                                      "error": "generation interrupted", "attempts": attempts or []}), generation_id))


async def _status(db, generation_id: str, session_id: str):
    row = await (await db.execute(
        "SELECT session_id,status,user_id,assistant_id FROM generations WHERE generation_id=?", (generation_id,))).fetchone()
    if row and row[0] != session_id:
        raise Conflict("generation_id belongs to a different session")
    return {"generation_id": generation_id, "session_id": session_id,
            "status": row[1] if row else "not_found", "user_id": row[2] if row else None,
            "assistant_id": row[3] if row else None}


async def status(generation_id: str, session_id: str):
    """Public recovery snapshot; never expose prompts, memory traces or provider details."""
    await storage.init_db()
    async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
        return await _status(db, generation_id, session_id)


async def cancel(generation_id: str, session_id: str):
    """Explicit Stop fences late POSTs too. A missing ID gets a durable tombstone.

    BEGIN IMMEDIATE arbitrates with reserve/finish: whichever commits first wins.
    Existing terminal outcomes (including completed replies) are preserved.
    """
    await storage.init_db()
    async with transaction() as db:
        current = await _status(db, generation_id, session_id)
        result = json.dumps({"generation_id": generation_id, "session_id": session_id,
                             "status": "cancelled", "reply": "", "error": "cancelled by user"})
        if current["status"] == "not_found":
            await db.execute(
                "INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json,valid) "
                "VALUES(?,?,'','cancelled',?,0)", (generation_id, session_id, result))
        elif current["status"] == "pending":
            await db.execute("UPDATE generations SET status='cancelled',result_json=? WHERE generation_id=?",
                             (result, generation_id))
        return await _status(db, generation_id, session_id)
