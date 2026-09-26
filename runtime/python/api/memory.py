"""Memory Lab API: inspect, edit and toggle memories (Phase 1)."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from python.core.memory import MAX_CONTENT, MemoryType
from python.storage import memories

router = APIRouter(prefix="/memory")


class MemoryIn(BaseModel):
    scope: str = Field(min_length=1, max_length=300)
    type: MemoryType
    content: str = Field(min_length=1, max_length=MAX_CONTENT)

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
    return {"session_id": session_id, "enabled": await memories.session_enabled(session_id),
            "scope": memories.chat_scope(settings.character_id, settings.persona_id, session_id)}


@router.put("/session/{session_id}")
async def set_session_memory(session_id: str, body: Toggle):
    await memories.set_session_enabled(session_id, body.enabled)
    return await session_memory(session_id)


@router.get("")
async def list_memories(scope: str, include_deleted: bool = False):
    return {"scope": scope, "memories": await memories.list_memories(scope, include_deleted)}


@router.post("")
async def create_memory(body: MemoryIn):
    return await memories.create(body.scope, body.type, " ".join(body.content.split()), origin="user")


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
