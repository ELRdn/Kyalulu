"""Memory Lab API: inspect, edit and toggle memories (Phase 1)."""
import json

import aiosqlite
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from python.core.memory import MAX_CONTENT, MemoryType, SourceKind
from python.storage import memories

router = APIRouter(prefix="/memory")


class MemoryIn(BaseModel):
    scope: str = Field(min_length=1, max_length=300)
    type: MemoryType
    content: str = Field(min_length=1, max_length=MAX_CONTENT)
    source_kind: SourceKind = "user_statement"
    source_quote: str = Field(default="", max_length=2000)
    source_revision: str | None = Field(default=None, max_length=128)
    source_session_id: str | None = Field(default=None, min_length=1, max_length=300)

    @field_validator("content", "scope", mode="before")
    @classmethod
    def trim(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


class MemoryPatch(BaseModel):
    type: MemoryType | None = None
    content: str | None = Field(default=None, min_length=1, max_length=MAX_CONTENT)

    @field_validator("content", mode="before")
    @classmethod
    def trim(cls, value):
        return " ".join(value.split()) if isinstance(value, str) else value


class SearchIn(BaseModel):
    scope: str
    query: str = Field(max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    budget_tokens: int = Field(default=300, ge=20, le=4000)


class Toggle(BaseModel):
    enabled: bool


def _missing(memory_id: str) -> JSONResponse:
    return JSONResponse({"error": f"memory {memory_id} not found"}, status_code=404)


@router.get("/scopes")
async def list_scopes():
    return {"scopes": await memories.scopes()}


@router.get("/session/{session_id}")
async def session_memory(session_id: str):
    """Whether memory is on for a chat session, and the scope it reads and writes."""
    from python.api.chat import _load_settings
    settings = await _load_settings(session_id)
    from python.storage.generations import Conflict
    try:
        scope = await memories.session_scope(settings.model_dump())
    except Conflict as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)
    return {"session_id": session_id, "enabled": await memories.session_enabled(session_id), "scope": scope}


@router.put("/session/{session_id}")
async def set_session_memory(session_id: str, body: Toggle):
    current = await session_memory(session_id)
    if isinstance(current, JSONResponse):
        return current
    await memories.set_session_enabled(session_id, body.enabled)
    return await session_memory(session_id)


@router.get("")
async def list_memories(scope: str, include_deleted: bool = False):
    return {"scope": scope, "memories": await memories.list_memories(scope, include_deleted)}


@router.post("")
async def create_memory(body: MemoryIn):
    if body.source_session_id is not None:
        from python.storage.generations import Conflict, transaction
        await memories.init()
        sid = body.source_session_id
        try:
            async with transaction() as db:
                if await (await db.execute("SELECT 1 FROM session_deletions WHERE session_id=?", (sid,))).fetchone():
                    raise Conflict("source session was deleted")
                exists = await (await db.execute(
                    "SELECT 1 FROM session_settings WHERE session_id=? UNION ALL "
                    "SELECT 1 FROM chat_history WHERE session_id=? LIMIT 1", (sid, sid))).fetchone()
                if not exists:
                    return JSONResponse({"error": "source session not found"}, status_code=404)
                row = await (await db.execute(
                    "SELECT character_id,persona_id,world_id,library_binding FROM session_settings "
                    "WHERE session_id IN (?, '__global__') ORDER BY CASE WHEN session_id=? THEN 0 ELSE 1 END LIMIT 1",
                    (sid, sid))).fetchone()
                settings = {"session_id": sid}
                if row:
                    settings.update(character_id=row[0], persona_id=row[1], world_id=row[2],
                                    library_binding=json.loads(row[3]) if row[3] else None)
                if await memories.session_scope(settings, db=db) != body.scope:
                    raise Conflict("source session memory scope does not match request scope")
                active = await (await db.execute(
                    "SELECT 1 FROM generations g LEFT JOIN session_scopes s ON s.session_id=g.session_id "
                    "WHERE g.status='pending' AND (g.session_id=? OR s.scope=?) LIMIT 1",
                    (sid, body.scope))).fetchone()
                if active:
                    raise Conflict("stop generation before creating memories")
                memory_id = await memories._create(
                    db, body.scope, body.type, body.content, "user", None, sid, None, None,
                    source_kind=body.source_kind, source_quote=body.source_quote or body.content,
                    source_revision=body.source_revision or "manual:1", confirmation="user_confirmed")
                cursor = await db.execute(f"SELECT {memories.COLUMNS} FROM memories WHERE id=?", (memory_id,))
                cursor.row_factory = aiosqlite.Row
                result = memories._row(await cursor.fetchone())
            return result
        except Conflict as exc:
            return JSONResponse({"error": str(exc)}, status_code=409)
    return await memories.create(body.scope, body.type, " ".join(body.content.split()), origin="user",
                                 source_kind=body.source_kind, source_quote=body.source_quote,
                                 source_revision=body.source_revision)


class ScopeMigration(BaseModel):
    expected_revision: str
    share: bool = False


@router.get("/session/{session_id}/scope-preview")
async def scope_preview(session_id: str):
    from python.api.chat import _load_settings
    return await memories.scope_preview((await _load_settings(session_id)).model_dump())


@router.post("/session/{session_id}/scope-migrate")
async def scope_migrate(session_id: str, body: ScopeMigration):
    from python.api.chat import _load_settings
    from python.storage.generations import Conflict
    try:
        return await memories.migrate_scope((await _load_settings(session_id)).model_dump(), body.expected_revision, body.share)
    except Conflict as exc:
        return JSONResponse({"error": str(exc)}, status_code=409)


@router.delete("/session/{session_id}/data")
async def clear_session_memories(session_id: str):
    from python.api.chat import _load_settings
    from python.storage.generations import transaction
    scope = (await memories.scope_preview((await _load_settings(session_id)).model_dump()))["scope"]
    async with transaction() as db:
        active = await (await db.execute("SELECT 1 FROM generations g JOIN session_scopes s ON s.session_id=g.session_id "
                                        "WHERE s.scope=? AND g.status='pending' LIMIT 1", (scope,))).fetchone()
        if active:
            return JSONResponse({"error": "stop generation before deleting memories"}, status_code=409)
        await db.execute("DELETE FROM memory_events WHERE scope=?", (scope,))
        await db.execute("DELETE FROM memories WHERE scope=?", (scope,))
    return {"ok": True, "scope": scope, "affects_shared_sessions": True}


@router.post("/search")
async def search(body: SearchIn):
    """Retrieval preview: what a turn with this message would inject, without logging it."""
    ctx = await memories.prepare(body.scope, body.query, top_k=body.top_k, budget_tokens=body.budget_tokens)
    return {**ctx["trace"], "block": ctx["block"]}


@router.get("/events")
async def scope_events(scope: str, limit: int = 200):
    return {"events": await memories.events(scope=scope, limit=min(max(limit, 1), 1000))}


@router.get("/{memory_id}")
async def get_memory(memory_id: str):
    try:
        return {**await memories.get(memory_id), "events": await memories.events(memory_id=memory_id)}
    except memories.NotFound:
        return _missing(memory_id)


@router.patch("/{memory_id}")
async def update_memory(memory_id: str, body: MemoryPatch):
    try:
        content = " ".join(body.content.split()) if body.content is not None else None
        return await memories.update(memory_id, content=content, type_=body.type)
    except memories.NotFound:
        return _missing(memory_id)


@router.delete("/{memory_id}")
async def delete_memory(memory_id: str):
    try:
        return await memories.delete(memory_id)
    except memories.NotFound:
        return _missing(memory_id)
