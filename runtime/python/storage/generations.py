"""Atomic generation reservations, durable state and backward-compatible history."""
import hashlib
import json
import aiosqlite

from . import db as storage
from python.core.schemas import RuntimeState


class Conflict(Exception):
    pass


def fingerprint(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def reserve(generation_id: str, session_id: str, body: dict):
    await storage.init_db()
    digest = fingerprint(body)
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        db.row_factory = aiosqlite.Row
        row = await (await db.execute("SELECT * FROM generations WHERE generation_id=?", (generation_id,))).fetchone()
        if row:
            if row["fingerprint"] != digest or not row["valid"]:
                raise Conflict("generation_id belongs to a different or edited request")
            if row["status"] == "pending":
                raise Conflict("generation is already running")
            return json.loads(row["result_json"] or "{}")
        try:
            await db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status) VALUES(?,?,?,'pending')",
                             (generation_id, session_id, digest))
        except aiosqlite.IntegrityError as exc:
            raise Conflict("another generation is running in this session") from exc
        await db.commit()
    return None


async def load_state(session_id: str, settings: dict) -> RuntimeState:
    async with aiosqlite.connect(storage.DB_PATH) as db:
        row = await (await db.execute("SELECT state_json FROM runtime_states WHERE session_id=?", (session_id,))).fetchone()
        if row:
            state = RuntimeState.model_validate_json(row[0])
        else:
            state = RuntimeState(session_id=session_id)
        for key in ("character_id", "persona_id", "world_id"):
            setattr(state, key, settings.get(key))
        await db.execute("INSERT INTO runtime_states VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json",
                         (session_id, state.model_dump_json()))
        await db.commit()
        return state


async def finish(generation_id: str, result: dict, user: dict | None, model_id: str):
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("BEGIN IMMEDIATE")
        row = await (await db.execute("SELECT session_id,status FROM generations WHERE generation_id=?", (generation_id,))).fetchone()
        if not row or row[1] != "pending":
            raise Conflict("generation no longer pending")
        sid = row[0]
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
        await db.execute("UPDATE generations SET status=?,result_json=?,user_id=?,assistant_id=? WHERE generation_id=?",
                         (result["status"], json.dumps(result, ensure_ascii=False), user_id, assistant_id, generation_id))
        await db.commit()


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
    async with aiosqlite.connect(storage.DB_PATH) as db:
        row = await (await db.execute("SELECT result_json,valid FROM generations WHERE session_id=? AND status!='pending' ORDER BY rowid DESC LIMIT 1", (session_id,))).fetchone()
        if not row:
            return None
        return {**json.loads(row[0] or "{}"), "snapshot_valid": bool(row[1])}


async def state_before(session_id: str, message_id: int, settings: dict):
    async with aiosqlite.connect(storage.DB_PATH) as db:
        row = await (await db.execute("SELECT result_json FROM generations WHERE session_id=? AND assistant_id=? AND valid=1 ORDER BY rowid DESC LIMIT 1", (session_id, message_id))).fetchone()
    state = RuntimeState.model_validate(json.loads(row[0])["state_before"]) if row else RuntimeState(session_id=session_id)
    for key in ("character_id", "persona_id", "world_id"):
        setattr(state, key, settings.get(key))
    return state


async def recover_interrupted():
    """Called once at application startup, never on each request."""
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("UPDATE generations SET status='cancelled',result_json=? WHERE status='pending'",
                         (json.dumps({"status": "cancelled", "error": "runtime restarted", "reply": ""}),))
        await db.commit()


async def cancel_pending(generation_id: str):
    """Also covers a disconnect after meta, before run_chat has started."""
    async with aiosqlite.connect(storage.DB_PATH) as db:
        await db.execute("UPDATE generations SET status='cancelled',result_json=? WHERE generation_id=? AND status='pending'",
                         (json.dumps({"generation_id": generation_id, "status": "cancelled", "reply": "", "error": "stream disconnected before generation"}), generation_id))
        await db.commit()
